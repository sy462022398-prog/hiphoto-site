import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { removeMediaObjects } from '../../lib/media-pipeline';
import { photoThumb } from '../../lib/media-urls';
import type { Tables } from '../../supabase/types';
import { Image, Film, Trash2, Loader2, Calendar, Filter, X } from 'lucide-react';

type Media = Tables<'media'>;
type Activity = Tables<'activities'>;

export default function WorksPage() {
  const [works, setWorks] = useState<Media[]>([]);
  const [activities, setActivities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video'>('all');
  const [filterActivity, setFilterActivity] = useState<string>('all');

  useEffect(() => {
    fetchWorks();
    fetchActivities();
  }, []);

  async function fetchWorks() {
    setLoadError(false);
    const { data, error } = await supabase
      .from('media')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    if (data) setWorks(data);
    setLoading(false);
  }

  async function fetchActivities() {
    const { data } = await supabase
      .from('activities')
      .select('id, title');
    if (data) {
      const map: Record<string, string> = {};
      for (const a of data) {
        map[a.id] = a.title;
      }
      setActivities(map);
    }
  }

  async function handleDelete(id: string, _mediaType: string, fileUrl: string, thumbnailUrl?: string | null) {
    if (!confirm('确定要删除这个作品吗？')) return;
    setDeletingId(id);

    // 先删记录再清文件，并检查是否真的删掉了，避免"界面消失、数据库还在"
    const { error } = await supabase.from('media').delete().eq('id', id);
    if (error) {
      alert('删除失败：' + error.message);
      setDeletingId(null);
      return;
    }
    try {
      await removeMediaObjects(fileUrl, thumbnailUrl);
    } catch {
      /* 文件清理失败不影响记录已删除 */
    }
    setWorks((prev) => prev.filter((w) => w.id !== id));
    setDeletingId(null);
  }

  const filteredWorks = works.filter((w) => {
    if (filterType !== 'all' && w.media_type !== filterType) return false;
    if (filterActivity !== 'all' && w.activity_id !== filterActivity) return false;
    return true;
  });

  const imageCount = works.filter((w) => w.media_type === 'image').length;
  const videoCount = works.filter((w) => w.media_type === 'video').length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-100">作品管理集</h1>
          <p className="text-gray-500 mt-1">
            共 {works.length} 个作品 · {imageCount} 张图片 · {videoCount} 个视频
          </p>
        </div>
        <Link
          to="/admin/upload"
          className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-gray-900 rounded-lg font-medium hover:bg-amber-400 transition"
        >
          <Image className="w-4 h-4" />
          上传作品
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-1 border border-gray-800">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              filterType === 'all'
                ? 'bg-amber-500 text-gray-900'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => setFilterType('image')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              filterType === 'image'
                ? 'bg-amber-500 text-gray-900'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Image className="w-3.5 h-3.5" />
            图片
          </button>
          <button
            onClick={() => setFilterType('video')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              filterType === 'video'
                ? 'bg-amber-500 text-gray-900'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            视频
          </button>
        </div>

        <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-1.5 border border-gray-800">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={filterActivity}
            onChange={(e) => setFilterActivity(e.target.value)}
            className="bg-transparent text-sm text-gray-300 focus:outline-none cursor-pointer"
          >
            <option value="all">所有活动</option>
            {Object.entries(activities).map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
          {filterActivity !== 'all' && (
            <button
              onClick={() => setFilterActivity('all')}
              className="text-gray-500 hover:text-gray-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="text-center py-20">
          <p className="text-gray-400 mb-4">作品列表加载失败，请检查网络后重试。</p>
          <button
            onClick={() => { setLoading(true); fetchWorks(); }}
            className="px-5 py-2 rounded-lg bg-amber-500 text-gray-900 font-medium hover:bg-amber-400 transition"
          >
            重新加载
          </button>
        </div>
      ) : filteredWorks.length === 0 ? (
        <div className="text-center py-20">
          <Image className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">暂无作品</p>
          <Link to="/admin/upload" className="text-amber-400 hover:underline mt-2 inline-block">
            上传第一个作品
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredWorks.map((work) => (
            <div
              key={work.id}
              className="group relative aspect-square rounded-xl overflow-hidden bg-gray-900 border border-gray-800 hover:border-amber-500/40 transition-all"
            >
              {work.media_type === 'image' ? (
                <img
                  src={photoThumb(work.file_url) || work.file_url}
                  alt={work.title || ''}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : work.thumbnail_url ? (
                <img
                  src={photoThumb(work.thumbnail_url) || work.thumbnail_url}
                  alt={work.title || ''}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-800">
                  <Film className="w-12 h-12 text-gray-600" />
                </div>
              )}

              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  {work.title && (
                    <p className="text-sm text-white font-medium truncate mb-1">{work.title}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-300">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {activities[work.activity_id] || '未知活动'}
                    </span>
                    <button
                      onClick={() => handleDelete(work.id, work.media_type, work.file_url, work.thumbnail_url)}
                      disabled={deletingId === work.id}
                      className="p-1.5 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/40 transition disabled:opacity-50"
                      title="删除"
                    >
                      {deletingId === work.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Type badge */}
              <div className="absolute top-2 left-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    work.media_type === 'image'
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-purple-500/20 text-purple-400'
                  }`}
                >
                  {work.media_type === 'image' ? '图片' : '视频'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
