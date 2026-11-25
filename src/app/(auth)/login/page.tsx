'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  ACTIVE_EMAIL_KEY,
  ACTIVE_HOUSEHOLD_KEY,
  ACTIVE_USER_KEY,
} from '@/offline/sync/pull';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    try {
      const supabase = createSupabaseBrowserClient();
      void supabase.auth.getUser().then(({ data }) => {
        if (active && data.user) {
          setCurrentUserEmail(data.user.email ?? 'บัญชีผู้ใช้ FINORA');
        }
      });
    } catch {
      // Ignore if env not configured
    }
    return () => {
      active = false;
    };
  }, []);

  async function handleSignOut() {
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
      localStorage.removeItem(ACTIVE_USER_KEY);
      localStorage.removeItem(ACTIVE_EMAIL_KEY);
      setCurrentUserEmail(null);
      setMessage('ออกจากระบบเรียบร้อยแล้ว');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ออกจากระบบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();

      if (mode === 'signin') {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        setCurrentUserEmail(data.user?.email ?? email);
        setMessage('เข้าสู่ระบบสำเร็จ กำลังพาไปหน้าหลัก...');
        router.push('/dashboard');
        router.refresh();
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split('@')[0] },
          },
        });
        if (signUpError) throw signUpError;
        setMessage('สมัครสมาชิกสำเร็จ กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชี หรือเข้าสู่ระบบ');
        setMode('signin');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อระบบยืนยันตัวตนได้'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md bg-surface border border-border rounded-[18px] p-6 sm:p-8 shadow-sm">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.18em] text-muted font-medium">
            FINORA · PERSONAL FINANCIAL OS
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-primary">
            {currentUserEmail
              ? 'บัญชีผู้ใช้ของคุณ'
              : mode === 'signin'
                ? 'เข้าสู่ระบบ'
                : 'สร้างบัญชีใหม่'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            ระบบบัญชีคู่ส่วนบุคคลที่เรียบง่ายและตรวจสอบได้ทุกบาท
          </p>
        </div>

        {currentUserEmail ? (
          <div className="space-y-4">
            <div className="p-4 rounded-[12px] bg-accent/10 border border-accent/30">
              <p className="text-xs font-medium text-accent">
                สถานะ: เข้าสู่ระบบแล้ว
              </p>
              <p className="mt-1 text-sm font-semibold text-primary">
                {currentUserEmail}
              </p>
              <p className="mt-1 text-xs text-muted">
                จัดการบัญชีและดูสถานะการซิงค์ได้ที่เมนู More &gt; บัญชีผู้ใช้
              </p>
            </div>

            <Link
              href="/dashboard"
              className="w-full py-2.5 px-4 rounded-[10px] bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center hover:opacity-90"
            >
              ไปที่หน้าหลัก (Dashboard)
            </Link>

            <button
              type="button"
              disabled={loading}
              onClick={() => void handleSignOut()}
              className="w-full py-2.5 px-4 rounded-[10px] border border-danger/30 bg-danger/10 text-danger font-medium text-sm hover:bg-danger/20 disabled:opacity-50"
            >
              {loading ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ (Log Out)'}
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'signup' && (
                <div>
                  <label className="block text-sm font-medium text-primary mb-1.5">
                    ชื่อที่แสดง
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="เช่น Phasin"
                    className="w-full px-3.5 py-2.5 bg-background border border-border rounded-[8px] text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-primary mb-1.5">
                  อีเมล
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-[8px] text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-primary mb-1.5">
                  รหัสผ่าน
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-[8px] text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {error && (
                <div className="p-3 rounded-[8px] bg-danger/10 border border-danger/30 text-sm text-danger">
                  {error}
                </div>
              )}

              {message && (
                <div className="p-3 rounded-[8px] bg-accent/10 border border-accent/30 text-sm text-accent">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-[10px] bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading
                  ? 'กำลังดำเนินการ...'
                  : mode === 'signin'
                    ? 'เข้าสู่ระบบ'
                    : 'สร้างบัญชี FINORA'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-border text-center text-sm">
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin');
                  setError(null);
                  setMessage(null);
                }}
                className="text-muted hover:text-primary transition-colors"
              >
                {mode === 'signin'
                  ? 'ยังไม่มีบัญชี? สมัครใช้งานใหม่'
                  : 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ'}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
