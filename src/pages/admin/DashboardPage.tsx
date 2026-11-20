import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import type { Tables } from '../../supabase/types';
import { Plus, Pencil, Trash2, Camera, Film, Calendar, Loader2, Image, X, Layers, LogOut } from 'lucide-react';
import { adminLogout } from '../../components/ProtectedRoute';
import { removeMediaObjects } from '../../lib/media-pipeline';
import { photoThumb } from '../../lib/media-urls';

type Activity = Tables<'activities'>;
type Media = Tables<'media'>;

export default function DashboardPage() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [mediaCounts, setMediaCounts] = useState<Record<string, { images: number; videos: number }>>({});
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [coverActivityId, setCoverActivityId] = useState<string | null>(null);
  const [coverImages, setCoverImages] = useState<Media[]>([]);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverSetting, setCoverSetting] = useState<string | null>(null);

  async function handleLogout() {
    await adminLogout();
    navigate('/admin/login', { replace: true });
  }

  useEffect(() => {
    fetchActivities();
  }, []);

  async function fetchActivities() {
    try {
      const { data } = await supabase
        .from('activities')
        .select('*')
        .order('activity_date', { ascending: false });

      if (data && data.length > 0) {
        setActivities(data);

        // Batch fetch media counts
        const { data: mediaData } = await supabase
          .from('media')
          .select('activity_id, media_type')
          .in('activity_id', data.map((a) => a.id));

        if (mediaData) {
          const counts: Record<string, { images: number; videos: number }> = {};
          for (const m of mediaData) {
            if (!counts[m.activity_id]) {
              counts[m.activity_id] = { images: 0, videos: 0 };
            }
            if (m.media_type === 'image') {
              counts[m.activity_id].images++;
            } else {
              counts[m.activity_id].videos++;
            }
          }
          setMediaCounts(counts);
        }
      } else {
        setActivities([]);
      }
    } catch (error) {
      console.error('[DashboardPage] Failed to fetch activities:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定要删除这个活动吗？相关的所有照片和视频也会被删除。')) return;
    setDeletingId(id);

    const { data: mediaList, error: listError } = await supabase
      .from('media')
      .select('file_url, thumbnail_url, media_type')
      .eq('activity_id', id);

    if (listError) {
      alert('读取活动内的文件清单失败，已取消删除：' + listError.message);
      setDeletingId(null);
      return;
    }

    // 先删数据库记录（media 表有 ON DELETE CASCADE），确认成功后再清理文件。
    // 顺序反过来的话，一旦记录删除失败，文件已经没了、活动却还在，前台全是裂图。
    const { error } = await supabase.from('activities').delete().eq('id', id);
    if (error) {
      alert('删除失败：' + error.message);
      setDeletingId(null);
      return;
    }

    for (const m of mediaList || []) {
      try {
        await removeMediaObjects(m.file_url, m.thumbnail_url);
      } catch {
        /* 文件清理失败不影响记录已删除 */
      }
    }

    setActivities((prev) => prev.filter((a) => a.id !== id));
    setDeletingId(null);
  }

  async function openCoverPicker(activityId: string) {
    setCoverActivityId(activityId);
    setCoverLoading(true);
    const { data, error } = await supabase
      .from('media')
      .select('*')
      .eq('activity_id', activityId)
      .eq('media_type', 'image')
      .order('created_at');
    if (error) {
      alert('读取该活动的图片失败：' + error.message);
      setCoverLoading(false);
      setCoverActivityId(null);
      return;
    }
    setCoverImages(data || []);
    setCoverLoading(false);
  }

  async function handleSetCover(activityId: string, fileUrl: string) {
    setCoverSetting(fileUrl);
    // 必须检查错误：RLS 拦下更新时是静默影响 0 行，
    // 不检查就会界面显示"已设置"、数据库其实没变。
    const { error } = await supabase
      .from('activities')
      .update({ cover_url: fileUrl })
      .eq('id', activityId);
    setCoverSetting(null);
    if (error) {
      alert('设置封面失败：' + error.message);
      return;
    }
    setActivities((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, cover_url: fileUrl } : a))
    );
    setCoverActivityId(null);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-100">管理面板</h1>
          <p className="text-gray-500 mt-1">管理活动和媒体内容</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/works"
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-200 rounded-lg font-medium hover:bg-gray-700 transition border border-gray-700"
          >
            <Layers className="w-4 h-4" />
            作品管理集
          </Link>
          <Link
            to="/admin/upload"
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-gray-900 rounded-lg font-medium hover:bg-amber-400 transition"
          >
            <Plus className="w-4 h-4" />
            新建活动
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-400 rounded-lg font-medium hover:text-red-400 hover:bg-gray-700 transition border border-gray-700"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
            退出
          </button>
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-20">
          <Camera className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">还没有活动</p>
          <Link to="/admin/upload" className="text-amber-400 hover:underline mt-2 inline-block">
            创建第一个活动
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center gap-4 bg-gray-900 rounded-xl border border-gray-800 p-4 hover:border-gray-700 transition"
            >
              <div className="w-20 h-20 rounded-lg bg-gray-800 overflow-hidden flex-shrink-0">
                {activity.cover_url ? (
                  <img
                    src={photoThumb(activity.cover_url) || activity.cover_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Camera className="w-8 h-8 text-gray-700" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-gray-100 truncate">
                  {activity.title}
                </h3>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(activity.activity_date).toLocaleDateString('zh-CN')}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-800 text-xs">
                    {activity.activity_type}
                  </span>
                  {mediaCounts[activity.id] && (
                    <span className="flex items-center gap-1 text-amber-400/80 font-medium">
                      <Camera className="w-3.5 h-3.5" />
                      {mediaCounts[activity.id].images + mediaCounts[activity.id].videos} 张作品
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => openCoverPicker(activity.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-amber-400 bg-amber-400/10 hover:bg-amber-400/20 transition"
                  title="设置封面"
                >
                  <Image className="w-4 h-4" />
                  封面
                </button>
                <Link
                  to={`/admin/activity/${activity.id}`}
                  className="p-2 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-gray-800 transition"
                  title="编辑"
                >
                  <Pencil className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => handleDelete(activity.id)}
                  disabled={deletingId === activity.id}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-800 transition disabled:opacity-50"
                  title="删除"
                >
                  {deletingId === activity.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {coverActivityId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setCoverActivityId(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-100">选择封面图片</h3>
              <button
                onClick={() => setCoverActivityId(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {coverLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
              </div>
            ) : coverImages.length === 0 ? (
              <div className="text-center py-12">
                <Image className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500">该活动暂无图片</p>
                <p className="text-gray-600 text-sm mt-1">请先在编辑页面上传图片</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 max-h-80 overflow-y-auto">
                {coverImages.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => handleSetCover(coverActivityId, img.file_url)}
                    disabled={coverSetting === img.file_url}
                    className="relative aspect-video rounded-lg overflow-hidden bg-gray-800 group hover:ring-2 hover:ring-amber-400 transition disabled:opacity-50"
                  >
                    <img
                      src={photoThumb(img.file_url) || img.file_url}
                      alt={img.title || ''}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                    {coverSetting === img.file_url && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
