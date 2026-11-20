import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Lock } from 'lucide-react';

const PASSWORD = 'aihaipai';
const STORAGE_KEY = 'hiphoto_unlocked';

// Auto-unlock in development for easier testing
const isDev = import.meta.env.DEV;

export default function PasswordGate() {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [unlocked, setUnlocked] = useState(
    () => isDev || sessionStorage.getItem(STORAGE_KEY) === '1',
  );

  if (unlocked) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <Outlet />
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === PASSWORD) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      // 不能整页刷新：刷新后浏览器会认为"本文档没有用户交互"，
      // 背景音乐的自动播放会被重新拦下。直接切状态即可保留这次点击授权。
      setUnlocked(true);
    } else {
      setError(true);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gray-800 flex items-center justify-center">
          <Lock className="w-8 h-8 text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold mb-2 text-amber-400">嗨拍摄影俱乐部</h1>
        <p className="text-gray-400 mb-8 text-sm">请输入访问密码</p>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          placeholder="访问密码"
          autoFocus
          className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 mb-4"
        />
        {error && <p className="text-red-400 text-sm mb-4">密码错误，请重试</p>}
        <button
          type="submit"
          className="w-full py-3 rounded-lg bg-amber-500 text-gray-900 font-semibold hover:bg-amber-400 transition-colors"
        >
          进入
        </button>
      </form>
    </div>
  );
}
