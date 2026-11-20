// 端到端冒烟测试：把刚构建出的 dist 用本地静态服务喂给真实无头 Chrome，
// 走一遍密码门 → 时间线 → 活动 → 图片弹窗翻页/双击缩放 → 视频弹窗 → 兜底路由，
// 全程收集控制台报错、未捕获异常和失败请求。用独立 profile，不影响用户在用的浏览器。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const DIST = path.resolve('C:/Users/SY/Doubao/chats/2026-11-20/new-chat/hiphoto/dist');
const TMP = path.join(process.env.TEMP, 'hiphoto-smoke');
const PORT = 8732;
const CDP = 9334;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const GATE = 'aihaipai';

fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('no'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const proc = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(TMP, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--window-size=1280,900', `http://127.0.0.1:${PORT}/`,
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];
const failedReqs = [];

// 页面里跑的检查脚本：每一步都返回可核对的事实，不靠截图猜
const CHECK = `(async () => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150); }
    return null;
  };
  const txt = (re) => { const el = qa('div,span').find((d) => re.test((d.textContent || '').trim())); return el ? el.textContent.trim() : null; };
  const R = {};

  // 1) 密码门
  const inp = await until(() => q('input[type=password]'));
  if (!inp) { R.fatal = '没找到密码输入框'; return R; }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(inp, ${JSON.stringify(GATE)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(120);
  q('form button[type=submit]').click();

  // 2) 时间线
  const cards = await until(() => { const a = qa('a[href*="/activity/"]'); return a.length ? a : null; });
  R.timelineCards = cards ? cards.length : 0;
  if (!cards) { R.fatal = '时间线没加载出活动'; return R; }
  R.bgmPresent = !!q('audio');
  R.volumeIdle = q('audio') ? q('audio').volume : null;

  // 3) 进第一个有照片的活动
  let tiles = null;
  for (const c of cards.slice(0, 6)) {
    c.click();
    tiles = await until(() => { const t = qa('[class*="group/img"]'); return t.length ? t : null; }, 9000);
    if (tiles) break;
    history.back();
    await until(() => qa('a[href*="/activity/"]').length > 0, 9000);
  }
  R.activityImageTiles = tiles ? tiles.length : 0;
  if (!tiles) { R.fatal = '前 6 个活动都没照片'; return R; }

  // 4) 图片弹窗：翻页必须立刻换图且无动效
  tiles[0].click();
  const lb = await until(() => q('#lightbox-img'));
  R.lightboxOpened = !!lb;
  if (!lb) { R.fatal = '图片弹窗没打开'; return R; }
  R.counterStart = txt(/^\\d+ \\/ \\d+$/);
  const srcBefore = lb.getAttribute('src');
  const nextBtn = q('button[aria-label="下一张"]');
  R.nextBtnVisible = !!nextBtn && !nextBtn.disabled;
  if (nextBtn && !nextBtn.disabled) {
    nextBtn.click();
    await wait(60);
    const lb2 = q('#lightbox-img');
    R.counterAfterNext = txt(/^\\d+ \\/ \\d+$/);
    R.srcChangedImmediately = !!lb2 && lb2.getAttribute('src') !== srcBefore;
    R.transitionOnPaging = lb2 ? (lb2.style.transition || 'none') : null;
    const prevBtn = q('button[aria-label="上一张"]');
    if (prevBtn && !prevBtn.disabled) {
      prevBtn.click();
      await wait(60);
      R.counterAfterPrev = txt(/^\\d+ \\/ \\d+$/);
      R.backToFirstSrc = q('#lightbox-img').getAttribute('src') === srcBefore;
    }
  }

  // 5) 双击缩放（光标是 zoom-in，点了必须有反应）
  const box = q('#lightbox-img').parentElement;
  const r = box.getBoundingClientRect();
  R.zoomBefore = txt(/^\\d+%$/);
  box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  await wait(120);
  R.zoomAfterDblClick = txt(/^\\d+%$/);
  box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  await wait(120);
  R.zoomAfterSecondDblClick = txt(/^\\d+%$/);

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(150);
  R.lightboxClosedByEsc = !q('#lightbox-img');
  R.bodyScrollRestored = document.body.style.overflow === '';

  // 6) 视频页：方向键不能被抢去翻页；音量联动不再靠轮询
  location.hash = '#/videos';
  const vt = await until(() => { const t = qa('[data-month] div.grid > div'); return t.length ? t : null; });
  R.videoTiles = vt ? vt.length : 0;
  if (vt) {
    vt[0].click();
    const vp = await until(() => q('[data-video-player]'));
    R.videoPlayerOpened = !!vp;
    if (vp) {
      await wait(250);
      R.videoOpenFlag = document.body.hasAttribute('data-video-open');
      R.volumeWhileVideo = q('audio') ? q('audio').volume : null;
      const counterBefore = txt(/^\\d+ \\/ \\d+$/);
      const vel = q('[data-video-player] video');
      R.videoElPresent = !!vel;
      if (vel) {
        // 焦点在 video 上：右键应交给播放器快进，不切下一个视频
        vel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await wait(150);
        R.counterAfterArrowOnVideo = txt(/^\\d+ \\/ \\d+$/);
        R.arrowOnVideoKeptIndex = R.counterAfterArrowOnVideo === counterBefore;
      }
      // 焦点在别处：右键才该翻页
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await wait(200);
      R.counterAfterArrowOnBody = txt(/^\\d+ \\/ \\d+$/);
      R.arrowOnBodyPaged = R.counterAfterArrowOnBody !== counterBefore;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(300);
      R.videoPlayerClosed = !q('[data-video-player]');
      R.videoOpenFlagCleared = !document.body.hasAttribute('data-video-open');
      R.volumeAfterClose = q('audio') ? q('audio').volume : null;
    }
  }

  // 7) 兜底路由
  location.hash = '#/definitely-not-a-page';
  const nf = await until(() => (document.body.textContent || '').includes('页面不存在'), 8000);
  R.notFoundRendered = !!nf;

  // 8) 图片实际解码情况（压缩版地址是否真能取到）
  location.hash = '#/';
  await until(() => qa('a[href*="/activity/"]').length > 0, 15000);
  await wait(2500);
  const imgs = qa('img');
  R.homeImgs = imgs.length;
  R.homeImgsBroken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 5);
  return R;
})()`;

try {
  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
  }
  if (!wsUrl) throw new Error('拿不到 CDP 调试目标');

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleErrors.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '?').slice(0, 300));
    }
    if (m.method === 'Network.loadingFailed') failedReqs.push('FAILED ' + (m.params.errorText || '') );
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      failedReqs.push(m.params.response.status + ' ' + m.params.response.url.slice(0, 160));
    }
  };
  const send = (method, params, timeout = 180000) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); rej(new Error(method + ' 超时')); } }, timeout);
  });

  await send('Runtime.enable', {});
  await send('Network.enable', {});
  await send('Page.enable', {});
  console.log('开始端到端冒烟测试…');
  const r = await send('Runtime.evaluate', { expression: CHECK, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    console.log('脚本异常:', JSON.stringify(r.result.exceptionDetails).slice(0, 1200));
    process.exitCode = 1;
  } else {
    console.log('\n===== 行为核对 =====');
    console.log(JSON.stringify(r.result?.result?.value, null, 2));
  }
  await sleep(500);
  console.log('\n===== 控制台报错/警告 (' + consoleErrors.length + ') =====');
  console.log(consoleErrors.slice(0, 25).join('\n') || '（无）');
  console.log('\n===== 未捕获异常 (' + pageErrors.length + ') =====');
  console.log(pageErrors.slice(0, 15).join('\n') || '（无）');
  console.log('\n===== 失败请求 (' + failedReqs.length + ') =====');
  console.log([...new Set(failedReqs)].slice(0, 25).join('\n') || '（无）');
} finally {
  try { ws?.close(); } catch {}
  try { execFileSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch {}
  server.close();
}