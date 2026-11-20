import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';

// 后台登录改由 Supabase Auth 服务端校验。
// 用户名沿用 shiyun，内部映射为 shiyun@hiphoto.local，密码不变。
const EMAIL_DOMAIN = 'hiphoto.local';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) setState(data.session ? 'in' : 'out');
      })
      .catch(() => {
        // 不接这个 catch 的话，取会话失败就永远停在"校验登录状态…"
        if (alive) setState('out');
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? 'in' : 'out');
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-gray-500">校验登录状态…</div>
      </div>
    );
  }

  if (state === 'out') {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

export async function adminLogin(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const email = `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = /invalid login credentials/i.test(error.message)
      ? '用户名或密码错误'
      : error.message;
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export async function adminLogout(): Promise<void> {
  await supabase.auth.signOut();
}
