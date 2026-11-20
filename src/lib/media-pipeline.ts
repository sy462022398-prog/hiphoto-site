// 后台上传优化管线：浏览器端生成缩略图 / 展示版 / 视频封面，并带一年强缓存上传。
// 关键约束：每次上传都校验响应与远端字节数，避免"上传成功但内容是错误页"的情况。
import { supabase } from '../supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const STORAGE = `${SUPABASE_URL}/storage/v1`;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

// 画布安全上限：超过则跳过派生版本，前台自动回退原图
const MAX_SIDE = 16384;
const MAX_AREA = 120_000_000;

export interface UploadResult {
  fileUrl: string;
  thumbnailUrl?: string;
  variants: string[];
  note?: string;
}

function publicUrl(bucket: string, key: string): string {
  return `${STORAGE}/object/public/${bucket}/${key}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  // 没有会话就别用匿名密钥硬试：那只会返回一句看不懂的 RLS 报错。
  if (!token) throw new Error('登录已过期，请重新登录后再试');
  return { apikey: ANON_KEY, Authorization: `Bearer ${token}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 上传并校验：响应必须 ok，且远端字节数与本地一致 */
/**
 * 查远端对象的真实大小。
 * 不能用公开地址的 Range 响应头：Supabase 没有设 access-control-expose-headers，
 * content-range 不在 CORS 安全名单里，浏览器中跨域读它一律拿到 null，
 * 于是校验恒失败、每次上传都被误判成"上传失败"（文件其实已经传上去了）。
 * list 接口把大小放在 JSON body 里，不受响应头暴露限制。
 */
async function remoteSize(bucket: string, key: string): Promise<number | null> {
  const slash = key.lastIndexOf('/');
  const prefix = slash > 0 ? key.slice(0, slash) : '';
  const name = slash > 0 ? key.slice(slash + 1) : key;
  const auth = await authHeaders();
  const res = await fetch(`${STORAGE}/object/list/${bucket}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, search: name, limit: 100 }),
  });
  if (!res.ok) return null;
  const list: unknown = await res.json();
  if (!Array.isArray(list)) return null;
  for (const o of list) {
    if (o && typeof o === 'object' && (o as { name?: string }).name === name) {
      const size = (o as { metadata?: { size?: unknown } }).metadata?.size;
      if (typeof size === 'number') return size;
    }
  }
  return null;
}

async function putVerified(
  bucket: string,
  key: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  if (!blob || blob.size === 0) throw new Error('待上传内容为空');
  const url = `${STORAGE}/object/${bucket}/${key}`;
  const auth = await authHeaders();
  let lastErr = '';

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': contentType,
          'Cache-Control': CACHE_CONTROL,
          'x-upsert': 'true',
        },
        body: blob,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 120)}`);

      // 回读校验：向存储 API 查这个对象的真实大小
      const total = await remoteSize(bucket, key);
      if (total === null || total !== blob.size) {
        throw new Error(`远端大小校验失败（${total} ≠ ${blob.size}）`);
      }
      return;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (attempt < 4) await sleep(800 * attempt);
    }
  }
  throw new Error(`${bucket}/${key} 上传失败：${lastErr}`);
}

async function decodeImage(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}

/** 按最大宽度等比缩放并编码为 WebP */
async function renderWebp(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxW: number,
  quality: number,
): Promise<Blob> {
  const scale = Math.min(1, maxW / srcW);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA) {
    throw new Error('图片尺寸超出浏览器处理上限');
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob || blob.size === 0) throw new Error('WebP 编码失败');
  return blob;
}

function withWebpExt(key: string): string {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  return dot > slash ? `${key.slice(0, dot)}.webp` : `${key}.webp`;
}

function fmtBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)}MB`
    : `${Math.round(n / 1024)}KB`;
}

/** 尽力删除一批对象，失败不抛错（用于回滚半成品） */
async function deleteKeys(targets: Array<{ bucket: string; key: string }>): Promise<void> {
  if (targets.length === 0) return;
  let auth: Record<string, string>;
  try {
    auth = await authHeaders();
  } catch {
    return;
  }
  const byBucket = new Map<string, string[]>();
  for (const t of targets) {
    const list = byBucket.get(t.bucket) || [];
    if (!list.includes(t.key)) list.push(t.key);
    byBucket.set(t.bucket, list);
  }
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, keys]) => {
      try {
        await fetch(`${STORAGE}/object/${bucket}`, {
          method: 'DELETE',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: keys }),
        });
      } catch {
        /* 尽力而为 */
      }
    }),
  );
}

/** 解得开就压成 480px 缩略图 + 1920px 展示版；解不开会抛错，由调用方决定退路 */
export async function compressImagePair(file: File): Promise<{ thumb: Blob; web: Blob }> {
  const bitmap = await decodeImage(file);
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    // 缩略图按宽 480，保证网格里横向铺满时不糊
    const thumb = await renderWebp(bitmap, w, h, 480, 0.72);
    // 展示版按长边 1920。竖图若也按宽 1920，长边会到 2560，
    // 白白多出四成像素和体积，而弹窗里根本显示不到那么大。
    const webMaxW = Math.max(1, Math.round(w * Math.min(1, 1920 / Math.max(w, h))));
    const web = await renderWebp(bitmap, w, h, webMaxW, 0.8);
    return { thumb, web };
  } finally {
    bitmap.close();
  }
}

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|3gp|3g2|mts|m2ts|mpg|mpeg|wmv|flv|f4v)$/i;

/**
 * 判类型不能只看 MIME：部分手机文件管理器、网盘选回来的文件 type 是空字符串，
 * 那时视频会被当成图片存进 photos 桶，前台显示成裂图，视频也进不了视频列表。
 */
export function guessMediaType(file: File): 'image' | 'video' {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  return VIDEO_EXT.test(file.name) ? 'video' : 'image';
}

/**
 * 图片：只存 480px 缩略图 + 1920px 展示版，不再另存原图。
 * 原图对前台完全无用，却占掉大头额度（历史数据里原图 495MB、展示版仅 139MB）。
 * 只有浏览器压根解不开这个格式时（例如部分 HEIC），才退回存原图，
 * 否则这张照片就彻底丢了。
 */
export async function uploadImage(
  file: File,
  activityId: string,
  index: number,
  onProgress?: (msg: string) => void,
): Promise<UploadResult> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const key = `${activityId}/${Date.now()}-${index}.${ext}`;
  const webpKey = withWebpExt(key);
  const uploaded: Array<{ bucket: string; key: string }> = [];

  // 第一阶段：压缩。只有这一步失败才允许退回原图。
  let pair: { thumb: Blob; web: Blob };
  try {
    onProgress?.('压缩图片…');
    pair = await compressImagePair(file);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    onProgress?.('无法压缩，改存原图…');
    await putVerified('photos', key, file, file.type || 'image/jpeg');
    return {
      fileUrl: publicUrl('photos', key),
      variants: [],
      note: `未能压缩（${reason}），已按原图保存；该格式在部分浏览器里可能显示不出来`,
    };
  }

  // 第二阶段：上传。这里失败绝不能改传原图——原图大得多，
  // 网络差或额度将满时只会更失败，还会把省下来的额度一口吃掉，
  // 而且失败原因会被写成"未能压缩"，与事实不符。
  try {
    onProgress?.('上传缩略图…');
    await putVerified('photos-thumb', webpKey, pair.thumb, 'image/webp');
    uploaded.push({ bucket: 'photos-thumb', key: webpKey });

    onProgress?.('上传展示版…');
    await putVerified('photos-web', webpKey, pair.web, 'image/webp');
    uploaded.push({ bucket: 'photos-web', key: webpKey });
  } catch (e) {
    // 半成品清掉，避免留下没有记录引用的孤儿文件
    await deleteKeys(uploaded);
    throw e;
  }

  onProgress?.(`已压缩 ${fmtBytes(file.size)} → ${fmtBytes(pair.web.size)}`);
  return {
    fileUrl: publicUrl('photos-web', webpKey),
    variants: [`photos-thumb/${webpKey}`, `photos-web/${webpKey}`],
    // note 只用于"出问题了"。压缩成功属于正常结果，写进 note 会让调用方
    // 把每张照片都当成告警，传几十张就弹一个几十行的框。
  };
}

// ── 视频压缩 ────────────────────────────────────────────────
// 浏览器里没有 ffmpeg，只能"边播边录"重新编码：耗时约等于视频时长。
// 只录 MP4/H.264，因为 WebM 在 iPhone 上放不出来；录不了 MP4 就原样上传。
const VIDEO_MAX_W = 1280;
const VIDEO_BITRATE = 2_500_000;
const AUDIO_BITRATE = 128_000;
const VIDEO_SKIP_BELOW = 8 * 1024 * 1024;
// 边播边录是实时的，且整段产物先攒在内存里。
// 超过 20 分钟就既不划算也不安全（内存可能撑爆标签页），直接原样上传。
const VIDEO_MAX_DURATION = 20 * 60;

type VFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  // 必须显式指定 avc1（H.264）。只写 'video/mp4' 时浏览器可能挑 AV1/HEVC，
  // 那样产出的文件在不少 iPhone 上放不出来，就违背了压缩的初衷。
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.4d4028,mp4a.40.2',
    'video/mp4;codecs=avc1',
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* 继续试下一个 */
    }
  }
  return null;
}

/**
 * 把视频降分辨率 + 降码率重录一遍。
 * blob 为 null 表示没压成，调用方一律退回原文件，绝不丢视频；
 * skipReason 只在"值得告诉用户"时给出，正常的"本来就够小"不算告警。
 */
export async function compressVideo(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<{ blob: Blob | null; skipReason?: string }> {
  const mime = pickVideoMime();
  if (!mime) return { blob: null, skipReason: '当前浏览器不支持 MP4/H.264 录制' };
  if (file.size < VIDEO_SKIP_BELOW) return { blob: null };

  const url = URL.createObjectURL(file);
  const v = document.createElement('video') as VFCVideo;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;

  let ac: AudioContext | null = null;
  let raf = 0;
  let timer = 0;
  let earlyTimer = 0;
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  try {
    await waitEvent(v, 'loadedmetadata', 20000);
    const duration = v.duration;
    const sw = v.videoWidth;
    const sh = v.videoHeight;
    if (!Number.isFinite(duration) || duration <= 0 || !sw || !sh) {
      return { blob: null, skipReason: '读不到视频的时长或分辨率' };
    }
    if (duration > VIDEO_MAX_DURATION) {
      return {
        blob: null,
        skipReason: `视频长达 ${Math.round(duration / 60)} 分钟，超过 20 分钟不做压缩`,
      };
    }

    // 本来就够小够瘦的，别白折腾一遍
    const srcBitrate = (file.size * 8) / duration;
    if (sw <= VIDEO_MAX_W && srcBitrate <= VIDEO_BITRATE * 1.15) return { blob: null };

    const scale = Math.min(1, VIDEO_MAX_W / sw);
    const tw = Math.max(2, Math.round(sw * scale / 2) * 2);
    const th = Math.max(2, Math.round(sh * scale / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: null, skipReason: '无法创建画布' };

    stream = canvas.captureStream(30);

    // 音轨走 Web Audio 引到录制流里，不接扬声器，所以压缩过程是静音的
    try {
      ac = new AudioContext();
      if (ac.state === 'suspended') await ac.resume();
      const node = ac.createMediaElementSource(v);
      const dest = ac.createMediaStreamDestination();
      node.connect(dest);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    } catch {
      /* 拿不到音轨就只录画面 */
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: VIDEO_BITRATE,
      audioBitsPerSecond: AUDIO_BITRATE,
    });
    rec = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    // isTypeSupported() 只说明格式在册，不代表这台机器真能编 H.264：
    // 录制走硬件编码器，关掉硬件加速、老显卡或没有可用 GPU 时，它照样返回 true 却产出 0 字节。
    // 所以必须盯住编码错误和"到底有没有吐出数据"，否则会白等整段视频的时长。
    let abortEarly: ((e: Error) => void) | null = null;
    const earlyAbort = new Promise<never>((_, rej) => {
      abortEarly = rej;
    });
    recorder.onerror = () => abortEarly?.(new Error('ENCODER'));
    const finished = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
    });

    const paint = () => {
      try {
        ctx.drawImage(v, 0, 0, tw, th);
      } catch {
        /* 个别帧画不上就算了 */
      }
      const pct = Math.min(99, Math.round((v.currentTime / duration) * 100));
      onProgress?.(`压缩视频 ${pct}%（请保持本页面在前台）`);
    };

    recorder.start(1000);
    // 开录 2.5 秒还是一个字节都没有，就是编码器不干活，立刻收手别耗着
    earlyTimer = window.setTimeout(() => {
      if (!chunks.length) abortEarly?.(new Error('ENCODER'));
    }, 2500);
    await v.play();

    if (typeof v.requestVideoFrameCallback === 'function') {
      const step = () => {
        paint();
        if (!v.ended) v.requestVideoFrameCallback!(step);
      };
      v.requestVideoFrameCallback(step);
    } else {
      const step = () => {
        paint();
        if (!v.ended) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    // 兜底超时：正常是实时播完，多给 60 秒余量
    await Promise.race([
      waitEvent(v, 'ended', (duration + 60) * 1000),
      earlyAbort,
      new Promise<never>((_, rej) => {
        timer = window.setTimeout(
          () => rej(new Error('压缩超时')),
          (duration + 90) * 1000,
        );
      }),
    ]);

    clearTimeout(timer);
    clearTimeout(earlyTimer);
    if (recorder.state !== 'inactive') recorder.stop();
    // onstop 万一不来，也不能让上传永远卡在这一步
    const out = await Promise.race([
      finished,
      new Promise<never>((_, rej) => {
        timer = window.setTimeout(() => rej(new Error('封装超时')), 15000);
      }),
    ]);
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    canvas.width = 0;
    canvas.height = 0;

    // 编码器压根没吐出数据，这是真问题，得说一声
    if (!out.size) return { blob: null, skipReason: '浏览器没能编出视频' };
    // 压完反而没变小就别用（属正常情况，不必告警）
    if (out.size >= file.size * 0.95) return { blob: null };
    return { blob: out };
  } catch (e) {
    if (e instanceof Error && e.message === 'ENCODER') {
      return {
        blob: null,
        skipReason: '这台电脑的浏览器编不了 H.264（可在浏览器设置里开启硬件加速后重试）',
      };
    }
    return { blob: null, skipReason: '压缩过程中出错' };
  } finally {
    clearTimeout(timer);
    clearTimeout(earlyTimer);
    cancelAnimationFrame(raf);
    // 中途退出时录制器和画布流还活着，不关掉会一直占着编码器
    try {
      if (rec && rec.state !== 'inactive') rec.stop();
    } catch {
      /* ignore */
    }
    if (stream) {
      for (const t of stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
    }
    try {
      v.pause();
    } catch {
      /* ignore */
    }
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
    if (ac) {
      try {
        await ac.close();
      } catch {
        /* ignore */
      }
    }
  }
}

function waitEvent(el: HTMLVideoElement, ok: string, timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('视频读取超时'));
    }, timeout);
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('视频无法解码')); };
    function cleanup() {
      clearTimeout(timer);
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
    }
    el.addEventListener(ok, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

/** 从视频抽一帧做封面；timeSec 指定第几秒，不传则沿用默认（第 1 秒或时长一半） */
async function makeVideoPoster(file: File, timeSec?: number): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'metadata';
  v.src = url;
  try {
    await waitEvent(v, 'loadedmetadata');
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 2;
    const target =
      typeof timeSec === 'number' && Number.isFinite(timeSec)
        ? Math.max(0, Math.min(timeSec, Math.max(0, duration - 0.05)))
        : Math.min(1, duration / 2);
    const seeked = waitEvent(v, 'seeked');
    v.currentTime = target;
    await seeked;
    if (!v.videoWidth || !v.videoHeight) return null;
    return await renderWebp(v, v.videoWidth, v.videoHeight, 640, 0.75);
  } catch {
    return null;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * 视频：自动生成封面存 photos-thumb，并尽量压缩后存 videos-hd（前台播放桶，带一年缓存）。
 * 压缩走"边播边录"，耗时约等于视频时长；压不成就原样上传，不丢文件。
 */
export async function uploadVideo(
  file: File,
  activityId: string,
  index: number,
  onProgress?: (msg: string) => void,
  posterTime?: number,
): Promise<UploadResult> {
  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const base = `${activityId}/${Date.now()}-${index}`;
  const key = `${base}.${ext}`;

  onProgress?.('生成视频封面…');
  const poster = await makeVideoPoster(file, posterTime);
  let thumbnailUrl: string | undefined;
  let note: string | undefined;
  const variants: string[] = [];
  const uploadedPoster: Array<{ bucket: string; key: string }> = [];
  if (poster) {
    const posterKey = `${base}-poster.webp`;
    try {
      await putVerified('photos-thumb', posterKey, poster, 'image/webp');
      thumbnailUrl = publicUrl('photos-thumb', posterKey);
      variants.push(`photos-thumb/${posterKey}`);
      uploadedPoster.push({ bucket: 'photos-thumb', key: posterKey });
    } catch {
      note = '封面上传失败，列表将显示占位图标（视频本身不受影响）';
    }
  } else {
    note = '未能生成封面，列表将显示占位图标';
  }

  // 自动压缩：能压就压，压不了/压完没变小一律退回原文件，绝不丢视频
  const { blob: compressed, skipReason } = await compressVideo(file, onProgress);
  const body = compressed || file;
  // 压缩产物是 MP4，扩展名要跟着改，否则 .mov 里装着 MP4 会让浏览器判错类型
  const finalKey = compressed ? `${base}.mp4` : key;
  const contentType = compressed ? 'video/mp4' : file.type || 'video/mp4';

  const messages: string[] = [];
  if (note) messages.push(note);
  if (compressed) {
    // 成功不算告警，只在进度里说一声
    onProgress?.(`已压缩 ${fmtBytes(file.size)} → ${fmtBytes(compressed.size)}`);
  } else if (skipReason) {
    messages.push(`${skipReason}，已按原视频保存`);
  }

  onProgress?.('上传视频…');
  try {
    await putVerified('videos-hd', finalKey, body, contentType);
  } catch (e) {
    // 视频没传上去，封面就成了没人引用的孤儿，白占额度
    await deleteKeys(uploadedPoster);
    throw e;
  }
  return {
    fileUrl: publicUrl('videos-hd', finalKey),
    thumbnailUrl,
    variants,
    note: messages.length ? messages.join('；') : undefined,
  };
}

export async function uploadMedia(
  file: File,
  activityId: string,
  index: number,
  onProgress?: (msg: string) => void,
  posterTime?: number,
): Promise<UploadResult & { mediaType: 'image' | 'video' }> {
  const isVideo = guessMediaType(file) === 'video';
  const r = isVideo
    ? await uploadVideo(file, activityId, index, onProgress, posterTime)
    : await uploadImage(file, activityId, index, onProgress);
  return { ...r, mediaType: isVideo ? 'video' : 'image' };
}

/** 删除媒体时，把派生对象一并清掉，避免残留占空间 */
export async function removeMediaObjects(
  fileUrl: string,
  thumbnailUrl?: string | null,
): Promise<void> {
  const auth = await authHeaders();
  const targets: Array<{ bucket: string; key: string }> = [];
  const parse = (u?: string | null) => {
    if (!u) return null;
    const m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(u.split('?')[0]);
    return m ? { bucket: m[1], key: m[2] } : null;
  };

  const main = parse(fileUrl);
  if (main) {
    targets.push(main);
    const dot = main.key.lastIndexOf('.');
    const webpKey = dot > main.key.lastIndexOf('/')
      ? `${main.key.slice(0, dot)}.webp`
      : `${main.key}.webp`;
    if (main.bucket === 'photos' || main.bucket === 'photos-web' || main.bucket === 'photos-thumb') {
      // 现在图片的主地址就是 photos-web，必须照样把缩略图和展示版都清掉
      targets.push({ bucket: 'photos-thumb', key: webpKey });
      targets.push({ bucket: 'photos-web', key: webpKey });
    } else if (main.bucket === 'videos' || main.bucket === 'videos-hd') {
      targets.push({ bucket: 'videos-hd', key: main.key });
    }
  }
  const thumb = parse(thumbnailUrl);
  if (thumb) targets.push(thumb);

  const byBucket = new Map<string, string[]>();
  for (const t of targets) {
    const list = byBucket.get(t.bucket) || [];
    if (!list.includes(t.key)) list.push(t.key);
    byBucket.set(t.bucket, list);
  }
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, keys]) => {
      try {
        await fetch(`${STORAGE}/object/${bucket}`, {
          method: 'DELETE',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: keys }),
        });
      } catch {
        /* 忽略：数据库记录仍会删除 */
      }
    }),
  );
}
