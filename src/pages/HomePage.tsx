import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase/client';
import type { Tables } from '../supabase/types';
import { Calendar, Camera, Film, ChevronRight } from 'lucide-react';
import { photoThumb, imageFallback } from '../lib/media-urls';

type Activity = Tables<'activities'>;

const TYPE_LABELS: Record<string, string> = {
  '外拍': '外拍',
  '聚会': '聚会',
  '比赛': '比赛',
  '讲座': '讲座',
  '其他': '其他',
};

const TYPE_COLORS: Record<string, string> = {
  '外拍': 'bg-emerald-500/20 text-emerald-400',
  '聚会': 'bg-blue-500/20 text-blue-400',
  '比赛': 'bg-orange-500/20 text-orange-400',
  '讲座': 'bg-purple-500/20 text-purple-400',
  '其他': 'bg-gray-500/20 text-gray-400',
};

function groupByMonth(activities: Activity[]) {
  const groups: Record<string, Activity[]> = {};
  for (const a of activities) {
    const d = new Date(a.activity_date);
    const key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  }
  return Object.entries(groups).sort((a, b) => {
    const [ay, am] = a[0].match(/\d+/g)!.map(Number);
    const [by, bm] = b[0].match(/\d+/g)!.map(Number);
    return by * 12 + bm - (ay * 12 + am);
  });
}

function ActivityCard({ activity, mediaCount, index }: { activity: Activity; mediaCount: { images: number; videos: number }; index: number }) {
  const dateStr = new Date(activity.activity_date).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
  });

  return (
    <Link
      to={`/activity/${activity.id}`}
      className="group block rounded-xl overflow-hidden border border-gray-800/60 bg-gradient-to-b from-gray-900 to-gray-900/80 shadow-lg shadow-black/20 hover:border-amber-500/40 hover:shadow-xl hover:shadow-amber-900/10 transition-all duration-500"
    >
      <div className="aspect-video bg-gray-800 relative overflow-hidden">
        {activity.cover_url ? (
          <img
            src={photoThumb(activity.cover_url)!}
            alt={activity.title}
            loading={index < 4 ? 'eager' : 'lazy'}
            decoding="async"
            onError={imageFallback(activity.cover_url)}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className="w-12 h-12 text-gray-700" />
          </div>
        )}
        <div className="absolute top-3 left-3">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              TYPE_COLORS[activity.activity_type] || TYPE_COLORS['其他']
            }`}
          >
            {TYPE_LABELS[activity.activity_type] || activity.activity_type}
          </span>
        </div>
      </div>
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-100 group-hover:text-amber-400 transition-colors">
          {activity.title}
        </h3>
        {activity.description && (
          <p className="text-sm text-gray-400 mt-1 line-clamp-2">{activity.description}</p>
        )}
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {dateStr}
            </span>
            {mediaCount.images > 0 && (
              <span className="flex items-center gap-1">
                <Camera className="w-3.5 h-3.5" />
                {mediaCount.images}
              </span>
            )}
            {mediaCount.videos > 0 && (
              <span className="flex items-center gap-1">
                <Film className="w-3.5 h-3.5" />
                {mediaCount.videos}
              </span>
            )}
          </div>
          <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-amber-400 transition-colors" />
        </div>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [mediaCounts, setMediaCounts] = useState<Record<string, { images: number; videos: number }>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string>('全部');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .order('activity_date', { ascending: false });

    // 请求失败要和"真的没有活动"区分开，否则网络一抖就显示"还没有活动记录"
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    if (data) {
      setActivities(data);
      const { data: mediaData } = await supabase
        .from('media')
        .select('activity_id, media_type')
        .in('activity_id', data.map((a) => a.id));
      if (mediaData) {
        const counts: Record<string, { images: number; videos: number }> = {};
        for (const m of mediaData) {
          if (!counts[m.activity_id]) counts[m.activity_id] = { images: 0, videos: 0 };
          if (m.media_type === 'image') counts[m.activity_id].images++;
          else if (m.media_type === 'video') counts[m.activity_id].videos++;
        }
        setMediaCounts(counts);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // memo 掉：这几个数组原先每次渲染都是新引用，会让依赖它们的 effect 反复重跑
  const groups = useMemo(() => groupByMonth(activities), [activities]);

  const years = useMemo(
    () =>
      Array.from(new Set(activities.map((a) => new Date(a.activity_date).getFullYear().toString())))
        .sort((a, b) => Number(b) - Number(a)),
    [activities],
  );

  const filteredGroups = useMemo(
    () =>
      selectedYear === '全部'
        ? groups
        : groups.filter(([month]) => month.startsWith(selectedYear + '年')),
    [groups, selectedYear],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-center py-32">
        <p className="text-gray-400 mb-4">内容加载失败，请检查网络后重试。</p>
        <button
          onClick={load}
          className="px-5 py-2 rounded-lg bg-amber-500 text-gray-900 font-medium hover:bg-amber-400 transition"
        >
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 pb-20">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold text-gray-100 tracking-wider mb-3">回忆时间线</h1>
        <p className="text-gray-500 text-lg">记录每一次快门的精彩瞬间</p>
      </div>

      {filteredGroups.length === 0 ? (
        <div className="text-center py-20">
          <Camera className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">还没有活动记录</p>
          <Link to="/admin/upload" className="text-amber-400 hover:underline mt-2 inline-block">
            去上传第一个活动
          </Link>
        </div>
      ) : (
        <>
          {years.length > 1 && (
            <div className="flex items-center justify-center mb-10">
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="px-4 py-2 rounded-lg bg-gray-800/60 border border-gray-700/50 text-gray-200 text-sm focus:outline-none focus:border-amber-500/50 cursor-pointer appearance-none pr-8"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
              >
                <option value="全部">全部年份</option>
                {years.map((year) => (
                  <option key={year} value={year}>{year}年</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-8">
            <div className="flex-1">
              {filteredGroups.map(([month, items]) => (
                <div key={month} data-month={month} className="mb-12">
                  <div className="flex items-center gap-4 mb-6">
                    <h2 className="text-2xl font-bold text-amber-400 tracking-wide">{month}</h2>
                    <div className="flex-1 h-px bg-gradient-to-r from-amber-500/30 to-transparent" />
                    <span className="text-xs text-gray-500 font-medium">{items.length} 个活动</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {items.map((a, i) => (
                      <ActivityCard
                        key={a.id}
                        activity={a}
                        mediaCount={mediaCounts[a.id] || { images: 0, videos: 0 }}
                        index={i}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
