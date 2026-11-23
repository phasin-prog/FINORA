import { localDb } from '@/offline/indexeddb/db';
import type {
  NotificationPreferenceRecord,
  NotificationRecord,
} from '@/modules/notifications/notification.types';

export async function listNotificationsForUser(
  userId: string
): Promise<NotificationRecord[]> {
  const items = await localDb.notifications
    .where('user_id')
    .equals(userId)
    .filter((n) => n.status !== 'cancelled')
    .toArray();

  return items.sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
}

export async function findNotificationByDedupKey(
  userId: string,
  deduplicationKey: string
): Promise<NotificationRecord | undefined> {
  return localDb.notifications
    .where('deduplication_key')
    .equals(deduplicationKey)
    .filter((n) => n.user_id === userId)
    .first();
}

export async function saveNotification(
  record: NotificationRecord
): Promise<void> {
  await localDb.notifications.put(record);
}

export async function listPreferencesForUser(
  userId: string
): Promise<NotificationPreferenceRecord[]> {
  return localDb.notification_preferences
    .where('user_id')
    .equals(userId)
    .toArray();
}

export async function savePreferences(
  prefs: NotificationPreferenceRecord[]
): Promise<void> {
  await localDb.notification_preferences.bulkPut(prefs);
}
