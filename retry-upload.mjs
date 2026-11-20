import { createClient } from '@supabase/supabase-js';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import sharp from 'sharp';

const SUPABASE_URL = 'https://jush29fyenv9x5o1.database.meoo.xyz';
const SUPABASE_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3ODQ2Mjc4MDAsImV4cCI6MTMyOTUyNjc4MDB9.s1LPd84RcQOTgjhHJmfT9U-ulu7lohLTUgWI1Dlmipc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PHOTOS_DIR = '/Users/shiyun/Desktop/照片';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.m4v']);
const CONCURRENCY = 3;
const MAX_SIZE = 2 * 1024 * 1024;

function parseDateFromPath(relativePath) {
  const match = relativePath.match(/(\d{4})年\/(\d{2})月\/(\d{2})日/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function getMediaFiles(dir) {
  const files = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
        files.push({ name: entry.name, path: join(dir, entry.name), type: IMAGE_EXTS.has(ext) ? 'image' : 'video', ext });
      }
    }
  } catch {}
  return files;
}

async function getDateFolders() {
  const folders = [];
  const years = await readdir(PHOTOS_DIR);
  for (const year of years.sort()) {
    if (!year.match(/^\d{4}年$/)) continue;
    const yearPath = join(PHOTOS_DIR, year);
    if (!(await stat(yearPath)).isDirectory()) continue;
    const months = await readdir(yearPath);
    for (const month of months.sort()) {
      if (!month.match(/^\d{2}月$/)) continue;
      const monthPath = join(yearPath, month);
      if (!(await stat(monthPath)).isDirectory()) continue;
      const days = await readdir(monthPath);
      for (const day of days.sort()) {
        if (!day.match(/^\d{2}日$/)) continue;
        const dayPath = join(monthPath, day);
        if (!(await stat(dayPath)).isDirectory()) continue;
        const dateStr = parseDateFromPath(join(year, month, day));
        if (dateStr) folders.push({ date: dateStr, path: dayPath });
      }
    }
  }
  return folders.sort((a, b) => a.date.localeCompare(b.date));
}

async function compressImage(buffer, ext) {
  const meta = await sharp(buffer).metadata();
  if (buffer.length <= MAX_SIZE) return { buffer, ext };

  let out = await sharp(buffer).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  if (out.length <= MAX_SIZE) return { buffer: out, ext: '.jpg' };

  const longSide = Math.max(meta.width || 2048, meta.height || 2048);
  if (longSide > 2048) {
    const scale = 2048 / longSide;
    out = await sharp(buffer)
      .resize({ width: Math.round((meta.width || 2048) * scale), height: Math.round((meta.height || 2048) * scale) })
      .jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  }
  if (out.length <= MAX_SIZE) return { buffer: out, ext: '.jpg' };

  out = await sharp(out).jpeg({ quality: 60, mozjpeg: true }).toBuffer();
  return { buffer: out, ext: '.jpg' };
}

async function uploadFile(filePath, bucket, storagePath) {
  const rawBuffer = await readFile(filePath);
  let uploadBuffer = rawBuffer;
  let finalExt = extname(filePath);

  if (bucket === 'photos') {
    const { buffer: compressed, ext: newExt } = await compressImage(rawBuffer, finalExt);
    uploadBuffer = compressed;
    if (newExt !== finalExt) {
      finalExt = newExt;
      storagePath = storagePath.replace(/\.[^.]+$/, finalExt);
    }
    const saved = ((rawBuffer.length - uploadBuffer.length) / 1024).toFixed(0);
    if (saved > 0) process.stdout.write(`    压缩: ${(rawBuffer.length / 1024 / 1024).toFixed(1)}MB → ${(uploadBuffer.length / 1024 / 1024).toFixed(1)}MB (省${saved}KB)\n`);
  }

  const contentType = bucket === 'videos' ? 'video/mp4' : 'image/jpeg';
  const { error } = await supabase.storage.from(bucket).upload(storagePath, uploadBuffer, { contentType, upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function processBatch(items, fn, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('扫描文件夹结构...');
  const dateFolders = await getDateFolders();
  console.log(`找到 ${dateFolders.length} 个日期文件夹\n`);

  let totalMissing = 0;
  let totalUploaded = 0;
  let totalFailed = 0;

  for (const folder of dateFolders) {
    const files = await getMediaFiles(folder.path);
    if (files.length === 0) continue;

    const { data: activity } = await supabase.from('activities').select('id').eq('activity_date', folder.date).maybeSingle();
    if (!activity) continue;

    const { data: existingMedia } = await supabase.from('media').select('title').eq('activity_id', activity.id);
    const existingTitles = new Set((existingMedia || []).map(m => m.title));

    const missing = files.filter(f => !existingTitles.has(f.name.replace(/\.[^.]+$/, '')));
    if (missing.length === 0) continue;

    totalMissing += missing.length;
    console.log(`\n[${folder.date}] 缺失 ${missing.length} 个文件 (活动: ${activity.id})`);

    await processBatch(missing, async (file, i) => {
      const bucket = file.type === 'video' ? 'videos' : 'photos';
      const storagePath = `${activity.id}/${Date.now()}-${i}${file.ext}`;
      try {
        const publicUrl = await uploadFile(file.path, bucket, storagePath);
        await supabase.from('media').insert({
          activity_id: activity.id,
          media_type: file.type,
          file_url: publicUrl,
          title: file.name.replace(/\.[^.]+$/, ''),
        });
        totalUploaded++;
        process.stdout.write(`  ✓ ${file.name}\n`);
      } catch (err) {
        totalFailed++;
        console.error(`   ${file.name}: ${err.message}`);
      }
    }, CONCURRENCY);
  }

  console.log(`\n========== 重试完成 ==========`);
  console.log(`缺失文件: ${totalMissing}`);
  console.log(`成功补传: ${totalUploaded}`);
  console.log(`仍然失败: ${totalFailed}`);
}

main().catch(console.error);
