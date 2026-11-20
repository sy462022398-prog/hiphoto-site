import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { uploadMedia, removeMediaObjects, guessMediaType } from '../../lib/media-pipeline';
import { photoThumb } from '../../lib/media-urls';
import FilePreview from '../../components/FilePreview';
import type { Tables } from '../../supabase/types';
import {
  ArrowLeft, Save, Upload, Trash2, Image, Film, Loader2, X,
} from 'lucide-react';

type Activity = Tables<'activities'>;
type Media = Tables<'media'>;

const ACTIVITY_TYPES = ['外拍', '聚会', '比赛', '讲座', '其他'];

export default function ActivityEditPage() {
  const { id } = useParams<{ id: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activity, setActivity] = useState<Activity | null>(null);
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [activityType, setActivityType] = useState('外拍');
  const [activityDate, setActivityDate] = useState('');

  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!id) return;
      const [actRes, mediaRes] = await Promise.all([
        supabase.from('activities').select('*').eq('id', id).single(),
        supabase.from('media').select('*').eq('activity_id', id).order('created_at'),
      ]);
      if (actRes.data) {
        setActivity(actRes.data);
        setTitle(actRes.data.title);
        setDescription(actRes.data.description || '');
        setActivityType(actRes.data.activity_type);
        setActivityDate(actRes.data.activity_date);
      }
      if (mediaRes.data) setMediaList(mediaRes.data);
      setLoading(false);
    }
    fetchData();
  }, [id]);

  async function handleSaveActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    setSavedTip(false);

    const patch = {
      title: title.trim(),
      description: description.trim(),
      activity_type: activityType,
      activity_date: activityDate,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('activities').update(patch).eq('id', id);

    if (error) {
      alert('保存失败: ' + error.message);
    } else {
      // 同步本地状态，否则页面标题等处还是旧值
      setActivity((prev) => (prev ? { ...prev, ...patch } : prev));
      setSavedTip(true);
      setTimeout(() => setSavedTip(false), 2500);
    }
    setSaving(false);
  }

  async function handleSetCover(media: Media) {
    if (!id) return;
    // 原来是发出去就不管了：失败时界面照样显示"当前封面"，库里其实没改
    const { error } = await supabase
      .from('activities')
      .update({ cover_url: media.file_url })
      .eq('id', id);
    if (error) {
      alert('设置封面失败：' + error.message);
      return;
    }
    setActivity((prev) => (prev ? { ...prev, cover_url: media.file_url } : null));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    setNewFiles((prev) => [...prev, ...Array.from(files)]);
    e.target.value = '';
  }

  const getMediaType = guessMediaType;

  async function handleUploadFiles() {
    if (!id || newFiles.length === 0) return;
    setUploading(true);

    const notes: string[] = [];
    let coverSet = !!activity?.cover_url;
    let done = 0;

    // 中途失败时把已成功的文件从待传列表里去掉，
    // 否则再点一次"开始上传"会把它们重传一遍，产生重复作品。
    const stop = (reason: string) => {
      setNewFiles((prev) => prev.slice(done));
      alert(`${reason}\n\n已成功上传 ${done} 个，未上传的文件仍留在列表里，可处理后继续。`);
      setUploading(false);
      setUploadProgress('');
    };

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      setUploadProgress(`处理 ${i + 1}/${newFiles.length}: ${file.name}`);

      let result;
      try {
        result = await uploadMedia(file, id, i, (msg) =>
          setUploadProgress(`${i + 1}/${newFiles.length} ${file.name} · ${msg}`),
        );
      } catch (err) {
        stop(`第 ${i + 1} 个文件「${file.name}」上传失败：${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      if (result.note) notes.push(`${file.name}：${result.note}`);

      const { data: newMedia, error: insError } = await supabase
        .from('media')
        .insert({
          activity_id: id,
          media_type: result.mediaType,
          file_url: result.fileUrl,
          thumbnail_url: result.thumbnailUrl || '',
          title: file.name.replace(/\.[^.]+$/, ''),
        })
        .select()
        .single();

      if (insError || !newMedia) {
        // 文件已进存储但记录没写成，清掉以免留下无人引用的孤儿文件
        try {
          await removeMediaObjects(result.fileUrl, result.thumbnailUrl);
        } catch {
          /* 清理失败就算了，不影响提示 */
        }
        stop(`第 ${i + 1} 个文件写入记录失败：${insError?.message || '未知错误'}`);
        return;
      }

      setMediaList((prev) => [...prev, newMedia]);
      done = i + 1;

      if (!coverSet) {
        const cover = result.mediaType === 'image' ? result.fileUrl : result.thumbnailUrl;
        if (cover) {
          await supabase.from('activities').update({ cover_url: cover }).eq('id', id);
          setActivity((prev) => (prev ? { ...prev, cover_url: cover } : null));
          coverSet = true;
        }
      }
    }

    if (notes.length) alert('已上传，但有提示：\n' + notes.join('\n'));
    setNewFiles([]);
    setUploading(false);
    setUploadProgress('');
  }

  async function handleDeleteMedia(media: Media) {
    if (!confirm('确定删除这个文件？')) return;
    setDeletingMediaId(media.id);

    // 先删记录再清文件（原图/视频与派生的缩略图、展示版、视频封面一并清理），
    // 并检查是否真的删掉了，避免"界面消失、数据库还在"
    const { error } = await supabase.from('media').delete().eq('id', media.id);
    if (error) {
      alert('删除失败：' + error.message);
      setDeletingMediaId(null);
      return;
    }
    try {
      await removeMediaObjects(media.file_url, media.thumbnail_url);
    } catch {
      /* 文件清理失败不影响记录已删除 */
    }
    setMediaList((prev) => prev.filter((m) => m.id !== media.id));
    setDeletingMediaId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-gray-500">活动不存在</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        to="/admin"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-amber-400 transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        返回管理面板
      </Link>

      <h1 className="text-2xl font-bold text-gray-100 mb-6">编辑活动</h1>

      <form onSubmit={handleSaveActivity} className="space-y-4 mb-10">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">活动名称</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-amber-500 transition"
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
                <option key={t} value={t}>{t}</option>
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
            rows={3}
            className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:border-amber-500 transition resize-none"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2 bg-amber-500 text-gray-900 rounded-lg font-medium hover:bg-amber-400 disabled:opacity-50 transition"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存修改
        </button>
        {savedTip && <span className="ml-3 text-sm text-emerald-400">已保存</span>}
      </form>

      <div className="border-t border-gray-800 pt-8">
        <h2 className="text-xl font-bold text-gray-100 mb-4">
          媒体文件 ({mediaList.length})
        </h2>

        <div
          onClick={() => {
            // 上传中禁止追加：stop() 用 slice(done) 裁剪待传列表，
            // 中途加长会让裁剪位置错位，导致漏传或重传
            if (!uploading) fileInputRef.current?.click();
          }}
          className={`border-2 border-dashed border-gray-700 rounded-lg p-6 text-center transition mb-4 ${
            uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-amber-500/50'
          }`}
        >
          <Upload className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">点击选择照片或视频追加到此活动</p>
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

        {newFiles.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">待上传: {newFiles.length} 个文件</span>
              <div className="flex gap-2">
                <button
                  onClick={() => { if (!uploading) setNewFiles([]); }}
                  disabled={uploading}
                  className="text-sm text-gray-500 hover:text-gray-300 transition disabled:opacity-40"
                >
                  清空
                </button>
                <button
                  onClick={handleUploadFiles}
                  disabled={uploading}
                  className="flex items-center gap-1 px-3 py-1 bg-amber-500 text-gray-900 rounded-lg text-sm font-medium hover:bg-amber-400 disabled:opacity-50 transition"
                >
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {uploading ? uploadProgress : '开始上传'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {newFiles.map((file, i) => (
                <div key={i} className="relative group aspect-square bg-gray-800 rounded-lg overflow-hidden">
                  {getMediaType(file) === 'image' ? (
                    <FilePreview file={file} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-6 h-6 text-gray-600" />
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (uploading) return;
                      setNewFiles((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {mediaList.length === 0 ? (
          <div className="text-center py-12">
            <Image className="w-12 h-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">暂无媒体文件</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {mediaList.map((m) => (
              <div key={m.id} className="relative group aspect-video bg-gray-800 rounded-lg overflow-hidden">
                {m.media_type === 'image' ? (
                  <img src={photoThumb(m.file_url) || m.file_url} alt={m.title || ''} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                ) : m.thumbnail_url ? (
                  <img src={photoThumb(m.thumbnail_url) || m.thumbnail_url} alt={m.title || ''} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-10 h-10 text-gray-600" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center gap-2">
                  {m.media_type === 'image' && (
                    <button
                      onClick={() => handleSetCover(m)}
                      className={`px-2 py-1 rounded text-xs font-medium transition ${
                        activity?.cover_url === m.file_url
                          ? 'bg-amber-500 text-gray-900'
                          : 'bg-gray-700/80 text-gray-200 hover:bg-amber-500 hover:text-gray-900'
                      }`}
                    >
                      {activity?.cover_url === m.file_url ? '当前封面' : '设为封面'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteMedia(m)}
                    disabled={deletingMediaId === m.id}
                    className="p-2 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition disabled:opacity-50"
                  >
                    {deletingMediaId === m.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="absolute bottom-1 left-1">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-black/60 text-gray-300">
                    {m.media_type === 'image' ? (
                      <Image className="w-3 h-3 inline" />
                    ) : (
                      <Film className="w-3 h-3 inline" />
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
