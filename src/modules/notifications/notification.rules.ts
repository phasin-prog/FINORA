import type { NotificationTypeKey } from '@/modules/notifications/notification.types';

export interface DefaultNotificationRule {
  notification_type: NotificationTypeKey;
  label: string;
  days_before: number;
  preferred_time: string;
}

export const DEFAULT_NOTIFICATION_RULES: DefaultNotificationRule[] = [
  {
    notification_type: 'debt_due_7d',
    label: 'ครบกำหนดชำระหนี้ (ก่อน 7 วัน)',
    days_before: 7,
    preferred_time: '08:00',
  },
  {
    notification_type: 'debt_due_3d',
    label: 'ครบกำหนดชำระหนี้ (ก่อน 3 วัน)',
    days_before: 3,
    preferred_time: '08:00',
  },
  {
    notification_type: 'debt_due_1d',
    label: 'ครบกำหนดชำระหนี้ (ก่อน 1 วัน)',
    days_before: 1,
    preferred_time: '08:00',
  },
  {
    notification_type: 'debt_due_today',
    label: 'วันครบกำหนดชำระหนี้ (08:00)',
    days_before: 0,
    preferred_time: '08:00',
  },
  {
    notification_type: 'debt_overdue',
    label: 'เลยกำหนดชำระหนี้ (09:00)',
    days_before: 0,
    preferred_time: '09:00',
  },
  {
    notification_type: 'budget_80',
    label: 'ใช้งบประมาณถึง 80%',
    days_before: 0,
    preferred_time: '08:00',
  },
  {
    notification_type: 'budget_100',
    label: 'ใช้งบประมาณเกิน 100%',
    days_before: 0,
    preferred_time: '08:00',
  },
  {
    notification_type: 'income_reminder',
    label: 'แจ้งเตือนรายรับ / เงินเดือนเข้า',
    days_before: 0,
    preferred_time: '08:00',
  },
  {
    notification_type: 'recurring_1d',
    label: 'รายการประจำ (ก่อน 1 วัน)',
    days_before: 1,
    preferred_time: '08:00',
  },
  {
    notification_type: 'system_sync',
    label: 'สถานะการซิงก์และระบบ',
    days_before: 0,
    preferred_time: '08:00',
  },
];

export function buildDebtDedupKey(
  liabilityId: string,
  dueDate: string,
  ruleType: NotificationTypeKey
): string {
  return `debt:${liabilityId}:${dueDate}:${ruleType}`;
}

export function buildBudgetDedupKey(
  budgetId: string,
  periodStart: string,
  ruleType: 'budget_80' | 'budget_100'
): string {
  return `budget:${budgetId}:${periodStart}:${ruleType}`;
}

export function buildCalendarEventDedupKey(
  eventId: string,
  eventDate: string,
  ruleType: NotificationTypeKey
): string {
  return `event:${eventId}:${eventDate}:${ruleType}`;
}
