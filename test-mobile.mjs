// 手机尺寸实测：390x844（iPhone 常见逻辑分辨率）+ 触摸模拟。
// 查横向溢出、导航是否挤成两行、弹窗按钮是否可见可点、底部播放器是否挡内容。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const DIST = path.resolve('C:/Users/SY/Doubao/chats/2026-11-20/new-chat/hiphoto/dist');
const TMP = path.join(process.env.TEMP, 'hiphoto-mobile');
const PORT = 8737;
const CDP = 9338;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const GATE = 'aihaipai';
const W = 390, H = 844;

fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const f = path.resolve(DIST, rel);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const proc = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(TMP, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  `--window-size=${W},${H}`, `http://127.0.0.1:${PORT}/`,
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];

const CHECK = `(async () => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150); }
    return null;
  };
  const R = { viewport: { w: innerWidth, h: innerHeight } };

  // 横向溢出：找出真正超出视口右边界的元素
  const overflow = () => {
    const bad = [];
    const lim = innerWidth + 1;
    for (const el of qa('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > lim || r.left < -1) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && cs.visibility === 'hidden') continue;
        bad.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 70),
                   left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
    return bad;
  };
  const tap = (el) => {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  };

  const inp = await until(() => q('input[type=password]'));
  if (!inp) { R.fatal = '没找到密码框'; return R; }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(inp, ${JSON.stringify(GATE)});
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(120);
  tap(q('form button[type=submit]'));

  const cards = await until(() => { const a = qa('a[href*="/activity/"]'); return a.length ? a : null; });
  R.timelineCards = cards ? cards.length : 0;
  if (!cards) { R.fatal = '时间线没加载'; return R; }
  await wait(1500);

  // 顶部导航：是否被挤成两行
  const header = q('header') || qa('div').find((d) => d.querySelector('a[href="#/videos"]'));
  if (header) {
    const hr = header.getBoundingClientRect();
    R.headerHeight = Math.round(hr.height);
    const links = qa('header a, nav a').filter((a) => a.getBoundingClientRect().height > 0);
    R.navRowTops = [...new Set(links.map((a) => Math.round(a.getBoundingClientRect().top)))];
    R.navWrapped = R.navRowTops.length > 1;
    // 只量导航项本身的底边，品牌链接更高会造成假换行
    const navOnly = links.filter((a) => { const h = a.getAttribute('href') || ''; return h.startsWith('#/') && !h.includes('/activity/'); });
    R.navBottoms = [...new Set(navOnly.map((a) => Math.round(a.getBoundingClientRect().bottom)))];
    R.navItems = navOnly.map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 12),
      top: Math.round(a.getBoundingClientRect().top), bottom: Math.round(a.getBoundingClientRect().bottom) }));
    R.brandText = (header.querySelector('a') || {}).textContent || null;
  }
  R.homeScrollW = document.documentElement.scrollWidth;
  R.homeOverflow = overflow().slice(0, 8);

  // 底部音乐播放器是否盖住最后一张卡片
  const pill = qa('div').find((d) => (d.textContent || '').includes('时间都去哪儿了') && getComputedStyle(d).position === 'fixed');
  if (pill) {
    const pr = pill.getBoundingClientRect();
    R.musicPill = { top: Math.round(pr.top), bottom: Math.round(pr.bottom), width: Math.round(pr.width), right: Math.round(pr.right) };
    R.musicPillFitsWidth = pr.right <= innerWidth + 1 && pr.left >= -1;
  }

  // 活动页 + 图片弹窗
  let tiles = null;
  for (const c of cards.slice(0, 6)) {
    tap(c);
    tiles = await until(() => { const t = qa('[class*="group/img"]'); return t.length ? t : null; }, 9000);
    if (tiles) break;
    history.back();
    await until(() => qa('a[href*="/activity/"]').length > 0, 9000);
  }
  R.activityTiles = tiles ? tiles.length : 0;
  if (!tiles) { R.fatal = '没找到照片'; return R; }
  await wait(800);
  R.activityScrollW = document.documentElement.scrollWidth;
  R.activityOverflow = overflow().slice(0, 8);

  tap(tiles[0]);
  const lb = await until(() => q('#lightbox-img'));
  R.lightboxOpened = !!lb;
  if (lb) {
    await wait(400);
    const nb = q('button[aria-label="下一张"]');
    const pb = q('button[aria-label="上一张"]');
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right),
               inViewport: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 }; };
    R.nextBtn = box(nb);
    R.prevBtn = box(pb);
    R.nextBtnBigEnough = nb ? nb.getBoundingClientRect().width >= 40 && nb.getBoundingClientRect().height >= 40 : null;
    const ir = lb.getBoundingClientRect();
    R.lightboxImg = { w: Math.round(ir.width), h: Math.round(ir.height) };
    // 按钮是否压在图片上（压住会挡住画面，但不影响可点）
    R.nextOverlapsImg = nb ? nb.getBoundingClientRect().left < ir.right : null;
    const before = lb.getAttribute('src');
    if (nb && !nb.disabled) { tap(nb); await wait(120); }
    R.pagedOnTap = q('#lightbox-img') && q('#lightbox-img').getAttribute('src') !== before;
    R.lbOverflow = overflow().slice(0, 6);
    const closeBtn = qa('button').find((b) => b.querySelector('svg.lucide-x'));
    if (closeBtn) tap(closeBtn);
    await wait(250);
    R.lightboxClosed = !q('#lightbox-img');
  }

  // 视频页 + 播放器顶部是否挤爆
  location.hash = '#/videos';
  const vt = await until(() => { const t = qa('[data-month] div.grid > div'); return t.length ? t : null; });
  R.videoTiles = vt ? vt.length : 0;
  await wait(800);
  R.videoPageScrollW = document.documentElement.scrollWidth;
  R.videoPageOverflow = overflow().slice(0, 8);
  if (vt) {
    tap(vt[0]);
    const vp = await until(() => q('[data-video-player]'));
    R.videoPlayerOpened = !!vp;
    if (vp) {
      await wait(700);
      const bar = vp.firstElementChild;
      R.videoBarHeight = bar ? Math.round(bar.getBoundingClientRect().height) : null;
      const title = vp.querySelector('h2');
      R.videoTitleWidth = title ? Math.round(title.getBoundingClientRect().width) : null;
      R.videoScrollW = document.documentElement.scrollWidth;
      R.videoOverflow = overflow().slice(0, 8);
      const nb2 = qa('[data-video-player] button').find((b) => b.querySelector('svg.lucide-chevron-right'));
      R.videoNextBtn = nb2 ? (() => { const r = nb2.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top),
                 inViewport: r.left >= -1 && r.right <= innerWidth + 1 }; })() : null;
      const cb = qa('[data-video-player] button').find((b) => b.querySelector('svg.lucide-x'));
      if (cb) tap(cb);
      await wait(300);
      R.videoClosed = !q('[data-video-player]');
    }
  }
  return R;
})()`;

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
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      consoleErrors.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 240));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push((m.params.exceptionDetails?.exception?.description || '?').slice(0, 240));
    }
  };
  const send = (method, params, timeout = 180000) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); rej(new Error(method + ' 超时')); } }, timeout);
  });
  await send('Runtime.enable', {});
  // 真·手机视口 + 触摸事件 + 移动 UA
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
  });
  await send('Page.enable', {});
  await send('Page.reload', { ignoreCache: true });
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (s.result?.data) {
      const p = path.join(TMP, name + '.png');
      fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
      console.log('截图: ' + p);
    }
  };
  console.log(`开始手机尺寸实测（${W}x${H}，触摸+移动 UA）…`);
  const r = await send('Runtime.evaluate', { expression: CHECK, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('异常:', JSON.stringify(r.result.exceptionDetails).slice(0, 1000));
  else console.log(JSON.stringify(r.result?.result?.value, null, 2));

  // 三个关键画面各留一张图，用眼睛复核 DOM 量不出来的问题
  const step = async (expr) => {
    const r2 = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r2.result?.exceptionDetails) console.log('步骤异常:', JSON.stringify(r2.result.exceptionDetails).slice(0, 300));
    return r2.result?.result?.value;
  };
  const WAIT = `(async (sel, ms) => { const t0 = Date.now();
    while (Date.now() - t0 < (ms || 20000)) { const e = document.querySelector(sel); if (e) return true; await new Promise(r => setTimeout(r, 200)); }
    return false; })`;
  await step("location.hash='#/'; true");
  console.log('等首页卡片:', await step(`${WAIT}('a[href*="/activity/"]', 25000)`));
  await sleep(2200); await shot('m-home');
  await step(`(async()=>{ if(!await ${WAIT}('a[href*="/activity/"]',25000)) return false; document.querySelector('a[href*="/activity/"]').click(); return true; })()`);
  console.log('等活动照片:', await step(`${WAIT}('[class*="group/img"]', 25000)`));
  await sleep(1800);
  await step(`(async()=>{ const t=document.querySelector('[class*="group/img"]'); if(!t) return false; t.click(); return true; })()`);
  console.log('等弹窗:', await step(`${WAIT}('#lightbox-img', 15000)`));
  await sleep(1800); await shot('m-lightbox');
  await step(`(async()=>{ const b=document.querySelector('button[aria-label="下一张"]'); if(!b) return false; b.click(); return true; })()`);
  await sleep(1500); await shot('m-lightbox2');
  await step("location.hash='#/videos'; true");
  console.log('等视频卡片:', await step(`${WAIT}('[data-month] div.grid > div', 25000)`));
  await sleep(1800);
  await step(`(async()=>{ const t=document.querySelector('[data-month] div.grid > div'); if(!t) return false; t.click(); return true; })()`);
  console.log('等播放器:', await step(`${WAIT}('[data-video-player]', 15000)`));
  await sleep(2500); await shot('m-video');
  await sleep(400);
  console.log('\n控制台报错/警告 (' + consoleErrors.length + '):');
  console.log(consoleErrors.slice(0, 20).join('\n') || '（无）');
  console.log('\n未捕获异常 (' + pageErrors.length + '):');
  console.log(pageErrors.slice(0, 10).join('\n') || '（无）');
} finally {
  try { ws?.close(); } catch {}
  try { execFileSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch {}
  server.close();
}