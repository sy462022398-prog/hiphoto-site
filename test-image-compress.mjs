// 在真实 Chrome 里跑真实的图片压缩管线（compressImagePair / guessMediaType）。
// 只测压缩，不触网、不写任何线上桶。用独立 profile 的无头 Chrome。
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const PROJ = 'C:/Users/SY/Doubao/chats/2026-11-20/new-chat/hiphoto';
const SRC = path.join(process.env.TEMP, 'hiphoto-itest');
const TMP = path.join(process.env.TEMP, 'hiphoto-itest-run');
const PORT = 8735;
const CDP = 9336;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

fs.mkdirSync(TMP, { recursive: true });
for (const f of ['wide.jpg', 'tall.jpg', 'tiny.jpg']) {
  fs.copyFileSync(path.join(SRC, f), path.join(TMP, f));
}
// 冒充 HEIC：内容不是任何可解码格式，用来验证"解不开就抛错"这条退路的触发条件
fs.writeFileSync(path.join(TMP, 'fake.heic'), Buffer.from('not an image at all'.repeat(64)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const entry = path.join(TMP, 'entry.js');
fs.writeFileSync(entry, `
import { compressImagePair, guessMediaType } from '${PROJ}/src/lib/media-pipeline.ts';

const dims = (blob) => new Promise((res, rej) => {
  const u = URL.createObjectURL(blob);
  const im = new Image();
  im.onload = () => { const r = { w: im.naturalWidth, h: im.naturalHeight }; URL.revokeObjectURL(u); res(r); };
  im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('产物解不开')); };
  im.src = u;
});

window.__it = async () => {
  const out = { cases: [], typeGuess: [] };

  // 类型判定：MIME 为空时必须靠扩展名认出视频
  const mk = (name, type) => new File([new Uint8Array(8)], name, { type });
  for (const [name, type, want] of [
    ['clip.mp4', 'video/mp4', 'video'],
    ['clip.MOV', '', 'video'],
    ['clip.m4v', '', 'video'],
    ['photo.jpg', '', 'image'],
    ['photo.heic', '', 'image'],
    ['photo.jpg', 'image/jpeg', 'image'],
    ['clip.mov', 'video/quicktime', 'video'],
    ['无扩展名', '', 'image'],
  ]) {
    const got = guessMediaType(mk(name, type));
    out.typeGuess.push({ name, mime: type || '(空)', want, got, pass: got === want });
  }

  for (const name of ['wide.jpg', 'tall.jpg', 'tiny.jpg', 'fake.heic']) {
    const res = await fetch(name);
    const buf = await res.arrayBuffer();
    const mime = name.endsWith('.heic') ? 'image/heic' : 'image/jpeg';
    const file = new File([buf], name, { type: mime });
    const c = { name, inputBytes: file.size };
    out.cases.push(c);
    const t0 = performance.now();
    try {
      const pair = await compressImagePair(file);
      c.ms = Math.round(performance.now() - t0);
      c.thumbBytes = pair.thumb.size;
      c.webBytes = pair.web.size;
      c.thumbType = pair.thumb.type;
      c.webType = pair.web.type;
      c.thumbDims = await dims(pair.thumb);
      c.webDims = await dims(pair.web);
      c.ratio = Math.round((pair.web.size / file.size) * 1000) / 10 + '%';
      c.threw = null;
    } catch (e) {
      c.ms = Math.round(performance.now() - t0);
      c.threw = String(e && e.message || e);
    }
  }
  return out;
};
`, 'utf8');

await build({
  entryPoints: [entry],
  bundle: true,
  outfile: path.join(TMP, 'bundle.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  absWorkingDir: PROJ,
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://dbihymrexmgjlpjnunhl.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('sb_publishable_zM1HHW1P8pcuOTe4CmL0Ag_EB13LS-o'),
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
  },
  logLevel: 'error',
});
fs.writeFileSync(path.join(TMP, 'test.html'),
  '<!doctype html><meta charset="utf-8"><title>it</title><body><script src="bundle.js"></script></body>', 'utf8');
console.log('bundle 已生成');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.jpg': 'image/jpeg', '.heic': 'image/heic' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'test.html';
  const f = path.resolve(TMP, rel);
  if (!f.startsWith(path.resolve(TMP)) || !fs.existsSync(f)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const proc = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(TMP, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
  `http://127.0.0.1:${PORT}/test.html`,
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
try {
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) wsUrl = p.webSocketDebuggerUrl;
    } catch {}
  }
  if (!wsUrl) throw new Error('拿不到 CDP 目标');
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params, timeout = 180000) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); rej(new Error(method + ' 超时')); } }, timeout);
  });
  await send('Runtime.enable', {});
  for (let i = 0; i < 30; i++) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.__it', returnByValue: true });
    if (r.result?.result?.value === 'function') break;
    await sleep(400);
  }
  console.log('开始图片压缩测试…');
  const r = await send('Runtime.evaluate', { expression: 'window.__it()', awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('异常:', JSON.stringify(r.result.exceptionDetails).slice(0, 900));
  else console.log(JSON.stringify(r.result?.result?.value, null, 2));
} finally {
  try { ws?.close(); } catch {}
  try { execFileSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch {}
  server.close();
}