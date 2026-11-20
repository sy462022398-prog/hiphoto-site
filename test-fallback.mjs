// 用 esbuild 把真实的 media-urls.ts 编出来，直接测 imageFallback 的兜底链
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = 'C:/Users/SY/Doubao/chats/2026-11-20/new-chat/hiphoto';
const out = path.join(root, '.fbtest.mjs');
await build({
  entryPoints: [path.join(root, 'src/lib/media-urls.ts')],
  outfile: out,
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'error',
});
const m = await import(pathToFileURL(out).href);
const { imageFallback, photoThumb, photoWeb } = m;

const B = 'https://dbihymrexmgjlpjnunhl.supabase.co/storage/v1/object/public';
const A = '390fe4c1-75d3-4c6f-bfd4-9dc0a45bea31';

// 模拟一个 img：src 被赋值成"取不到"的地址就再次触发 onError
function run(original, initialSrc, available, label) {
  const tried = [];
  const img = { dataset: {}, src: initialSrc };
  const handler = imageFallback(original);
  for (let i = 0; i < 12; i++) {
    tried.push(img.src);
    if (available.includes(img.src)) {
      return { label, ok: true, landed: img.src, tried };
    }
    const before = img.src;
    handler({ currentTarget: img });
    if (img.src === before) break; // 兜底链走完
  }
  return { label, ok: false, landed: null, tried };
}

const cases = [];

// 1. 历史照片：原图桶已空，缩略图坏了应落到展示版
{
  const orig = `${B}/photos/${A}/old.jpg`;
  cases.push(run(orig, photoThumb(orig), [photoWeb(orig)], '历史照片·缩略图坏→展示版'));
}
// 2. 历史照片：两个压缩版都在，缩略图正常，不该触发任何跳转
{
  const orig = `${B}/photos/${A}/old.jpg`;
  cases.push(run(orig, photoThumb(orig), [photoThumb(orig)], '历史照片·缩略图正常'));
}
// 3. 压缩失败存了原图的 HEIC：两个 webp 都不存在，必须落到原图
{
  const orig = `${B}/photos/${A}/pic.heic`;
  cases.push(run(orig, photoThumb(orig), [orig], 'HEIC·两个压缩版都缺→原图'));
}
// 4. 新上传的正常图片：主地址就是展示版，缩略图坏→展示版
{
  const orig = `${B}/photos-web/${A}/new.webp`;
  cases.push(run(orig, photoThumb(orig), [photoWeb(orig)], '新图片·缩略图坏→展示版'));
}
// 5. 灯箱：展示版坏→缩略图
{
  const orig = `${B}/photos-web/${A}/new.webp`;
  cases.push(run(orig, photoWeb(orig), [photoThumb(orig)], '新图片·展示版坏→缩略图'));
}
// 6. 全都取不到：必须停下，不能无限循环
{
  const orig = `${B}/photos/${A}/gone.jpg`;
  cases.push(run(orig, photoThumb(orig), [], '全缺·应终止不死循环'));
}
// 7. 视频封面：只存在于 thumb，不该去 photos-web 白跑
{
  const orig = `${B}/photos-thumb/${A}/clip-poster.webp`;
  cases.push(run(orig, photoThumb(orig), [], '视频封面·不去web白跑'));
}
// 8. 视频封面正常
{
  const orig = `${B}/photos-thumb/${A}/clip-poster.webp`;
  cases.push(run(orig, photoThumb(orig), [orig], '视频封面·正常'));
}

let fail = 0;
for (const c of cases) {
  const short = (u) => (u ? u.replace(B + '/', '') : 'null');
  const expectStop = c.label.includes('应终止') || c.label.includes('白跑');
  const pass = expectStop ? !c.ok && c.tried.length <= 4 : c.ok;
  if (!pass) fail++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.label}`);
  console.log(`      尝试顺序: ${c.tried.map(short).join('  →  ')}`);
  if (c.landed) console.log(`      最终落在: ${short(c.landed)}`);
}
// 第7例只应尝试封面自己一次，不该出现 photos-web
const posterCase = cases[6];
const wentToWeb = posterCase.tried.some((u) => u.includes('/photos-web/'));
console.log(`${wentToWeb ? 'FAIL' : 'PASS'}  视频封面未请求 photos-web`);
if (wentToWeb) fail++;

console.log(`\n合计 ${cases.length + 1} 项，失败 ${fail}`);
fs.unlinkSync(out);
process.exit(fail ? 1 : 0);