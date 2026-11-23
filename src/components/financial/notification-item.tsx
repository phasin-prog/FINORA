'use client';

import { AlertCircle, Bell, Check, Info } from 'lucide-react';
import type { NotificationRecord } from '@/modules/notifications/notification.types';

export function NotificationItem({
  item,
  onMarkRead,
}: {
  item: NotificationRecord;
  onMarkRead: (id: string) => void;
}) {
  const isUnread = item.status !== 'read';
  const priorityColor =
    item.priority === 'urgent'
      ? 'text-danger bg-danger/10'
      : item.priority === 'important'
        ? 'text-warning bg-warning/10'
        : 'text-accent bg-accent/10';

  const Icon =
    item.priority === 'urgent'
      ? AlertCircle
      : item.priority === 'important'
        ? Bell
        : Info;

  return (
    <div
      className={`p-4 rounded-[14px] border transition-colors ${
        isUnread
          ? 'bg-surface border-primary/30'
          : 'bg-surface/60 border-border opacity-80'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${priorityColor}`}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-primary">{item.title}</p>
              {isUnread && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
            </div>
            <p className="text-xs text-muted mt-0.5 leading-relaxed">{item.message}</p>
          </div>
        </div>

        {isUnread && (
          <button
            type="button"
            onClick={() => onMarkRead(item.id)}
            title="ทำเครื่องหมายว่าอ่านแล้ว"
            className="p-1.5 rounded-[8px] border border-border text-muted hover:text-accent hover:border-accent shrink-0"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
