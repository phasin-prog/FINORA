'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  ListOrdered,
  Plus,
  PieChart,
  MoreHorizontal,
  WifiOff,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { useFinora } from '@/components/layout/FinoraProvider';
import { QuickTransactionSheet } from '@/components/forms/QuickTransactionSheet';
import { PwaSupport } from '@/components/pwa/PwaSupport';
import { NotificationBadge } from '@/components/financial/notification-badge';

export function MobileShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const {
    openEntry,
    isOnline,
    pendingSyncCount,
    unreadNotificationsCount,
    isSyncing,
    triggerSync,
  } = useFinora();

  const navItems = [
    { href: '/dashboard', label: 'Home', icon: Home },
    { href: '/transactions', label: 'Activity', icon: ListOrdered },
    { href: '#add', label: 'Add', icon: Plus, isAction: true },
    { href: '/analytics', label: 'Analysis', icon: PieChart },
    { href: '/settings', label: 'More', icon: MoreHorizontal },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-primary">
      {/* Top Editorial Bar */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-md border-b border-border px-4 pt-[env(safe-area-inset-top)]">
        <div className="max-w-3xl mx-auto h-14 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted block leading-none">
              FINORA
            </span>
            <h1 className="text-base font-semibold tracking-tight text-primary mt-0.5">
              {title}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBadge unreadCount={unreadNotificationsCount} />
            <button
              type="button"
              onClick={() => void triggerSync()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-border bg-surface text-primary hover:border-primary/40 transition-colors"
              title="สถานะการซิงค์ข้อมูล"
            >
              {!isOnline ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-warning" />
                  <span>Offline ({pendingSyncCount})</span>
                </>
              ) : isSyncing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span>Syncing...</span>
                </>
              ) : pendingSyncCount > 0 ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-warning" />
                  <span>Pending ({pendingSyncCount})</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                  <span>Synced</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-5 pb-28">
        <PwaSupport />
        {children}
      </main>

      {/* Bottom Navigation (5 items, thumb-friendly center Add button) */}
      <nav
        aria-label="เมนูหลัก"
        className="fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur-md border-t border-border pb-[env(safe-area-inset-bottom)]"
      >
        <div className="max-w-3xl mx-auto h-16 px-2 grid grid-cols-5 items-center">
          {navItems.map((item) => {
            const Icon = item.icon;
            if (item.isAction) {
              return (
                <div key="add" className="flex justify-center">
                  <button
                    type="button"
                    onClick={openEntry}
                    aria-label="เพิ่มรายการใหม่"
                    className="w-12 h-12 -mt-4 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center hover:opacity-90 active:scale-95 transition-transform"
                  >
                    <Icon className="w-5 h-5" />
                  </button>
                </div>
              );
            }

            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-colors ${
                  active ? 'text-primary' : 'text-muted hover:text-primary'
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'stroke-[2.2]' : 'stroke-[1.7]'}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <QuickTransactionSheet />
    </div>
  );
}
