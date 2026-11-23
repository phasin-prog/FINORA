'use client';

import type { CalendarDisplayItem } from '@/modules/calendar/calendar.types';
import type { CalendarDayCell } from '@/modules/calendar/calendar.utils';

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export function CalendarGrid({
  cells,
  selectedDate,
  todayDate,
  itemsByDate,
  onSelectDate,
}: {
  cells: CalendarDayCell[];
  selectedDate: string;
  todayDate: string;
  itemsByDate: Map<string, CalendarDisplayItem[]>;
  onSelectDate: (date: string) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted mb-2">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const dayItems = itemsByDate.get(cell.date) ?? [];
          const isSelected = cell.date === selectedDate;
          const isToday = cell.date === todayDate;

          const hasIncome = dayItems.some((i) => i.event_type === 'INCOME');
          const hasExpense = dayItems.some(
            (i) => i.event_type === 'EXPENSE' || i.event_type === 'BILL'
          );
          const hasDebt = dayItems.some((i) => i.event_type === 'DEBT_PAYMENT');
          const hasInvest = dayItems.some((i) => i.event_type === 'INVESTMENT');

          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => onSelectDate(cell.date)}
              className={`h-12 rounded-[10px] flex flex-col items-center justify-center gap-1 text-xs transition-colors border ${
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary font-semibold'
                  : isToday
                    ? 'bg-background border-accent text-primary font-semibold'
                    : cell.inCurrentMonth
                      ? 'bg-surface border-transparent text-primary hover:border-border'
                      : 'bg-transparent border-transparent text-muted/40'
              }`}
            >
              <span className="tabular-nums leading-none">{cell.dayNumber}</span>
              <div className="flex items-center gap-0.5 h-1.5">
                {hasIncome && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                {hasExpense && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSelected ? 'bg-primary-foreground' : 'bg-primary'
                    }`}
                  />
                )}
                {hasDebt && <span className="w-1.5 h-1.5 rounded-full bg-danger" />}
                {hasInvest && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
