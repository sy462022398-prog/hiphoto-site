import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase/client';
import type { Tables } from '../supabase/types';
import { ArrowLeft, Calendar, Camera, Film, Play } from 'lucide-react';
import Lightbox from '../components/Lightbox';
import VideoPlayer from '../components/VideoPlayer';
import { photoThumb, photoWeb, videoHd, imageFallback } from '../lib/media-urls';

type Activity = Tables<'activities'>;
type Media = Tables<'media'>;

function MediaViewer({
  media,
  index,
  onImageClick,
  onVideoClick,
}: {
  media: Media;
  index: number;
  onImageClick: () => void;
  onVideoClick: () => void;
}) {
  if (media.media_type === 'video') {
    return (
      <div
        className="relative group/video cursor-pointer rounded-lg overflow-hidden"
        onClick={onVideoClick}
      >
        {media.thumbnail_url ? (
          <img
            src={photoThumb(media.thumbnail_url)!}
            alt={media.title || ''}
            loading={index < 6 ? 'eager' : 'lazy'}
            decoding="async"
            onError={imageFallback(media.thumbnail_url)}
            className="w-full aspect-video object-cover rounded-lg"
          />
        ) : (
          <div className="w-full aspect-video bg-gray-800 rounded-lg flex items-center justify-center">
            <Film className="w-12 h-12 text-gray-600" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/30 rounded-lg flex items-center justify-center group-hover/video:bg-black/40 transition">
          <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center group-hover/video:scale-110 transition-transform">
            <Play className="w-7 h-7 text-white ml-1" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group/img relative overflow-hidden rounded-lg cursor-pointer"
      onClick={onImageClick}
    >
      <img
        src={photoThumb(media.file_url)!}
        alt={media.title || ''}
        loading={index < 6 ? 'eager' : 'lazy'}
        decoding="async"
        onError={imageFallback(media.file_url)}
        className="w-full aspect-video object-cover transition-transform duration-500 ease-out group-hover/img:scale-105"
      />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-colors duration-300 rounded-lg pointer-events-none" />
    </div>
  );
}

export default function ActivityPage() {
  const { id } = useParams<{ id: string }>();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [mediaList, setMediaList] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [videoPlayerIndex, setVideoPlayerIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(false);
    const [actRes, mediaRes] = await Promise.all([
      supabase.from('activities').select('*').eq('id', id).single(),
      supabase
        .from('media')
        .select('*')
        .eq('activity_id', id)
        .order('created_at', { ascending: true }),
    ]);
    // 请求出错时不能显示"活动不存在"，那会把网络问题说成内容问题
    if (actRes.error && actRes.error.code !== 'PGRST116') {
      setLoadError(true);
      setLoading(false);
      return;
    }
    if (actRes.data) setActivity(actRes.data);
    if (mediaRes.data) setMediaList(mediaRes.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // 切换筛选会改变 images / videos 的下标，
  // 若弹窗还开着，原来的下标就会指到另一张图甚至越界。先关掉。
  function changeFilter(next: 'all' | 'image' | 'video') {
    setLightboxIndex(null);
    setVideoPlayerIndex(null);
    setFilter(next);
  }

  // filtered 也要 memo：它原先每次渲染都是新数组，
  // 会让下面几个依赖它的 useMemo 全部失效、白算一遍
  const filtered = useMemo(
    () => (filter === 'all' ? mediaList : mediaList.filter((m) => m.media_type === filter)),
    [mediaList, filter],
  );
  const imageCount = mediaList.filter((m) => m.media_type === 'image').length;
  const videoCount = mediaList.filter((m) => m.media_type === 'video').length;
  const images = useMemo(
    () =>
      filtered
        .filter((m) => m.media_type === 'image')
        .map((m) => ({ media: m })),
    [filtered],
  );
  const videos = useMemo(
    () =>
      filtered
        .filter((m) => m.media_type === 'video')
        .map((m) => ({
          id: m.id,
          file_url: videoHd(m.file_url)!,
          poster: photoThumb(m.thumbnail_url),
          title: m.title,
          activity_title: activity?.title || '',
          activity_date: activity?.activity_date || '',
          activity_type: activity?.activity_type || '',
        })),
    [filtered, activity],
  );
  const lightboxImages = useMemo(
    () =>
      images.map((x) => ({
        url: photoWeb(x.media.file_url)!,
        alt: x.media.title || '',
        fallback: x.media.file_url,
      })),
    [images],
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
        <p className="text-gray-400 mb-4">活动加载失败，请检查网络后重试。</p>
        <button
          onClick={load}
          className="px-5 py-2 rounded-lg bg-amber-500 text-gray-900 font-medium hover:bg-amber-400 transition"
        >
          重新加载
        </button>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-gray-500 text-lg">活动不存在</div>
      </div>
    );
  }

  const dateStr = new Date(activity.activity_date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-amber-400 transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        返回时间线
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-100">{activity.title}</h1>
        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {dateStr}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 text-xs">
            {activity.activity_type}
          </span>
        </div>
        {activity.description && (
          <p className="text-gray-400 mt-3 leading-relaxed">{activity.description}</p>
        )}
      </div>

      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => changeFilter('all')}
          className={`px-3 py-1 rounded-full text-sm transition ${
            filter === 'all' ? 'bg-amber-500 text-gray-900 font-medium' : 'bg-gray-800 text-gray-400'
          }`}
        >
          全部 ({mediaList.length})
        </button>
        <button
          onClick={() => changeFilter('image')}
          className={`px-3 py-1 rounded-full text-sm transition flex items-center gap-1 ${
            filter === 'image' ? 'bg-amber-500 text-gray-900 font-medium' : 'bg-gray-800 text-gray-400'
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          照片 ({imageCount})
        </button>
        <button
          onClick={() => changeFilter('video')}
          className={`px-3 py-1 rounded-full text-sm transition flex items-center gap-1 ${
            filter === 'video' ? 'bg-amber-500 text-gray-900 font-medium' : 'bg-gray-800 text-gray-400'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          视频 ({videoCount})
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Camera className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">暂无媒体内容</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((m, i) => {
            const imgEntry = images.find((x) => x.media.id === m.id);
            return (
              <MediaViewer
                key={m.id}
                media={m}
                index={i}
                onImageClick={() => {
                  if (imgEntry) {
                    const lightboxImgIndex = images.indexOf(imgEntry);
                    setLightboxIndex(lightboxImgIndex);
                  }
                }}
                onVideoClick={() => {
                  const vidIndex = videos.findIndex((v) => v.id === m.id);
                  if (vidIndex >= 0) setVideoPlayerIndex(vidIndex);
                }}
              />
            );
          })}
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          images={lightboxImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}

      {videoPlayerIndex !== null && (
        <VideoPlayer
          videos={videos}
          currentIndex={videoPlayerIndex}
          onClose={() => setVideoPlayerIndex(null)}
          onIndexChange={setVideoPlayerIndex}
        />
      )}
    </div>
  );
}
