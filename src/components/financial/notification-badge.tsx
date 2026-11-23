'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';

export function NotificationBadge({ unreadCount }: { unreadCount: number }) {
  return (
    <Link
      href="/notifications"
      aria-label={`การแจ้งเตือน (${unreadCount} ยังไม่อ่าน)`}
      className="relative p-2 rounded-full border border-border bg-surface text-primary hover:border-primary/40 transition-colors"
    >
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-semibold tabular-nums flex items-center justify-center">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
