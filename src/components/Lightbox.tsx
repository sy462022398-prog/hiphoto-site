import { useEffect, useCallback, useState, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, RotateCcw, ZoomIn } from 'lucide-react';
import { imageFallback } from '../lib/media-urls';

interface LightboxProps {
  images: { url: string; alt?: string; fallback?: string }[];
  currentIndex: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

export default function Lightbox({ images, currentIndex, onClose, onIndexChange }: LightboxProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });
  const touchStart = useRef({ x: 0, y: 0, time: 0 });
  const touchDelta = useRef({ x: 0, y: 0 });
  const pinchStart = useRef({ distance: 0, scale: 1, cx: 0, cy: 0, posX: 0, posY: 0 });
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [useTransition, setUseTransition] = useState(false);
  const reboundTimer = useRef(0);

  // 手指松开但没到翻页门槛时，把图片弹回原位（只有这一种情况才有动效）
  const rebound = useCallback(() => {
    setUseTransition(true);
    setSwipeOffset(0);
    clearTimeout(reboundTimer.current);
    reboundTimer.current = window.setTimeout(() => setUseTransition(false), 350);
  }, []);

  useEffect(() => () => clearTimeout(reboundTimer.current), []);

  const image = images[currentIndex];
  const hasMultiple = images.length > 1;

  const resetView = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // 翻页不做任何滑动动效：直接换图并复位缩放，点下去立刻生效。
  const navigateTo = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= images.length) return;
      setUseTransition(false);
      setSwipeOffset(0);
      onIndexChange(nextIndex);
      resetView();
    },
    [images.length, onIndexChange, resetView],
  );

  const goNext = useCallback(() => navigateTo(currentIndex + 1), [currentIndex, navigateTo]);
  const goPrev = useCallback(() => navigateTo(currentIndex - 1), [currentIndex, navigateTo]);

  // 预加载相邻几张，点下一张时通常已在浏览器缓存里，不必再等网络。
  useEffect(() => {
    for (const i of [currentIndex + 1, currentIndex + 2, currentIndex - 1]) {
      const item = images[i];
      if (!item) continue;
      const preloader = new Image();
      preloader.src = item.url;
    }
  }, [currentIndex, images]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
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

  useEffect(() => {
    resetView();
  }, [currentIndex, resetView]);

  function handleWheel(e: React.WheelEvent) {
    // React 的 onWheel 是 passive 监听，preventDefault 无效且会报错；
    // 弹窗已锁 body 滚动，本来也不需要拦。
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale((prev) => {
      const next = Math.min(5, Math.max(1, prev + delta));
      if (next <= 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = position;
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isDragging) return;
    setPosition({
      x: posStart.current.x + (e.clientX - dragStart.current.x),
      y: posStart.current.y + (e.clientY - dragStart.current.y),
    });
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  function getTouchDistance(t1: React.Touch, t2: React.Touch) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      pinchStart.current = {
        distance: getTouchDistance(t1, t2),
        scale,
        cx: (t1.clientX + t2.clientX) / 2,
        cy: (t1.clientY + t2.clientY) / 2,
        posX: position.x,
        posY: position.y,
      };
      setUseTransition(false);
      return;
    }

    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    touchDelta.current = { x: 0, y: 0 };
    if (scale <= 1) {
      setUseTransition(false);
      setSwipeOffset(0);
    } else {
      setIsDragging(true);
      dragStart.current = { x: t.clientX, y: t.clientY };
      posStart.current = position;
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      // 同上：touchmove 也是 passive，靠容器的 touchAction:none 阻止浏览器缩放
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = getTouchDistance(t1, t2);
      const ps = pinchStart.current;
      if (ps.distance === 0) return;

      const newScale = Math.min(5, Math.max(1, ps.scale * (dist / ps.distance)));
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;

      setScale(newScale);
      if (newScale <= 1) {
        setPosition({ x: 0, y: 0 });
      } else {
        setPosition({
          x: ps.posX + (cx - ps.cx) * (1 - ps.scale / newScale),
          y: ps.posY + (cy - ps.cy) * (1 - ps.scale / newScale),
        });
      }
      return;
    }

    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchDelta.current = { x: dx, y: dy };

    if (scale <= 1) {
      setSwipeOffset(dx);
    } else if (isDragging) {
      setPosition({
        x: posStart.current.x + (t.clientX - dragStart.current.x),
        y: posStart.current.y + (t.clientY - dragStart.current.y),
      });
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length === 1 && pinchStart.current.distance > 0) {
      const t = e.touches[0];
      touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
      touchDelta.current = { x: 0, y: 0 };
      if (scale > 1) {
        setIsDragging(true);
        dragStart.current = { x: t.clientX, y: t.clientY };
        posStart.current = position;
      }
      pinchStart.current.distance = 0;
      return;
    }

    if (e.touches.length !== 0) return;

    if (pinchStart.current.distance > 0) {
      pinchStart.current.distance = 0;
      if (scale <= 1) {
        setPosition({ x: 0, y: 0 });
      }
      return;
    }

    if (scale <= 1) {
      const dx = touchDelta.current.x;
      const dy = touchDelta.current.y;
      const elapsed = Date.now() - touchStart.current.time;
      const velocity = Math.abs(dx) / elapsed;

      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && (velocity > 0.3 || Math.abs(dx) > 100)) {
        if (dx < 0 && currentIndex < images.length - 1) {
          navigateTo(currentIndex + 1);
        } else if (dx > 0 && currentIndex > 0) {
          navigateTo(currentIndex - 1);
        } else {
          rebound();
        }
      } else {
        rebound();
      }
    }
    setIsDragging(false);
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  // 光标本来就是 zoom-in，双击必须真有反应，否则是个骗人的手势提示
  function handleDoubleClick(e: React.MouseEvent) {
    if (scale > 1) {
      resetView();
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - (rect.left + rect.width / 2);
    const cy = e.clientY - (rect.top + rect.height / 2);
    const next = 2.5;
    setUseTransition(false);
    setScale(next);
    // 让双击的那一点留在原地，而不是被放大推到画面外
    setPosition({ x: -cx * (next - 1), y: -cy * (next - 1) });
  }

  if (!image) return null;

  const transformValue =
    scale === 1 && swipeOffset === 0 && position.x === 0 && position.y === 0
      ? undefined
      : `translate3d(${position.x + swipeOffset}px, ${position.y}px, 0) scale(${scale})`;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm overflow-hidden"
      onClick={handleBackdropClick}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
      >
        <X className="w-5 h-5" />
      </button>

      {hasMultiple && (
        <>
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            aria-label="上一张"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 w-11 h-11 sm:w-10 sm:h-10 flex items-center justify-center rounded-full bg-black/45 sm:bg-white/10 hover:bg-white/25 text-white transition disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={goNext}
            disabled={currentIndex === images.length - 1}
            aria-label="下一张"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 w-11 h-11 sm:w-10 sm:h-10 flex items-center justify-center rounded-full bg-black/45 sm:bg-white/10 hover:bg-white/25 text-white transition disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      <div
        className="relative max-w-[90vw] max-h-[85vh] select-none"
        style={{ touchAction: 'none', cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          id="lightbox-img"
          key={image.url}
          src={image.url}
          alt={image.alt || ''}
          onError={imageFallback(image.fallback)}
          className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg pointer-events-none"
          draggable={false}
          style={{
            transform: transformValue,
            transition: useTransition ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none',
            willChange: useTransition ? 'transform' : undefined,
          }}
        />
      </div>

      <div className="absolute bottom-6 left-6 flex items-center gap-3 z-10">
        <button
          onClick={resetView}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition"
        >
          <RotateCcw className="w-4 h-4" />
          重置
        </button>
        <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-sm">
          <ZoomIn className="w-4 h-4" />
          {Math.round(scale * 100)}%
        </div>
      </div>

      {hasMultiple && (
        <div className="absolute top-5 left-4 sm:top-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 text-white/60 text-sm z-10">
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>
  );
}
