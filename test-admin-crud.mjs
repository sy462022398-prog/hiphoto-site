// 后台增删改实测：登录 → 建临时活动 → 传 1 图 1 视频 → 设为封面 → 删除 → 核对记录与文件都清干净。
// 只操作本次新建的临时活动，绝不碰既有活动。无论成败，finally 里都会兜底清理。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const DIST = path.resolve('C:/Users/SY/Doubao/chats/2026-11-20/new-chat/hiphoto/dist');
const TMP = path.join(process.env.TEMP, 'hiphoto-admin');
const PORT = 8739;
const CDP = 9340;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SB = 'https://dbihymrexmgjlpjnunhl.supabase.co';
const PUB = 'sb_publishable_zM1HHW1P8pcuOTe4CmL0Ag_EB13LS-o';
const TITLE = '【自动化测试】临时活动请勿保留';
const IMG = path.join(process.env.TEMP, 'hiphoto-itest', 'tiny.jpg');
const VID = 'C:/Users/SY/Doubao/chats/2026-11-20/new-chat/optimized/videos-hd/e5b2e276-fbfc-4c9e-81ab-bdad6d252add/sd1515902923_2.MP4';

fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
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
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900',
  `http://127.0.0.1:${PORT}/`,
], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const errors = [];
const dialogs = [];
let createdId = null;
let token = null;

const HELPERS = `
window.__h = {
  q: (s) => document.querySelector(s),
  qa: (s) => Array.from(document.querySelectorAll(s)),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  until: async (fn, ms = 30000) => { const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; },
  setVal: (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  tok: () => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i);
      if (k && k.includes('auth-token')) { try { const j = JSON.parse(localStorage.getItem(k)); if (j && j.access_token) return j.access_token; } catch {} } } return null; },
  api: async (p, opt) => { const t = window.__h.tok();
    const r = await fetch('${SB}' + p, { ...(opt || {}), headers: { apikey: '${PUB}', Authorization: 'Bearer ' + (t || '${PUB}'),
      'Content-Type': 'application/json', ...((opt && opt.headers) || {}) } });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
    return { status: r.status, json: j, text: txt.slice(0, 200) }; },
};
true`;

async function main() {
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
  const send = (method, params, timeout = 180000) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); rej(new Error(method + ' 超时')); } }, timeout);
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.type + ': ' + String(m.params.message).slice(0, 160));
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails?.exception?.description || '?').slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console: ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    }
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  await send('Runtime.enable', {}); await send('Page.enable', {}); await send('DOM.enable', {});
  await ev(HELPERS);
  const R = {};

  // 1) 前台密码门
  await ev(`(async()=>{const h=window.__h;const i=await h.until(()=>h.q('input[type=password]'));
    h.setVal(i,'aihaipai');await h.wait(120);h.q('form button[type=submit]').click();return true;})()`);
  await ev(`(async()=>{const h=window.__h;return !!(await h.until(()=>h.q('a[href*="/activity/"]')));})()`);

  // 2) 管理员登录
  await ev("location.hash='#/admin/login'; true");
  R.loggedIn = await ev(`(async()=>{const h=window.__h;
    const u=await h.until(()=>h.q('input[placeholder="输入管理员用户名"]'));if(!u)return 'no-form';
    h.setVal(u,'shiyun');h.setVal(h.q('input[placeholder="输入密码"]'),'shiyun960210');
    await h.wait(150);h.q('form button[type=submit]').click();
    const ok=await h.until(()=>location.hash.includes('/admin')&&!location.hash.includes('login'),25000);
    return ok?true:('stuck:'+location.hash);})()`);
  token = await ev('window.__h.tok()');
  R.gotToken = !!token;
  if (R.loggedIn !== true) { console.log(JSON.stringify(R, null, 2)); return R; }

  // 3) 上传页：填表 + 塞文件
  await ev("location.hash='#/admin/upload'; true");
  R.formReady = await ev(`(async()=>{const h=window.__h;
    const t=await h.until(()=>h.q('input[placeholder="例如：秋日外拍 - 西湖边"]'));if(!t)return false;
    h.setVal(t,${JSON.stringify(TITLE)});
    const d=h.q('input[type=date]');if(d)h.setVal(d,new Date().toISOString().slice(0,10));
    return true;})()`);
  const files = [IMG];
  if (fs.existsSync(VID)) files.push(VID);
  R.filesToUpload = files.map((f) => path.basename(f));
  const doc = await send('DOM.getDocument', { depth: -1 });
  const inp = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' });
  if (!inp.result?.nodeId) throw new Error('找不到文件输入框');
  await send('DOM.setFileInputFiles', { nodeId: inp.result.nodeId, files });
  R.filesPicked = await ev(`(async()=>{const h=window.__h;await h.wait(600);
    return (h.q('input[type=file]').files||[]).length;})()`);

  // 4) 提交并等上传完成
  R.submitResult = await ev(`(async()=>{const h=window.__h;
    const btns=h.qa('button[type=submit]');const b=btns[btns.length-1];if(!b)return 'no-submit';
    b.click();
    const done=await h.until(()=>!location.hash.includes('/admin/upload'),150000);
    return done?('left-upload:'+location.hash):('still-upload:'+(document.body.textContent||'').slice(0,200));})()`);

  // 5) 从数据库确认这次建的活动与媒体
  const found = await ev(`(async()=>{const h=window.__h;
    const r=await h.api('/rest/v1/activities?title=eq.'+encodeURIComponent(${JSON.stringify(TITLE)})+'&select=id,title,cover_url');
    return r.json;})()`);
  R.activityRows = Array.isArray(found) ? found.length : found;
  if (!Array.isArray(found) || found.length === 0) { console.log(JSON.stringify(R, null, 2)); return R; }
  createdId = found[0].id;
  R.createdId = createdId;
  R.coverSetOnUpload = !!found[0].cover_url;
  const media = await ev(`(async()=>{const r=await window.__h.api('/rest/v1/media?activity_id=eq.${createdId}&select=id,media_type,file_url,thumbnail_url,title');return r.json;})()`);
  R.mediaRows = Array.isArray(media) ? media.map((m) => ({ type: m.media_type, title: m.title,
    bucket: (m.file_url.split('/public/')[1] || '').split('/')[0], hasThumb: !!m.thumbnail_url })) : media;

  // 6) 产物真的能取到、能解码
  R.assetsOk = await ev(`(async()=>{const h=window.__h;
    const r=await h.api('/rest/v1/media?activity_id=eq.${createdId}&select=file_url,thumbnail_url,media_type');
    const out=[];for(const m of (r.json||[])){
      for(const u of [m.file_url,m.thumbnail_url]){ if(!u) continue;
        if(m.media_type==='video'&&u===m.file_url){ const rr=await fetch(u,{headers:{Range:'bytes=0-0'}});
          out.push({kind:'video',status:rr.status,range:rr.headers.get('content-range')}); continue; }
        const d=await new Promise((res)=>{const im=new Image();im.onload=()=>res({w:im.naturalWidth,h:im.naturalHeight});im.onerror=()=>res(null);im.src=u;});
        out.push({kind:'image',url:u.split('/public/')[1],decoded:d}); } }
    return out;})()`);

  // 7) 编辑页「设为封面」
  await ev(`location.hash='#/admin/activity/${createdId}'; true`);
  R.setCover = await ev(`(async()=>{const h=window.__h;
    const b=await h.until(()=>h.qa('button').find(x=>(x.textContent||'').includes('设为封面')),20000);
    if(!b) return 'no-button';
    const before=(await h.api('/rest/v1/activities?id=eq.${createdId}&select=cover_url')).json[0].cover_url;
    b.click(); await h.wait(2500);
    const after=(await h.api('/rest/v1/activities?id=eq.${createdId}&select=cover_url')).json[0].cover_url;
    return { changed: before!==after, afterBucket:(after||'').split('/public/')[1]||null };})()`);

  // 8) 回后台删除（confirm 自动接受）
  await ev("location.hash='#/admin'; true");
  R.deleted = await ev(`(async()=>{const h=window.__h;
    const ok=await h.until(()=>h.qa('*').some(e=>(e.textContent||'').includes(${JSON.stringify(TITLE)})),20000);
    if(!ok) return 'not-listed';
    // 必须按活动 id 精确定位：先找指向该活动编辑页的链接，再向上找到含删除按钮的那一层。
    // 绝不能用"页面上最后一个删除按钮"兜底——那会删到别的活动。
    const link=h.q('a[href*="/admin/activity/${createdId}"]');
    if(!link) return 'no-edit-link-for-this-id';
    let node=link, btn=null;
    for(let i=0;i<8&&node;i++){
      const cands=Array.from(node.querySelectorAll('button[title="删除"]'));
      if(cands.length===1){ btn=cands[0]; break; }
      if(cands.length>1) return 'ambiguous-scope';
      node=node.parentElement;
    }
    if(!btn) return 'no-delete-button-in-scope';
    btn.click();
    await h.wait(7000);
    const r=await h.api('/rest/v1/activities?id=eq.${createdId}&select=id');
    const all=await h.api('/rest/v1/activities?select=id');
    return { rowsLeft:(r.json||[]).length, totalActivities:(all.json||[]).length };})()`);

  // 9) 存储里是否还有这次活动的残留
  R.storageLeft = await ev(`(async()=>{const h=window.__h;const out={};
    for(const b of ['photos','photos-thumb','photos-web','videos-hd']){
      const r=await h.api('/storage/v1/object/list/'+b,{method:'POST',body:JSON.stringify({prefix:'${createdId}',limit:100})});
      out[b]=Array.isArray(r.json)?r.json.map(o=>o.name):r.status; }
    const m=await h.api('/rest/v1/media?activity_id=eq.${createdId}&select=id');
    out.mediaRowsLeft=(m.json||[]).length; return out;})()`);
  return R;
}

try {
  const R = await main();
  console.log('===== 后台增删改实测 =====');
  console.log(JSON.stringify(R, null, 2));
  console.log('\n弹窗记录:\n' + (dialogs.join('\n') || '（无）'));
  console.log('\n报错 (' + errors.length + '):\n' + (errors.slice(0, 12).join('\n') || '（无）'));
} catch (e) {
  console.log('测试中断: ' + (e && e.message));
} finally {
  // 兜底：只要建过活动，就确保记录和文件都清掉
  if (createdId && ws) {
    try {
      const n = ++id;
      const cleanup = `(async()=>{const h=window.__h;
        const m=await h.api('/rest/v1/media?activity_id=eq.${createdId}&select=file_url,thumbnail_url');
        const keys={};for(const r of (m.json||[])){for(const u of [r.file_url,r.thumbnail_url]){if(!u)continue;
          const p=u.split('/public/')[1];if(!p)continue;const i=p.indexOf('/');const b=p.slice(0,i),k=p.slice(i+1);
          (keys[b]=keys[b]||[]).push(k);
          if(b==='photos-web'||b==='photos-thumb'){const o=b==='photos-web'?'photos-thumb':'photos-web';(keys[o]=keys[o]||[]).push(k);} }}
        const del=await h.api('/rest/v1/activities?id=eq.${createdId}',{method:'DELETE'});
        const res={deleteStatus:del.status};
        for(const b of Object.keys(keys)){ const r=await h.api('/storage/v1/object/'+b,{method:'DELETE',body:JSON.stringify({prefixes:[...new Set(keys[b])]})}); res[b]=r.status; }
        const left=await h.api('/rest/v1/activities?id=eq.${createdId}&select=id'); res.rowsLeft=(left.json||[]).length;
        return res;})()`;
      const p = new Promise((res) => pending.set(n, res));
      ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: cleanup, awaitPromise: true, returnByValue: true } }));
      const r = await Promise.race([p, sleep(45000).then(() => null)]);
      console.log('\n兜底清理: ' + JSON.stringify(r?.result?.result?.value ?? r?.result?.exceptionDetails ?? '超时'));
    } catch (e2) { console.log('兜底清理异常: ' + e2.message); }
  }
  try { ws?.close(); } catch {}
  try { execFileSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch {}
  server.close();
}