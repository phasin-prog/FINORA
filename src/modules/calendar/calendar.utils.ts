export const BANGKOK_TZ = 'Asia/Bangkok';

/**
 * Formats a Date into YYYY-MM-DD in Asia/Bangkok timezone so due dates
 * do not shift when travelling across timezones (Addendum Section 5).
 */
export function toBangkokDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function diffDaysYYYYMMDD(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  const utcFrom = Date.UTC(fy, fm - 1, fd);
  const utcTo = Date.UTC(ty, tm - 1, td);
  return Math.round((utcTo - utcFrom) / 86_400_000);
}

export interface CalendarDayCell {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  inCurrentMonth: boolean;
}

/**
 * Builds a 35- or 42-cell Sunday-first grid for the given YYYY-MM month.
 */
export function buildMonthGrid(year: number, monthIndex0: number): CalendarDayCell[] {
  const firstDay = new Date(Date.UTC(year, monthIndex0, 1));
  const startDow = firstDay.getUTCDay(); // 0 = Sun
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();

  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
  const cells: CalendarDayCell[] = [];

  for (let i = 0; i < totalCells; i += 1) {
    const d = new Date(Date.UTC(year, monthIndex0, 1 - startDow + i));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    cells.push({
      date: `${y}-${m}-${day}`,
      dayNumber: d.getUTCDate(),
      inCurrentMonth: d.getUTCMonth() === monthIndex0,
    });
  }

  return cells;
}
