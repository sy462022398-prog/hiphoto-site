// 媒体 URL 映射：把任意来源桶的地址重建为目标优化桶地址
// 兼容 photos / photos-web / photos-thumb / videos / videos-hd 任意来源，
// 因此后台新上传的内容无论落在哪个桶，前台都能正确取到对应版本。

import type { SyntheticEvent } from 'react';

// 背景音乐走存储桶绝对地址。
// 不用 import 本地 mp3：vite 的 base './' 会把它编译成
// new URL(..., import.meta.url) 这种运行时路径，静态发布扫描跟不上，
// 线上会 404 导致播放器永远不响。
export const BGM_URL =
  'https://dbihymrexmgjlpjnunhl.supabase.co/storage/v1/object/public/site-assets/bgm.mp3';

const PUBLIC_RE = /^(https?:\/\/[^/]+\/storage\/v1\/object\/public)\/([^/]+)\/(.+)$/;

interface Parsed {
  prefix: string; // 含 /storage/v1/object/public
  bucket: string;
  key: string; // 保持原始编码，不做解码再编码
}

function parse(url: string): Parsed | null {
  const m = PUBLIC_RE.exec(url.split('?')[0].split('#')[0]);
  if (!m) return null;
  return { prefix: m[1], bucket: m[2], key: m[3] };
}

function rebuild(p: Parsed, bucket: string, key: string): string {
  return `${p.prefix}/${bucket}/${key}`;
}

/** 把 key 的扩展名换成 .webp（无扩展名时追加） */
function toWebpKey(key: string): string {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  return dot > slash ? `${key.slice(0, dot)}.webp` : `${key}.webp`;
}

/** 列表缩略图：480px WebP */
export function photoThumb(url: string | null | undefined): string | null {
  if (!url) return null;
  const p = parse(url);
  if (!p) return url;
  return rebuild(p, 'photos-thumb', toWebpKey(p.key));
}

/** 详情/灯箱展示版：1920px WebP */
export function photoWeb(url: string | null | undefined): string | null {
  if (!url) return null;
  const p = parse(url);
  if (!p) return url;
  return rebuild(p, 'photos-web', toWebpKey(p.key));
}

/** 视频播放版（key 与原桶一致） */
export function videoHd(url: string | null | undefined): string | null {
  if (!url) return null;
  const p = parse(url);
  if (!p) return url;
  return rebuild(p, 'videos-hd', p.key);
}

/** 供删除派生对象使用：解析出桶名与对象 key */
export function parseStorageUrl(
  url: string | null | undefined,
): { bucket: string; key: string } | null {
  if (!url) return null;
  const p = parse(url);
  return p ? { bucket: p.bucket, key: p.key } : null;
}

/**
 * 图片加载失败时的兜底，按"展示版 → 缩略图 → 原始地址"依次往下试。
 *
 * 原图桶 photos / videos 已清空，历史内容的原始地址多半是死路；
 * 但压缩失败（例如浏览器解不开的 HEIC）时原图确实存在 photos 桶里，
 * 所以原图必须留在链条最后一环，不能像之前那样在两个压缩版之间打转就放弃。
 * 视频封面只存在于 photos-thumb，不去 photos-web 白跑。
 *
 * 用法：<img src={photoThumb(u)!} onError={imageFallback(u)} />
 */
export function imageFallback(original: string | null | undefined) {
  return (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (!original) return;

    // 同一个 DOM 被换去显示另一张图时，已试记录要归零
    if (img.dataset.fbFor !== original) {
      img.dataset.fbFor = original;
      img.dataset.fbTried = '';
    }

    const p = parse(original);
    const chain: string[] = [];
    if (p) {
      const wk = toWebpKey(p.key);
      if (!/-poster\.webp$/i.test(p.key)) {
        chain.push(rebuild(p, 'photos-web', wk));
        chain.push(rebuild(p, 'photos-thumb', wk));
      } else {
        chain.push(rebuild(p, 'photos-thumb', wk));
      }
    }
    chain.push(original);

    // 记下试过哪些地址，避免在两个压缩版之间来回重试同一个失败地址
    const tried = (img.dataset.fbTried || '').split('\n').filter(Boolean);
    if (!tried.includes(img.src)) tried.push(img.src);
    const next = chain.find((u) => !tried.includes(u));
    if (!next) return;

    tried.push(next);
    img.dataset.fbTried = tried.join('\n');
    img.src = next;
  };
}
