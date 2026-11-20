import { createHashRouter, RouterProvider, Outlet } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import HomePage from './pages/HomePage';
import VideoPage from './pages/VideoPage';
import ActivityPage from './pages/ActivityPage';
import LoginPage from './pages/admin/LoginPage';
import DashboardPage from './pages/admin/DashboardPage';
import ActivityEditPage from './pages/admin/ActivityEditPage';
import UploadPage from './pages/admin/UploadPage';
import WorksPage from './pages/admin/WorksPage';
import Header from './components/Header';
import ProtectedRoute from './components/ProtectedRoute';
import PasswordGate from './components/PasswordGate';
import BackToTop from './components/BackToTop';
import { Play, Pause, Volume2, VolumeX, Camera, Home, RotateCcw } from 'lucide-react';
import { BGM_URL } from './lib/media-urls';

function MusicPlayer() {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const current = audioRef.current;
    if (!current) return;
    const audio: HTMLAudioElement = current;
    audio.volume = 0.3;

    // 播放状态一律以音频元素为准，避免按钮图标和实际声音对不上
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    // 挂载即尝试播放：密码门那次点击已构成用户交互，多数浏览器会放行。
    // 若仍被自动播放策略拦下，就等下一次任意交互再试，直到成功为止。
    let unlocked = false;
    const unlockEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    function stopUnlocking() {
      unlockEvents.forEach((e) => document.removeEventListener(e, tryPlay));
    }
    function tryPlay() {
      if (unlocked) return;
      audio.play().then(() => {
        unlocked = true;
        stopUnlocking();
      }).catch(() => {});
    }
    unlockEvents.forEach((e) => document.addEventListener(e, tryPlay, { passive: true }));
    tryPlay();

    // 音频本身加载失败时得说一声，否则按钮点了没反应、也没人知道为什么
    const onError = () => {
      setFailed(true);
      setPlaying(false);
      unlocked = true;
      stopUnlocking();
    };
    audio.addEventListener('error', onError);

    // 看视频时不再暂停音乐，只把音量压低，保证背景音乐始终不断。
    // 跟着 VideoPlayer 挂的属性走，不再定时轮询 DOM。
    const syncVolume = () => {
      const target = document.body.hasAttribute('data-video-open') ? 0.06 : 0.3;
      if (audio.volume !== target) audio.volume = target;
    };
    syncVolume();
    const mo = new MutationObserver(syncVolume);
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-video-open'] });

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      stopUnlocking();
      mo.disconnect();
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    // 失败状态下这个按钮当"重试"用：重新拉一次音频
    if (failed) {
      setFailed(false);
      audio.load();
      audio.play().catch(() => {});
      return;
    }
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  return (
    <>
      <audio ref={audioRef} src={BGM_URL} loop preload="auto" />
      <div className="fixed bottom-6 left-6 z-50 flex items-center gap-3 bg-gray-950/70 backdrop-blur-xl border border-gray-700/30 rounded-full px-4 py-2.5 shadow-2xl shadow-black/40">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${playing ? 'bg-amber-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className="text-xs text-gray-400 font-medium tracking-wide whitespace-nowrap">
            {failed ? '音乐加载失败，点右侧重试' : '时间都去哪儿了'}
          </span>
        </div>
        <button
          onClick={togglePlay}
          aria-label={failed ? '重试播放背景音乐' : playing ? '暂停背景音乐' : '播放背景音乐'}
          className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center text-gray-900 hover:bg-amber-400 transition-all hover:scale-110 shadow-lg shadow-amber-500/25"
        >
          {failed ? <RotateCcw className="w-3.5 h-3.5" /> : playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
        </button>
        <button
          onClick={toggleMute}
          aria-label={muted ? '取消静音' : '静音'}
          className="w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-amber-400 transition-colors"
        >
          {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
        </button>
      </div>
    </>
  );
}

function NotFound() {
  return (
    <div className="max-w-xl mx-auto px-4 py-24 text-center">
      <Camera className="w-14 h-14 text-gray-700 mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-gray-100 mb-2">页面不存在</h1>
      <p className="text-gray-500 mb-6">这个地址没有对应的内容，可能是链接输错了。</p>
      <a
        href="#/"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 text-gray-900 font-medium hover:bg-amber-400 transition"
      >
        <Home className="w-4 h-4" />
        回到时间线
      </a>
    </div>
  );
}

function Layout() {
  return (
    <>
      <Header />
      <Outlet />
      <MusicPlayer />
      <BackToTop />
    </>
  );
}

const router = createHashRouter([
  {
    element: <PasswordGate />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/videos', element: <VideoPage /> },
          { path: '/activity/:id', element: <ActivityPage /> },
          { path: '/admin/login', element: <LoginPage /> },
          {
            path: '/admin',
            element: (
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/upload',
            element: (
              <ProtectedRoute>
                <UploadPage />
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/activity/:id',
            element: (
              <ProtectedRoute>
                <ActivityEditPage />
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/works',
            element: (
              <ProtectedRoute>
                <WorksPage />
              </ProtectedRoute>
            ),
          },
          // 兜底路由：没有它时任何错误地址都只渲染出导航栏和播放器，中间一片空白
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
