import { useEffect, useCallback, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Calendar, Film } from 'lucide-react';

interface VideoEntry {
  id: string;
  file_url: string;
  title: string | null;
  activity_title: string;
  activity_date: string;
  activity_type: string;
  poster?: string | null;
}

interface VideoPlayerProps {
  videos: VideoEntry[];
  currentIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

const TYPE_COLORS: Record<string, string> = {
  '外拍': 'bg-emerald-500/20 text-emerald-400',
  '聚会': 'bg-blue-500/20 text-blue-400',
  '比赛': 'bg-orange-500/20 text-orange-400',
  '讲座': 'bg-purple-500/20 text-purple-400',
  '其他': 'bg-gray-500/20 text-gray-400',
};

export default function VideoPlayer({ videos, currentIndex, onClose, onIndexChange }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const video = videos[currentIndex];
  const hasMultiple = videos.length > 1;

  const goNext = useCallback(() => {
    if (currentIndex < videos.length - 1) onIndexChange(currentIndex + 1);
  }, [currentIndex, videos.length, onIndexChange]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onIndexChange(currentIndex - 1);
  }, [currentIndex, onIndexChange]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // 焦点落在视频控件上时，左右键是快退/快进，不能被抢去翻页
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'VIDEO' ||
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    }
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [onClose, goPrev, goNext]);

  // 跟着视频本身走，而不是下标：筛选变了但下标没变时，
  // 旧的"加载失败"遮罩会盖在一个其实正常的新视频上。
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [video?.id]);

  // 挂个标记告诉背景音乐"现在有视频在放"，让它压低音量。
  // 用属性变化通知，省掉全站每 300 毫秒一次的轮询。
  useEffect(() => {
    document.body.setAttribute('data-video-open', '1');
    return () => {
      document.body.removeAttribute('data-video-open');
    };
  }, []);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  if (!video) return null;

  const dateStr = new Date(video.activity_date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      data-video-player
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="flex items-center justify-between px-6 py-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${TYPE_COLORS[video.activity_type] || TYPE_COLORS['其他']}`}>
            {video.activity_type}
          </span>
          <h2 className="text-lg font-semibold text-gray-100 truncate">{video.activity_title}</h2>
          <span className="hidden sm:flex items-center gap-1 text-sm text-gray-500 shrink-0">
            <Calendar className="w-3.5 h-3.5" />
            {dateStr}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {hasMultiple && (
            <span className="text-sm text-gray-500">{currentIndex + 1} / {videos.length}</span>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* relative：翻页按钮要贴着画面区域定位，而不是整个屏幕 */}
      <div
        className="relative flex-1 flex items-center justify-center px-6 pb-4 min-h-0"
        onClick={handleBackdropClick}
      >
        {hasMultiple && (
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        <div className="w-full max-w-5xl aspect-video relative" onClick={(e) => e.stopPropagation()}>
          {!loaded && !failed && !video.poster && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-10 h-10 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
            </div>
          )}
          {/* 加载失败必须给说法，否则没有封面时会一直转圈 */}
          {failed && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-gray-950/90 rounded-lg px-6 text-center">
              <Film className="w-10 h-10 text-gray-600" />
              <p className="text-gray-300">这个视频暂时放不出来</p>
              <p className="text-gray-500 text-sm">可能是网络中断，或浏览器不支持该视频格式。</p>
              <button
                onClick={() => {
                  setFailed(false);
                  setLoaded(false);
                  const el = videoRef.current;
                  if (el) {
                    el.load();
                    el.play().catch(() => {});
                  }
                }}
                className="mt-1 px-4 py-2 rounded-lg bg-amber-500 text-gray-900 text-sm font-medium hover:bg-amber-400 transition"
              >
                重试
              </button>
            </div>
          )}
          <video
            ref={videoRef}
            key={video.id}
            src={video.file_url}
            poster={video.poster || undefined}
            controls
            autoPlay
            playsInline
            preload="auto"
            onLoadedData={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className="w-full h-full object-contain rounded-lg"
          />
        </div>

        {hasMultiple && (
          <button
            onClick={goNext}
            disabled={currentIndex === videos.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {video.title && (
        <div className="px-6 pb-4 flex items-center gap-2 text-sm text-gray-500 shrink-0">
          <Film className="w-4 h-4" />
          <span className="truncate">{video.title}</span>
        </div>
      )}
    </div>
  );
}
