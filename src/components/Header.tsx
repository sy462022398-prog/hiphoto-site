import { Link, useLocation } from 'react-router-dom';
import { Home, Camera, Film, Settings } from 'lucide-react';

export default function Header() {
  const location = useLocation();
  const isVideo = location.pathname === '/videos';

  return (
    <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur-md border-b border-gray-800/50">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <Camera className="w-5 h-5 text-amber-400 shrink-0" />
          {/* 手机上品牌全名加三个带文字的导航放不下，会挤成两行，故小屏只留简称 */}
          <span className="text-amber-400 font-bold text-base tracking-wider truncate">
            <span className="hidden sm:inline">嗨拍摄影俱乐部</span>
            <span className="sm:hidden">嗨拍</span>
          </span>
        </Link>
        <nav className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <Link
            to="/"
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition ${
              !isVideo
                ? 'bg-gray-800 text-amber-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Home className="w-4 h-4 shrink-0" />
            <span>时间线</span>
          </Link>
          <Link
            to="/videos"
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm transition ${
              isVideo
                ? 'bg-gray-800 text-amber-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Film className="w-4 h-4 shrink-0" />
            <span>视频</span>
          </Link>
          <Link
            to="/admin"
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 transition"
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span>管理</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
