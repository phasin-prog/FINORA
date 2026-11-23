import { formatTHB } from '@/lib/utilities/money';
import { localDb } from '@/offline/indexeddb/db';
import { evaluateBudgets } from '@/modules/budgets/service';
import {
  diffDaysYYYYMMDD,
  toBangkokDateString,
} from '@/modules/calendar/calendar.utils';
import {
  findNotificationByDedupKey,
  listNotificationsForUser,
  listPreferencesForUser,
  saveNotification,
  savePreferences,
} from '@/modules/notifications/notification.repository';
import {
  buildBudgetDedupKey,
  buildCalendarEventDedupKey,
  buildDebtDedupKey,
  DEFAULT_NOTIFICATION_RULES,
} from '@/modules/notifications/notification.rules';
import type {
  NotificationPreferenceRecord,
  NotificationPriority,
  NotificationRecord,
  NotificationTypeKey,
} from '@/modules/notifications/notification.types';

export async function ensureDefaultNotificationPreferences(
  userId: string
): Promise<NotificationPreferenceRecord[]> {
  const existing = await listPreferencesForUser(userId);
  if (existing.length > 0) return existing;

  const now = new Date().toISOString();
  const defaults: NotificationPreferenceRecord[] = DEFAULT_NOTIFICATION_RULES.map(
    (rule) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      notification_type: rule.notification_type,
      label: rule.label,
      is_enabled: true,
      days_before: rule.days_before,
      preferred_time: rule.preferred_time,
      channel: 'in_app',
      created_at: now,
      updated_at: now,
    })
  );

  await savePreferences(defaults);
  return defaults;
}

export async function toggleNotificationPreference(
  prefId: string,
  isEnabled: boolean
): Promise<void> {
  await localDb.notification_preferences.update(prefId, {
    is_enabled: isEnabled,
    updated_at: new Date().toISOString(),
  });
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const now = new Date().toISOString();
  await localDb.notifications.update(notificationId, {
    status: 'read',
    read_at: now,
  });
}

export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  const now = new Date().toISOString();
  const unread = await localDb.notifications
    .where('user_id')
    .equals(userId)
    .filter((n) => n.status === 'sent' || n.status === 'scheduled')
    .toArray();

  await Promise.all(
    unread.map((n) =>
      localDb.notifications.update(n.id, { status: 'read', read_at: now })
    )
  );
}

async function emitIfNotExists(params: {
  userId: string;
  householdId: string;
  eventId?: string | null;
  relatedLiabilityId?: string | null;
  type: NotificationTypeKey;
  title: string;
  message: string;
  priority: NotificationPriority;
  scheduledAt: string;
  deduplicationKey: string;
  enabledTypes: Set<NotificationTypeKey>;
}): Promise<boolean> {
  if (!params.enabledTypes.has(params.type)) return false;

  const existing = await findNotificationByDedupKey(
    params.userId,
    params.deduplicationKey
  );
  if (existing) return false;

  const now = new Date().toISOString();
  const record: NotificationRecord = {
    id: crypto.randomUUID(),
    user_id: params.userId,
    household_id: params.householdId,
    event_id: params.eventId ?? null,
    related_liability_id: params.relatedLiabilityId ?? null,
    notification_type: params.type,
    title: params.title,
    message: params.message,
    priority: params.priority,
    scheduled_at: params.scheduledAt,
    sent_at: now,
    read_at: null,
    status: 'sent',
    deduplication_key: params.deduplicationKey,
    created_at: now,
  };

  await saveNotification(record);
  return true;
}

/**
 * Evaluates debts, budgets, calendar events, and sync conflicts to generate
 * deduplicated in-app notifications. Also cancels reminders for paid-off debts.
 */
export async function evaluateAndGenerateNotifications(
  householdId: string,
  userId: string,
  todayBangkok: string = toBangkokDateString()
): Promise<NotificationRecord[]> {
  const prefs = await ensureDefaultNotificationPreferences(userId);
  const enabledTypes = new Set(
    prefs.filter((p) => p.is_enabled).map((p) => p.notification_type)
  );

  const [liabilities, budgetEvals, calendarEvents, categories, outboxConflicts] =
    await Promise.all([
      localDb.liabilities.where('household_id').equals(householdId).toArray(),
      evaluateBudgets(householdId),
      localDb.calendar_events.where('household_id').equals(householdId).toArray(),
      localDb.categories.where('household_id').equals(householdId).toArray(),
      localDb.outbox
        .where('household_id')
        .equals(householdId)
        .filter((o) => o.sync_status === 'conflict' || o.sync_status === 'sync_failed')
        .toArray(),
    ]);

  // 1. Cancel pending/sent reminders for paid-off or closed liabilities (Addendum 1.3)
  const closedLiabilityIds = new Set(
    liabilities.filter((l) => l.status !== 'active').map((l) => l.id)
  );
  if (closedLiabilityIds.size > 0) {
    const toCancel = await localDb.notifications
      .where('user_id')
      .equals(userId)
      .filter(
        (n) =>
          Boolean(n.related_liability_id) &&
          closedLiabilityIds.has(n.related_liability_id!) &&
          n.status !== 'read' &&
          n.status !== 'cancelled'
      )
      .toArray();

    await Promise.all(
      toCancel.map((n) => localDb.notifications.update(n.id, { status: 'cancelled' }))
    );
  }

  const nowIso = new Date().toISOString();

  // 2. Debt due-date & overdue rules
  for (const debt of liabilities) {
    if (debt.status !== 'active' || !debt.next_due_date) continue;
    const daysUntil = diffDaysYYYYMMDD(todayBangkok, debt.next_due_date);

    let ruleType: NotificationTypeKey | null = null;
    let priority: NotificationPriority = 'important';
    let title = '';

    if (daysUntil < 0) {
      ruleType = 'debt_overdue';
      priority = 'urgent';
      title = `เลยกำหนดชำระ: ${debt.debt_name}`;
    } else if (daysUntil === 0) {
      ruleType = 'debt_due_today';
      priority = 'urgent';
      title = `ครบกำหนดชำระวันนี้: ${debt.debt_name}`;
    } else if (daysUntil === 1) {
      ruleType = 'debt_due_1d';
      priority = 'important';
      title = `พรุ่งนี้ครบกำหนด: ${debt.debt_name}`;
    } else if (daysUntil <= 3) {
      ruleType = 'debt_due_3d';
      priority = 'important';
      title = `อีก ${daysUntil} วันครบกำหนด: ${debt.debt_name}`;
    } else if (daysUntil <= 7) {
      ruleType = 'debt_due_7d';
      priority = 'important';
      title = `อีก ${daysUntil} วันครบกำหนด: ${debt.debt_name}`;
    }

    if (ruleType) {
      await emitIfNotExists({
        userId,
        householdId,
        relatedLiabilityId: debt.id,
        type: ruleType,
        title,
        message: `${debt.creditor_name} · ยอดคงเหลือ ${formatTHB(debt.outstanding_balance)} (ครบกำหนด ${debt.next_due_date})`,
        priority,
        scheduledAt: nowIso,
        deduplicationKey: buildDebtDedupKey(debt.id, debt.next_due_date, ruleType),
        enabledTypes,
      });
    }
  }

  // 3. Budget 80% / 100% threshold rules
  for (const b of budgetEvals) {
    const cat = categories.find((c) => c.id === b.category_id);
    const label = cat ? cat.name : 'งบประมาณรวม';

    if (b.percent_used >= 100) {
      await emitIfNotExists({
        userId,
        householdId,
        type: 'budget_100',
        title: `ใช้งบเกินกำหนด: ${label}`,
        message: `ใช้ไป ${formatTHB(b.spent_amount)} จากงบ ${formatTHB(b.budget_amount)} (${b.percent_used}%)`,
        priority: 'urgent',
        scheduledAt: nowIso,
        deduplicationKey: buildBudgetDedupKey(b.id, b.period_start, 'budget_100'),
        enabledTypes,
      });
    } else if (b.percent_used >= 80) {
      await emitIfNotExists({
        userId,
        householdId,
        type: 'budget_80',
        title: `ใช้งบถึง ${b.percent_used}%: ${label}`,
        message: `ใช้ไป ${formatTHB(b.spent_amount)} จากงบ ${formatTHB(b.budget_amount)}`,
        priority: 'important',
        scheduledAt: nowIso,
        deduplicationKey: buildBudgetDedupKey(b.id, b.period_start, 'budget_80'),
        enabledTypes,
      });
    }
  }

  // 4. Calendar income & recurring reminders
  for (const ev of calendarEvents) {
    if (ev.status !== 'scheduled') continue;
    const daysUntil = diffDaysYYYYMMDD(todayBangkok, ev.event_date);

    if (ev.event_type === 'INCOME' && daysUntil === 0) {
      await emitIfNotExists({
        userId,
        householdId,
        eventId: ev.id,
        type: 'income_reminder',
        title: `กำหนดรับเงินวันนี้: ${ev.title}`,
        message: ev.amount ? `คาดว่าจะได้รับ ${formatTHB(ev.amount)}` : ev.description,
        priority: 'informational',
        scheduledAt: nowIso,
        deduplicationKey: buildCalendarEventDedupKey(
          ev.id,
          ev.event_date,
          'income_reminder'
        ),
        enabledTypes,
      });
    } else if (ev.event_type === 'BILL' && daysUntil === 1) {
      await emitIfNotExists({
        userId,
        householdId,
        eventId: ev.id,
        type: 'recurring_1d',
        title: `บิลครบกำหนดพรุ่งนี้: ${ev.title}`,
        message: ev.amount ? `จำนวน ${formatTHB(ev.amount)}` : ev.description,
        priority: 'important',
        scheduledAt: nowIso,
        deduplicationKey: buildCalendarEventDedupKey(
          ev.id,
          ev.event_date,
          'recurring_1d'
        ),
        enabledTypes,
      });
    }
  }

  // 5. System sync conflicts
  if (outboxConflicts.length > 0) {
    await emitIfNotExists({
      userId,
      householdId,
      type: 'system_sync',
      title: `มีรายการซิงค์ไม่สำเร็จ ${outboxConflicts.length} รายการ`,
      message: 'กรุณาตรวจสอบคิวซิงค์ในหน้าตั้งค่าเพื่อแก้ไขข้อมูลขัดแย้ง',
      priority: 'system',
      scheduledAt: nowIso,
      deduplicationKey: `system:sync:${todayBangkok}:${outboxConflicts.length}`,
      enabledTypes,
    });
  }

  return listNotificationsForUser(userId);
}
