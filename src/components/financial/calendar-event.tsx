'use client';

import { formatTHB } from '@/lib/utilities/money';
import type { CalendarDisplayItem } from '@/modules/calendar/calendar.types';

export function CalendarEventRow({ item }: { item: CalendarDisplayItem }) {
  const isIncome = item.event_type === 'INCOME';
  const isDebt = item.event_type === 'DEBT_PAYMENT';
  const isInvestment = item.event_type === 'INVESTMENT';

  const badgeColor = isIncome
    ? 'bg-accent/10 text-accent'
    : isDebt || item.status === 'overdue'
      ? 'bg-danger/10 text-danger'
      : isInvestment
        ? 'bg-warning/10 text-warning'
        : 'bg-background text-primary border border-border';

  return (
    <div className="py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${badgeColor}`}
          >
            {item.is_actual ? 'จริง' : item.status === 'overdue' ? 'เลยกำหนด' : 'คาดการณ์'}
          </span>
          <p className="text-sm font-medium text-primary truncate">{item.title}</p>
        </div>
        {item.description && (
          <p className="text-xs text-muted mt-0.5 truncate">{item.description}</p>
        )}
      </div>

      {item.amount && (
        <span
          className={`text-sm font-semibold tabular-nums shrink-0 ${
            isIncome ? 'text-accent' : isDebt ? 'text-danger' : 'text-primary'
          }`}
        >
          {isIncome ? '+' : '-'}
          {formatTHB(item.amount)}
        </span>
      )}
    </div>
  );
}
