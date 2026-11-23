import { localDb } from '@/offline/indexeddb/db';
import type { CalendarEventRecord } from '@/modules/calendar/calendar.types';

export async function listCalendarEventsByHousehold(
  householdId: string
): Promise<CalendarEventRecord[]> {
  return localDb.calendar_events
    .where('household_id')
    .equals(householdId)
    .toArray();
}

export async function saveCalendarEvent(
  event: CalendarEventRecord
): Promise<CalendarEventRecord> {
  await localDb.calendar_events.put(event);
  return event;
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  await localDb.calendar_events.delete(id);
}
