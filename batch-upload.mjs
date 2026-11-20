import { createClient } from '@supabase/supabase-js';
import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createReadStream } from 'node:fs';
import sharp from 'sharp';

const SUPABASE_URL = 'https://jush29fyenv9x5o1.database.meoo.xyz';
const SUPABASE_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3ODQ2Mjc4MDAsImV4cCI6MTMyOTUyNjc4MDB9.s1LPd84RcQOTgjhHJmfT9U-ulu7lohLTUgWI1Dlmipc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PHOTOS_DIR = '/Users/shiyun/Desktop/照片';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.m4v']);
const CONCURRENCY = 3;

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
        files.push({
          name: entry.name,
          path: join(dir, entry.name),
          type: IMAGE_EXTS.has(ext) ? 'image' : 'video',
          ext,
        });
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
    const yearStat = await stat(yearPath);
    if (!yearStat.isDirectory()) continue;

    const months = await readdir(yearPath);
    for (const month of months.sort()) {
      if (!month.match(/^\d{2}月$/)) continue;
      const monthPath = join(yearPath, month);
      const monthStat = await stat(monthPath);
      if (!monthStat.isDirectory()) continue;

      const days = await readdir(monthPath);
      for (const day of days.sort()) {
        if (!day.match(/^\d{2}日$/)) continue;
        const dayPath = join(monthPath, day);
        const dayStat = await stat(dayPath);
        if (!dayStat.isDirectory()) continue;

        const dateStr = parseDateFromPath(join(year, month, day));
        if (dateStr) {
          folders.push({ date: dateStr, path: dayPath });
        }
      }
    }
  }

  return folders.sort((a, b) => a.date.localeCompare(b.date));
}

const MAX_SIZE = 2 * 1024 * 1024;

async function compressImage(buffer, ext) {
  let img = sharp(buffer);
  const meta = await img.metadata();

  if (buffer.length <= MAX_SIZE) return { buffer, ext };

  img = sharp(buffer).jpeg({ quality: 80, mozjpeg: true });
  let out = await img.toBuffer();

  if (out.length <= MAX_SIZE) return { buffer: out, ext: '.jpg' };

  const longSide = Math.max(meta.width || 2048, meta.height || 2048);
  if (longSide > 2048) {
    const scale = 2048 / longSide;
    img = sharp(buffer)
      .resize({ width: Math.round((meta.width || 2048) * scale), height: Math.round((meta.height || 2048) * scale) })
      .jpeg({ quality: 80, mozjpeg: true });
    out = await img.toBuffer();
  }

  if (out.length <= MAX_SIZE) return { buffer: out, ext: '.jpg' };

  out = await sharp(out).jpeg({ quality: 60, mozjpeg: true }).toBuffer();
  return { buffer: out, ext: '.jpg' };
}

async function uploadFile(filePath, bucket, storagePath) {
  const rawBuffer = await import('node:fs/promises').then(fs => fs.readFile(filePath));

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
  const { error } = await supabase.storage.from(bucket).upload(storagePath, uploadBuffer, {
    contentType,
    upsert: false,
  });
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

  let totalFiles = 0;
  let totalUploaded = 0;
  let totalFailed = 0;

  for (const folder of dateFolders) {
    const files = await getMediaFiles(folder.path);
    if (files.length === 0) continue;

    totalFiles += files.length;
    console.log(`\n[${folder.date}] ${files.length} 个文件`);

    const { data: existingActivity } = await supabase
      .from('activities')
      .select('id')
      .eq('activity_date', folder.date)
      .maybeSingle();

    let activityId;
    if (existingActivity) {
      activityId = existingActivity.id;
      console.log(`  活动已存在: ${activityId}`);
    } else {
      const { data: activity, error } = await supabase
        .from('activities')
        .insert({
          title: `${folder.date} 拍摄`,
          activity_type: '外拍',
          activity_date: folder.date,
        })
        .select()
        .single();

      if (error) {
        console.error(`  创建活动失败: ${error.message}`);
        continue;
      }
      activityId = activity.id;
      console.log(`  创建活动: ${activityId}`);
    }

    let coverUrl = '';

    await processBatch(files, async (file, i) => {
      const bucket = file.type === 'video' ? 'videos' : 'photos';
      const storagePath = `${activityId}/${Date.now()}-${i}${file.ext}`;

      try {
        const publicUrl = await uploadFile(file.path, bucket, storagePath);

        await supabase.from('media').insert({
          activity_id: activityId,
          media_type: file.type,
          file_url: publicUrl,
          title: file.name.replace(/\.[^.]+$/, ''),
        });

        if (i === 0 && file.type === 'image') {
          coverUrl = publicUrl;
        }

        totalUploaded++;
        process.stdout.write(`  ✓ ${file.name}\n`);
      } catch (err) {
        totalFailed++;
        console.error(`  ✗ ${file.name}: ${err.message}`);
      }
    }, CONCURRENCY);

    if (coverUrl) {
      await supabase.from('activities').update({ cover_url: coverUrl }).eq('id', activityId);
    }

    console.log(`  进度: ${totalUploaded}/${totalFiles} 已上传`);
  }

  console.log(`\n========== 上传完成 ==========`);
  console.log(`总文件: ${totalFiles}`);
  console.log(`成功: ${totalUploaded}`);
  console.log(`失败: ${totalFailed}`);
}

main().catch(console.error);
