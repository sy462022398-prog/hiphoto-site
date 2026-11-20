import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

/**
 * 回到顶部悬浮按钮。
 * 放在右下角，避开左下角的音乐播放器；z-40 低于灯箱与视频弹窗（z-100），
 * 全屏看图时不会挡住画面。滚动超过一屏的一半才出现。
 */
export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.6);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="回到顶部"
      title="回到顶部"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={`fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full flex items-center justify-center
        bg-gray-950/70 backdrop-blur-xl border border-gray-700/30 text-amber-400
        shadow-2xl shadow-black/40 transition-all duration-300
        hover:bg-amber-500 hover:text-gray-900 hover:scale-110
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}`}
    >
      <ArrowUp className="w-5 h-5" />
    </button>
  );
}