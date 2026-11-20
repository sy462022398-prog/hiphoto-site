import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin } from '../../components/ProtectedRoute';
import { Camera, LogIn, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setLoading(true);
    setError('');

    const result = await adminLogin(username.trim(), password);

    if (!result.ok) {
      setError(result.error || '用户名或密码错误');
      setLoading(false);
      return;
    }

    navigate('/admin', { replace: true });
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Camera className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-gray-100">后台管理</h1>
          <p className="text-gray-500 text-sm mt-1">登录管理面板</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入管理员用户名"
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 transition"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 transition"
              required
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-amber-500 text-gray-900 font-semibold hover:bg-amber-400 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            登录
          </button>
        </form>
      </div>
    </div>
  );
}
