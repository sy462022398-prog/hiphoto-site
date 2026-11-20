import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { uploadMedia, removeMediaObjects, guessMediaType } from '../../lib/media-pipeline';
import FilePreview from '../../components/FilePreview';
import VideoCoverPicker from '../../components/VideoCoverPicker';
import { Upload, Image, Film, Plus, X, Loader2 } from 'lucide-react';

const ACTIVITY_TYPES = ['外拍', '聚会', '比赛', '讲座', '其他'];

export default function UploadPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [activityType, setActivityType] = useState('外拍');
  const [activityDate, setActivityDate] = useState(new Date().toISOString().slice(0, 10));
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  // 每个视频选定的封面秒数；没选过的视频仍走自动封面
  const [posterTimes, setPosterTimes] = useState<Map<File, number>>(new Map());
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList) return;
    const newFiles = Array.from(fileList);
    setFiles((prev) => [...prev, ...newFiles]);
    e.target.value = '';
  }

  function removeFile(index: number) {
    if (uploading) return;
    const removed = files[index];
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPosterTimes((prev) => {
      if (!prev.has(removed)) return prev;
      const next = new Map(prev);
      next.delete(removed);
      return next;
    });
  }

  const getMediaType = guessMediaType;

  function handleClose() {
    if (uploading) return;
    if (files.length > 0 && !window.confirm('还没有上传，确定关闭吗？已选的文件不会被保存。')) return;
    navigate('/admin');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || files.length === 0) return;

    setUploading(true);
    setProgress('创建活动...');

    const { data: activity, error: actError } = await supabase
      .from('activities')
      .insert({
        title: title.trim(),
        description: description.trim(),
        activity_type: activityType,
        activity_date: activityDate,
      })
      .select()
      .single();

    if (actError || !activity) {
      alert('创建活动失败: ' + (actError?.message || ''));
      setUploading(false);
      return;
    }

    let coverUrl = '';
    const notes: string[] = [];
    const act = activity;

    // 中途失败时不能停在创建表单：再点一次会再建一个同名活动。
    // 改为保存已有进度并跳到该活动的编辑页，在那里继续补传。
    async function abortToEdit(done: number, reason: string) {
      if (coverUrl) {
        await supabase.from('activities').update({ cover_url: coverUrl }).eq('id', act.id);
      }
      alert(
        `${reason}\n\n活动「${act.title}」已创建，前 ${done} 个文件已保存。\n现在跳转到活动编辑页，可在那里继续补传剩余文件。`,
      );
      setUploading(false);
      navigate(`/admin/activity/${act.id}`);
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`处理 ${i + 1}/${files.length}: ${file.name}`);

      let result;
      try {
        result = await uploadMedia(
          file,
          activity.id,
          i,
          (msg) => setProgress(`${i + 1}/${files.length} ${file.name} · ${msg}`),
          posterTimes.get(file),
        );
      } catch (err) {
        await abortToEdit(
          i,
          `第 ${i + 1} 个文件「${file.name}」上传失败：${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      if (result.note) notes.push(`${file.name}：${result.note}`);
      if (!coverUrl) {
        // 纯视频活动以前没封面，首页只能显示占位图标；现在用视频封面兜上
        coverUrl = result.mediaType === 'image' ? result.fileUrl : result.thumbnailUrl || '';
      }

      const { error: insError } = await supabase.from('media').insert({
        activity_id: activity.id,
        media_type: result.mediaType,
        file_url: result.fileUrl,
        thumbnail_url: result.thumbnailUrl || '',
        title: file.name.replace(/\.[^.]+$/, ''),
      });

      if (insError) {
        // 文件已进存储但记录没写成，清掉以免留下白占额度的孤儿文件
        try {
          await removeMediaObjects(result.fileUrl, result.thumbnailUrl);
        } catch {
          /* 清理失败就算了，不影响提示 */
        }
        await abortToEdit(i, `第 ${i + 1} 个文件写入记录失败：${insError.message}`);
        return;
      }
    }

    if (coverUrl) {
      await supabase.from('activities').update({ cover_url: coverUrl }).eq('id', activity.id);
    }

    if (notes.length) alert('已上传，但有提示：\n' + notes.join('\n'));

    setProgress('完成!');
    setUploading(false);
    navigate(`/activity/${activity.id}`);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-100 mb-2">上传活动</h1>
          <p className="text-gray-500">记录一次新的摄影活动</p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          disabled={uploading}
          aria-label="关闭"
          title="关闭，返回管理面板"
          className="shrink-0 p-2 rounded-full bg-gray-900 border border-gray-700 text-gray-400 hover:text-gray-100 hover:border-gray-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">活动名称</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：秋日外拍 - 西湖边"
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 transition"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">活动类型</label>
            <select
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-amber-500 transition"
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">活动日期</label>
            <input
              type="date"
              value={activityDate}
              onChange={(e) => setActivityDate(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-amber-500 transition"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">活动描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="记录这次活动的精彩瞬间..."
            rows={3}
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 transition resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            照片和视频
          </label>
          <div
            onClick={() => {
              // 上传中不能再往列表里加文件：循环用的是提交时那一份快照，
              // 新加的文件不会被上传，却会在跳转后静默丢失
              if (!uploading) fileInputRef.current?.click();
            }}
            className={`border-2 border-dashed border-gray-700 rounded-lg p-8 text-center transition ${
              uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-amber-500/50'
            }`}
          >
            <Upload className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">点击选择照片或视频文件</p>
            <p className="text-gray-600 text-sm mt-1">支持 JPG、PNG、MP4、MOV 等格式</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={uploading}
            accept="image/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-gray-400">
              已选择 {files.length} 个文件
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {files.map((file, i) => (
                <div key={i} className="relative group aspect-square bg-gray-800 rounded-lg overflow-hidden">
                  {getMediaType(file) === 'image' ? (
                    <FilePreview file={file} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-8 h-8 text-gray-600" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  >
                    <X className="w-3.5 h-3.5 text-white" />
                  </button>
                  <div className="absolute bottom-1 left-1">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-black/60 text-gray-300">
                      {getMediaType(file) === 'image' ? (
                        <Image className="w-3 h-3 inline" />
                      ) : (
                        <Film className="w-3 h-3 inline" />
                      )}
                    </span>
                  </div>
                  {getMediaType(file) === 'video' && (
                    <button
                      type="button"
                      onClick={() => { if (!uploading) setPickerIndex(i); }}
                      className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-xs text-gray-300 hover:bg-amber-500 hover:text-gray-900 transition"
                    >
                      {posterTimes.has(file) ? `封面 ${posterTimes.get(file)!.toFixed(1)}s` : '选封面'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={uploading || !title.trim() || files.length === 0}
          className="w-full py-3 rounded-lg bg-amber-500 text-gray-900 font-semibold hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {progress}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              发布活动
            </>
          )}
        </button>
      </form>

      {pickerIndex !== null && files[pickerIndex] && (
        <VideoCoverPicker
          file={files[pickerIndex]}
          value={posterTimes.get(files[pickerIndex])}
          onChange={(t) => {
            const f = files[pickerIndex];
            setPosterTimes((prev) => new Map(prev).set(f, t));
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
}
