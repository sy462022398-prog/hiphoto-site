import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase/client';
import { Film, Calendar, Play, ChevronRight } from 'lucide-react';
import VideoPlayer from '../components/VideoPlayer';
import { videoHd, photoThumb, imageFallback } from '../lib/media-urls';

interface VideoItem {
  id: string;
  activity_id: string;
  file_url: string;
  thumbnail_url: string | null;
  title: string | null;
  created_at: string;
  activity_title: string;
  activity_date: string;
  activity_type: string;
}

const TYPE_COLORS: Record<string, string> = {
  '外拍': 'bg-emerald-500/20 text-emerald-400',
  '聚会': 'bg-blue-500/20 text-blue-400',
  '比赛': 'bg-orange-500/20 text-orange-400',
  '讲座': 'bg-purple-500/20 text-purple-400',
  '其他': 'bg-gray-500/20 text-gray-400',
};

function groupByMonth(videos: VideoItem[]) {
  const groups: Record<string, VideoItem[]> = {};
  for (const v of videos) {
    const d = new Date(v.activity_date);
    const key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  }
  return Object.entries(groups).sort((a, b) => {
    const [ay, am] = a[0].match(/\d+/g)!.map(Number);
    const [by, bm] = b[0].match(/\d+/g)!.map(Number);
    return by * 12 + bm - (ay * 12 + am);
  });
}

function VideoCard({ video, index, onPlay }: { video: VideoItem; index: number; onPlay: () => void }) {
  const [hovered, setHovered] = useState(false);
  const poster = photoThumb(video.thumbnail_url);

  const dateStr = new Date(video.activity_date).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
  });

  // 默认只加载封面图；鼠标悬停时才挂载 video 元素，
  // 避免整页 58 个视频同时预加载元数据拖慢首屏。
  // 触屏设备没有真正的悬停：点一下会触发模拟 mouseenter，
  // 若照常挂载预览视频，就会在播放弹窗背后偷偷下载整段视频且停不下来。
  const canHover =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const handleMouseEnter = () => {
    if (canHover) setHovered(true);
  };
  const handleMouseLeave = () => setHovered(false);
  const handleClick = () => {
    setHovered(false); // 打开弹窗前先停掉预览，避免两路视频同时下载
    onPlay();
  };

  return (
    <div
      className="group block rounded-xl overflow-hidden border border-gray-800/60 bg-gradient-to-b from-gray-900 to-gray-900/80 shadow-lg shadow-black/20 hover:border-amber-500/40 hover:shadow-xl hover:shadow-amber-900/10 transition-all duration-500 cursor-pointer"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div className="aspect-video bg-gray-800 relative overflow-hidden">
        {poster ? (
          <img
            src={poster}
            alt={video.title || video.activity_title}
            loading={index < 6 ? 'eager' : 'lazy'}
            decoding="async"
            onError={imageFallback(video.thumbnail_url)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="w-12 h-12 text-gray-600" />
          </div>
        )}
        {hovered && (
          <video
            src={videoHd(video.file_url)!}
            autoPlay
            muted
            playsInline
            loop
            preload="auto"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {!hovered && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center group-hover:bg-white/30 transition-all group-hover:scale-110">
              <Play className="w-7 h-7 text-white ml-1" />
            </div>
          </div>
        )}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[video.activity_type] || TYPE_COLORS['其他']}`}>
            {video.activity_type}
          </span>
        </div>
        <div className="absolute top-3 right-3">
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-black/50 text-gray-300 backdrop-blur-sm">
            <Film className="w-3 h-3" />
            视频
          </span>
        </div>
      </div>
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-100 group-hover:text-amber-400 transition-colors">
          {video.activity_title}
        </h3>
        {video.title && (
          <p className="text-sm text-gray-400 mt-1 truncate">{video.title}</p>
        )}
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {dateStr}
          </span>
          <Link
            to={`/activity/${video.activity_id}`}
            className="flex items-center gap-1 text-amber-400/70 hover:text-amber-400 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            查看全部
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VideoPage() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [playerIndex, setPlayerIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data: mediaData, error } = await supabase
      .from('media')
      .select('id, activity_id, file_url, thumbnail_url, title, created_at')
      .eq('media_type', 'video')
      .order('created_at', { ascending: true });

    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    if (!mediaData || mediaData.length === 0) {
      setVideos([]);
      setLoading(false);
      return;
    }

    const activityIds = [...new Set(mediaData.map((m) => m.activity_id))];
    const { data: activities } = await supabase
      .from('activities')
      .select('id, title, activity_date, activity_type')
      .in('id', activityIds);

    const actMap = new Map((activities || []).map((a) => [a.id, a]));

    const videoItems: VideoItem[] = mediaData
      .map((m) => {
        const act = actMap.get(m.activity_id);
        return {
          ...m,
          activity_title: act?.title || '未知活动',
          activity_date: act?.activity_date || m.created_at,
          activity_type: act?.activity_type || '其他',
        };
      })
      .sort((a, b) => new Date(b.activity_date).getTime() - new Date(a.activity_date).getTime());

    setVideos(videoItems);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // memo 掉：否则每次渲染都是新数组，滚动监听器会被反复销毁重建
  const groups = useMemo(() => groupByMonth(videos), [videos]);

  // 播放列表也 memo 掉，避免每次渲染都给 VideoPlayer 传一个新数组
  const playerVideos = useMemo(
    () => videos.map((v) => ({ ...v, file_url: videoHd(v.file_url)!, poster: photoThumb(v.thumbnail_url) })),
    [videos],
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
        <p className="text-gray-400 mb-4">视频列表加载失败，请检查网络后重试。</p>
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
        <div className="flex items-center justify-center gap-3 mb-3">
          <Film className="w-8 h-8 text-amber-400" />
          <h1 className="text-4xl font-bold text-gray-100 tracking-wider">视频回忆</h1>
        </div>
        <p className="text-gray-500 text-lg">重温每一段珍贵的影像记忆</p>
        {videos.length > 0 && (
          <p className="text-gray-600 text-sm mt-2">共 {videos.length} 个视频</p>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-20">
          <Film className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">还没有视频记录</p>
        </div>
      ) : (
        <div className="flex gap-8">
          <div className="flex-1">
            {groups.map(([month, items]) => (
              <div key={month} data-month={month} className="mb-12">
                <div className="flex items-center gap-4 mb-6">
                  <h2 className="text-2xl font-bold text-amber-400 tracking-wide">{month}</h2>
                  <div className="flex-1 h-px bg-gradient-to-r from-amber-500/30 to-transparent" />
                  <span className="text-xs text-gray-500 font-medium">{items.length} 个视频</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {items.map((v) => {
                    const flatIndex = videos.findIndex((x) => x.id === v.id);
                    return (
                      <VideoCard key={v.id} video={v} index={flatIndex} onPlay={() => setPlayerIndex(flatIndex)} />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {playerIndex !== null && (
        <VideoPlayer
          videos={playerVideos}
          currentIndex={playerIndex}
          onClose={() => setPlayerIndex(null)}
          onIndexChange={setPlayerIndex}
        />
      )}
    </div>
  );
}
