'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { NotificationItem } from '@/components/financial/notification-item';
import {
  listPreferencesForUser,
} from '@/modules/notifications/notification.repository';
import {
  evaluateAndGenerateNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  toggleNotificationPreference,
} from '@/modules/notifications/notification.service';
import type {
  NotificationPreferenceRecord,
  NotificationRecord,
} from '@/modules/notifications/notification.types';

export default function NotificationsPage() {
  const { householdId, userId, refresh } = useFinora();
  const [tab, setTab] = useState<'inbox' | 'preferences'>('inbox');
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [prefs, setPrefs] = useState<NotificationPreferenceRecord[]>([]);

  const loadData = useCallback(async () => {
    const [notifs, prefList] = await Promise.all([
      evaluateAndGenerateNotifications(householdId, userId),
      listPreferencesForUser(userId),
    ]);
    setItems(notifs);
    setPrefs(prefList);
  }, [householdId, userId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      evaluateAndGenerateNotifications(householdId, userId),
      listPreferencesForUser(userId),
    ]).then(([notifs, prefList]) => {
      if (!active) return;
      setItems(notifs);
      setPrefs(prefList);
    });
    return () => {
      active = false;
    };
  }, [householdId, userId]);

  async function handleMarkRead(id: string) {
    await markNotificationAsRead(id);
    await loadData();
    await refresh();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsAsRead(userId);
    await loadData();
    await refresh();
  }

  async function handleTogglePref(pref: NotificationPreferenceRecord) {
    await toggleNotificationPreference(pref.id, !pref.is_enabled);
    await loadData();
  }

  return (
    <MobileShell title="การแจ้งเตือน">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="grid grid-cols-2 gap-1 p-1 bg-surface border border-border rounded-[10px]">
            <button
              type="button"
              onClick={() => setTab('inbox')}
              className={`px-3 py-1.5 rounded-[8px] text-xs font-medium ${
                tab === 'inbox'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted hover:text-primary'
              }`}
            >
              การแจ้งเตือน ({items.filter((i) => i.status !== 'read').length})
            </button>
            <button
              type="button"
              onClick={() => setTab('preferences')}
              className={`px-3 py-1.5 rounded-[8px] text-xs font-medium ${
                tab === 'preferences'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted hover:text-primary'
              }`}
            >
              ตั้งค่ากฎแจ้งเตือน
            </button>
          </div>

          {tab === 'inbox' && items.some((i) => i.status !== 'read') && (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              <CheckCheck className="w-4 h-4" />
              อ่านทั้งหมด
            </button>
          )}
        </div>

        {tab === 'inbox' ? (
          items.length === 0 ? (
            <div className="bg-surface border border-border rounded-[18px] p-8 text-center text-sm text-muted">
              ไม่มีการแจ้งเตือนที่ต้องดำเนินการในขณะนี้
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((item) => (
                <NotificationItem
                  key={item.id}
                  item={item}
                  onMarkRead={(id) => void handleMarkRead(id)}
                />
              ))}
            </div>
          )
        ) : (
          <section className="bg-surface border border-border rounded-[18px] divide-y divide-border overflow-hidden">
            {prefs.map((pref) => (
              <div
                key={pref.id}
                className="px-4 py-3.5 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-medium text-primary">{pref.label}</p>
                  <p className="text-xs text-muted">
                    เวลา {pref.preferred_time} · ช่องทาง {pref.channel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleTogglePref(pref)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    pref.is_enabled
                      ? 'bg-accent/10 text-accent border-accent/30'
                      : 'bg-background text-muted border-border'
                  }`}
                >
                  {pref.is_enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </MobileShell>
  );
}
