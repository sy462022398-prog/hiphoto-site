import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const envPath = join(import.meta.dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
}

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const FFMPEG = '/Users/shiyun/.npm-global/bin/ffmpeg';
const TEMP_DIR = '/tmp/hiphoto-videos';
const VIDEO_DIR = join(process.env.HOME, 'Desktop', '视频');

const DATE_TO_ACTIVITY = {
  '2018年1月13日': 'd50f2ffc-d1b6-4135-b0aa-d7294c96325d',
  '2018年1月14日': 'e5b2e276-fbfc-4c9e-81ab-bdad6d252add',
  '2019年1月14日': 'f929b752-c100-45fc-8feb-3e80f13c3ac7',
  '2022年8月5日': '51460a0c-0452-4def-a231-b59cbbe0f4d9',
  '2023年8月18日': 'af293cc7-6f4a-44d1-8432-1b5ddbbadcda',
  '2023年8月19日': '16e9eca8-ada4-4833-8271-2a9fb66ed336',
  '2025年8月8日': '390fe4c1-75d3-4c6f-bfd4-9dc0a45bea31',
};

mkdirSync(TEMP_DIR, { recursive: true });

function getFileSizeMB(filePath) {
  return statSync(filePath).size / (1024 * 1024);
}

function compressVideo(inputPath, outputPath) {
  const sizeMB = getFileSizeMB(inputPath);
  const ext = inputPath.toLowerCase().split('.').pop();
  const isLarge = sizeMB > 50;
  const isWmvOrMov = ['wmv', 'mov'].includes(ext);

  let crf = isLarge ? 32 : 28;
  let scale = isLarge ? '1280:720' : '1920:1080';
  let preset = 'medium';

  const cmd = [
    FFMPEG, '-y', '-i', `"${inputPath}"`,
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', preset,
    '-vf', `"scale=${scale}:force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2"`,
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    `"${outputPath}"`
  ].join(' ');

  console.log(`  Compressing (${sizeMB.toFixed(1)}MB, crf=${crf})...`);
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 600000 });
    const newSize = getFileSizeMB(outputPath);
    console.log(`  Done: ${newSize.toFixed(1)}MB (${((1 - newSize / sizeMB) * 100).toFixed(0)}% reduction)`);
    return true;
  } catch (err) {
    console.error(`  Compression failed: ${err.message.slice(0, 200)}`);
    return false;
  }
}

async function uploadToStorage(filePath, activityId, fileName) {
  const fileBuffer = readFileSync(filePath);
  const storagePath = `${activityId}/${fileName}`;
  const url = `${SUPABASE_URL}/storage/v1/object/videos/${storagePath}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true',
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/videos/${storagePath}`;
  console.log(`  Uploaded: ${publicUrl.slice(0, 80)}...`);
  return publicUrl;
}

async function insertMediaRecord(activityId, fileUrl) {
  const existing = await fetch(
    `${SUPABASE_URL}/rest/v1/media?activity_id=eq.${activityId}&file_url=eq.${encodeURIComponent(fileUrl)}&select=id`,
    {
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
    }
  );
  const rows = await existing.json();
  if (rows.length > 0) {
    console.log(`  Already exists in DB, skipping`);
    return;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      activity_id: activityId,
      media_type: 'video',
      file_url: fileUrl,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DB insert failed (${res.status}): ${text.slice(0, 200)}`);
  }
  console.log(`  DB record created`);
}

async function processFolder(folderName) {
  const activityId = DATE_TO_ACTIVITY[folderName];
  if (!activityId) {
    console.log(`\n⚠ No activity mapping for "${folderName}", skipping`);
    return;
  }

  const folderPath = join(VIDEO_DIR, folderName);
  const files = readdirSync(folderPath).filter(f => {
    const ext = f.toLowerCase().split('.').pop();
    return ['mp4', 'mov', 'wmv', 'avi', 'mkv', 'm4v'].includes(ext);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${folderName} → activity ${activityId.slice(0, 8)}... (${files.length} videos)`);
  console.log('='.repeat(60));

  for (let i = 0; i < files.length; i++) {
    const srcFile = files[i];
    const srcPath = join(folderPath, srcFile);
    const baseName = srcFile.replace(/\.[^.]+$/, '');
    const outName = `${baseName}.mp4`;
    const outPath = join(TEMP_DIR, `${activityId}-${outName}`);

    console.log(`\n[${i + 1}/${files.length}] ${srcFile}`);

    const ext = srcFile.toLowerCase().split('.').pop();
    const sizeMB = getFileSizeMB(srcPath);
    const needsCompression = ext !== 'mp4' || sizeMB > 50;

    let uploadPath;
    let uploadName;

    if (needsCompression) {
      const ok = compressVideo(srcPath, outPath);
      if (!ok) {
        console.log(`  Skipping (compression failed)`);
        continue;
      }
      uploadPath = outPath;
      uploadName = outName;
    } else {
      uploadPath = srcPath;
      uploadName = srcFile;
    }

    try {
      const fileUrl = await uploadToStorage(uploadPath, activityId, uploadName);
      await insertMediaRecord(activityId, fileUrl);
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }
}

async function main() {
  const folders = Object.keys(DATE_TO_ACTIVITY);
  console.log(`Processing ${folders.length} folders from ${VIDEO_DIR}`);

  for (const folder of folders) {
    await processFolder(folder);
  }

  console.log('\n✅ All folders processed!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
