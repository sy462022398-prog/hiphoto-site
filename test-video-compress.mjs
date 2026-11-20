// 在真实 Chrome 里跑真实的 compressVideo，验证产物能播、有声音、确实变小。
// 用独立的临时 profile + 无头模式，不影响用户正在使用的浏览器。
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const PROJ = 'C:/Users/SY/Doubao/chats/2026-11-20/new-chat/hiphoto';
const TMP = path.join(process.env.TEMP, 'hiphoto-vtest');
const PORT = 8731;
const CDP = 9333;

const entry = path.join(TMP, 'entry.js');
fs.writeFileSync(entry, `
import { compressVideo } from '${PROJ}/src/lib/media-pipeline.ts';

// 最小探针：绕开 compressVideo，直接比三种编码器在同一画布上的产出，
// 用来区分「无头环境缺 H.264 编码器」和「画布采集整条路不通」。
window.__probe = async () => {
  const out = [];
  for (const mime of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/webm;codecs=vp9','video/webm;codecs=vp8']) {
    const rec = { mime, supported: false, bytes: 0, events: [] };
    out.push(rec);
    try { rec.supported = MediaRecorder.isTypeSupported(mime); } catch { rec.supported = 'err'; }
    if (rec.supported !== true) continue;
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    const st = c.captureStream(30);
    let n = 0, raf = 0;
    const draw = () => {
      n++;
      g.fillStyle = 'hsl(' + (n * 7 % 360) + ',70%,50%)';
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff'; g.fillRect((n * 11) % 600, 150, 40, 40);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    let r;
    try {
      r = new MediaRecorder(st, { mimeType: mime, videoBitsPerSecond: 2500000 });
      rec.actual = r.mimeType;
      const chunks = [];
      r.ondataavailable = (e) => { const b = e.data ? e.data.size : 0; rec.bytes += b; rec.events.push('data:' + b); if (b) chunks.push(e.data); };
      r.onerror = (e) => rec.events.push('error:' + ((e.error && e.error.name) || '?'));
      const stopped = new Promise((res) => { r.onstop = res; });
      r.start(250);
      rec.events.push('start');
      await new Promise((res) => setTimeout(res, 1200));
      if (r.state !== 'inactive') r.stop();
      await Promise.race([stopped, new Promise((res) => setTimeout(res, 3000))]);
      rec.events.push('stop');
      rec.frames = n;
      rec.blobType = chunks.length ? chunks[0].type : null;
    } catch (e) {
      rec.threw = String(e && e.name) + ': ' + String(e && e.message);
    } finally {
      cancelAnimationFrame(raf);
      st.getTracks().forEach((t) => t.stop());
      c.width = 0; c.height = 0;
    }
  }
  return out;
};

window.__vt = async (forceWebm) => {
  // 非侵入式探针：包住 MediaRecorder，看真实代码到底录出了多少字节
  const Orig = window.MediaRecorder;
  const recLog = [];
  class Probe extends Orig {
    constructor(stream, opts) {
      super(stream, opts);
      const info = { requested: opts && opts.mimeType, actual: this.mimeType,
                     videoBps: opts && opts.videoBitsPerSecond,
                     tracks: stream.getTracks().map(t => t.kind + ':' + t.readyState),
                     bytes: 0, events: [] };
      recLog.push(info);
      this.addEventListener('start', () => info.events.push('start'));
      this.addEventListener('dataavailable', (e) => {
        const n = e.data ? e.data.size : 0;
        info.bytes += n; info.events.push('data:' + n);
      });
      this.addEventListener('error', (e) => info.events.push('error:' + ((e.error && e.error.name) || '?')));
      this.addEventListener('stop', () => info.events.push('stop'));
    }
  }
  Probe.isTypeSupported = (t) => (forceWebm && String(t).startsWith('video/mp4'))
    ? false : Orig.isTypeSupported.call(Orig, t);
  window.MediaRecorder = Probe;

  const support = {};
  for (const m of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1.4d4028,mp4a.40.2','video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9,opus']) {
    try { support[m] = MediaRecorder.isTypeSupported(m); } catch (e) { support[m] = 'err'; }
  }
  const res = await fetch('sample.mp4');
  const buf = await res.arrayBuffer();
  const file = new File([buf], 'sample.mp4', { type: 'video/mp4' });
  const progress = [];
  const t0 = performance.now();
  const out = await compressVideo(file, (m) => {
    if (!progress.length || progress[progress.length-1] !== m) progress.push(m);
  });
  const elapsed = Math.round((performance.now() - t0) / 100) / 10;
  const result = { support, recLog, inputBytes: file.size, elapsedSec: elapsed,
                   progressFirst: progress[0] || null, progressLast: progress[progress.length-1] || null,
                   progressCount: progress.length, skipReason: out.skipReason || null };
  if (!out.blob) { result.compressed = false; return result; }
  result.compressed = true;
  result.outputBytes = out.blob.size;
  result.outputType = out.blob.type;
  result.shrinkPct = Math.round((1 - out.blob.size / file.size) * 100);

  // 产物必须真的能播：装进 video 元素，看能不能解出画面和声音
  const url = URL.createObjectURL(out.blob);
  const v = document.createElement('video');
  v.src = url; v.muted = false; v.volume = 0; v.playsInline = true;
  const meta = await new Promise((resolve) => {
    const to = setTimeout(() => resolve({ ok:false, why:'metadata timeout' }), 20000);
    v.onloadedmetadata = () => { clearTimeout(to); resolve({ ok:true, w:v.videoWidth, h:v.videoHeight, dur:v.duration }); };
    v.onerror = () => { clearTimeout(to); resolve({ ok:false, why:'decode error' }); };
  });
  result.playback = meta;
  if (meta.ok) {
    try { await v.play(); } catch (e) { result.playErr = String(e); }
    await new Promise(r => setTimeout(r, 2500));
    result.audioDecodedBytes = v.webkitAudioDecodedByteCount || 0;
    result.videoDecodedFrames = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : -1;
    result.currentTime = Math.round(v.currentTime * 100) / 100;
    v.pause();
  }
  URL.revokeObjectURL(url);
  return result;
};
`);

await build({
  entryPoints: [entry],
  outfile: path.join(TMP, 'bundle.js'),
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  absWorkingDir: PROJ, logLevel: 'error',
  define: { 'import.meta.env': JSON.stringify({
    VITE_SUPABASE_URL: 'https://dbihymrexmgjlpjnunhl.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_zM1HHW1P8pcuOTe4CmL0Ag_EB13LS-o',
    DEV: false, PROD: true, MODE: 'production',
  }) },
});
fs.writeFileSync(path.join(TMP, 'test.html'),
  '<!doctype html><meta charset="utf-8"><title>vtest</title><body><script src="bundle.js"></script></body>');
console.log('bundle 已生成');

const mime = { '.html':'text/html', '.js':'text/javascript', '.mp4':'video/mp4' };
const server = http.createServer((req, res) => {
  const name = req.url.split('?')[0].replace(/^\//, '') || 'test.html';
  const f = path.join(TMP, name);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${path.join(TMP, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `http://127.0.0.1:${PORT}/test.html`,
], { detached: false, stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws = null;
try {
  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      target = list.find(t => t.type === 'page' && t.url.includes('test.html'));
      if (target) break;
    } catch {}
  }
  if (!target) throw new Error('找不到调试目标');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params, timeout = 180000) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); rej(new Error(method + ' 超时')); } }, timeout);
  });

  await send('Runtime.enable', {});
  for (let i = 0; i < 30; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.__vt', returnByValue: true });
    if (r.result?.result?.value === 'function') break;
    await sleep(400);
  }
  console.log('开始压缩测试（12 秒视频，实时重录）…');
  if (process.argv.includes('--probe-only')) {
    const p = await send('Runtime.evaluate', { expression: 'window.__probe()', awaitPromise: true, returnByValue: true });
    console.log('\n===== 编码器最小探针 =====');
    console.log(JSON.stringify(p.result?.result?.value ?? p.result?.exceptionDetails, null, 2));
  } else {
  for (const forceWebm of [false, true]) {
    const r = await send('Runtime.evaluate', {
      expression: `window.__vt(${forceWebm})`, awaitPromise: true, returnByValue: true,
    });
    console.log(`\n===== ${forceWebm ? '强制 WebM/VP9（对照组）' : '默认 MP4/H.264'} =====`);
    if (r.result?.exceptionDetails) {
      console.log('页面内异常:', JSON.stringify(r.result.exceptionDetails, null, 2));
    } else {
      console.log(JSON.stringify(r.result?.result?.value, null, 2));
    }
  }
  }
} finally {
  try { ws?.close(); } catch {}
  try { execFileSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch {}
  server.close();
}