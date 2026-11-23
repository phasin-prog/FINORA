'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { CalendarGrid } from '@/components/financial/calendar-grid';
import { CalendarEventRow } from '@/components/financial/calendar-event';
import { formatTHB } from '@/lib/utilities/money';
import {
  createCalendarEvent,
  getMonthlyFinancialCalendar,
} from '@/modules/calendar/calendar.service';
import type {
  CalendarDisplayItem,
  CalendarEventType,
  MonthlyFinancialSummary,
} from '@/modules/calendar/calendar.types';
import {
  buildMonthGrid,
  toBangkokDateString,
} from '@/modules/calendar/calendar.utils';

export default function CalendarPage() {
  const { householdId, userId, transactions } = useFinora();

  const [todayDate, setTodayDate] = useState('2026-11-23');
  const [viewYear, setViewYear] = useState(2026);
  const [viewMonth0, setViewMonth0] = useState(10); // 0-indexed (10 = Nov)
  const [selectedDate, setSelectedDate] = useState('2026-11-23');

  const [items, setItems] = useState<CalendarDisplayItem[]>([]);
  const [summary, setSummary] = useState<MonthlyFinancialSummary | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [eventType, setEventType] = useState<CalendarEventType>('BILL');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const bangkokToday = toBangkokDateString();
      const [y, m] = bangkokToday.split('-').map(Number);
      setTodayDate(bangkokToday);
      setSelectedDate(bangkokToday);
      setViewYear(y);
      setViewMonth0(m - 1);
    });
    return () => {
      active = false;
    };
  }, []);

  const monthKey = `${viewYear}-${String(viewMonth0 + 1).padStart(2, '0')}`;

  const loadCalendar = useCallback(async () => {
    const res = await getMonthlyFinancialCalendar(householdId, monthKey, todayDate);
    setItems(res.items);
    setSummary(res.summary);
  }, [householdId, monthKey, todayDate]);

  useEffect(() => {
    let active = true;
    void getMonthlyFinancialCalendar(householdId, monthKey, todayDate).then((res) => {
      if (!active) return;
      setItems(res.items);
      setSummary(res.summary);
    });
    return () => {
      active = false;
    };
  }, [householdId, monthKey, todayDate, transactions]);

  const cells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth0),
    [viewYear, viewMonth0]
  );

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarDisplayItem[]>();
    for (const item of items) {
      const list = map.get(item.event_date) ?? [];
      list.push(item);
      map.set(item.event_date, list);
    }
    return map;
  }, [items]);

  const selectedDayItems = itemsByDate.get(selectedDate) ?? [];

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(viewYear, viewMonth0 + delta, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth0(d.getUTCMonth());
  }

  async function handleAddEvent(e: React.FormEvent) {
    e.preventDefault();
    await createCalendarEvent({
      householdId,
      ownerUserId: userId,
      eventType,
      title,
      description: '',
      eventDate: selectedDate,
      amount: amount.trim() || null,
      currencyCode: 'THB',
    });
    setTitle('');
    setAmount('');
    setShowAdd(false);
    await loadCalendar();
  }

  const monthLabel = new Intl.DateTimeFormat('th-TH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(viewYear, viewMonth0, 1)));

  return (
    <MobileShell title="ปฏิทินการเงิน">
      <div className="space-y-4">
        {/* Monthly Summary (Expected vs Actual strictly separated) */}
        {summary && (
          <section className="bg-surface border border-border rounded-[18px] p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-muted">รายรับจริง (Actual)</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-accent">
                {formatTHB(summary.actualIncome)}
              </p>
            </div>
            <div>
              <p className="text-muted">รายรับคาดการณ์ (Expected)</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">
                {formatTHB(summary.expectedIncome)}
              </p>
            </div>
            <div>
              <p className="text-muted">รายจ่ายจริง (Actual)</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">
                {formatTHB(summary.actualExpenses)}
              </p>
            </div>
            <div>
              <p className="text-muted">รายจ่ายคาดการณ์ (Expected)</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-warning">
                {formatTHB(summary.expectedExpenses)}
              </p>
            </div>
            <div>
              <p className="text-muted">ยอดที่ต้องจ่าย (Upcoming)</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-danger">
                {formatTHB(summary.upcomingPayments)}
              </p>
            </div>
            <div>
              <p className="text-muted">กระแสเงินสดสุทธิจริง</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">
                {formatTHB(summary.netCashFlow, { showSign: true })}
              </p>
            </div>
          </section>
        )}

        {/* Calendar Grid */}
        <section className="bg-surface border border-border rounded-[18px] p-4 space-y-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-2 rounded-[8px] border border-border text-primary hover:bg-background"
              aria-label="เดือนก่อนหน้า"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-semibold text-primary">{monthLabel}</h2>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-2 rounded-[8px] border border-border text-primary hover:bg-background"
              aria-label="เดือนถัดไป"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <CalendarGrid
            cells={cells}
            selectedDate={selectedDate}
            todayDate={todayDate}
            itemsByDate={itemsByDate}
            onSelectDate={setSelectedDate}
          />

          <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-accent" /> Income
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary" /> Expense / Bill
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-danger" /> Debt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-warning" /> Investment
            </span>
          </div>
        </section>

        {/* Daily Detail */}
        <section className="bg-surface border border-border rounded-[18px] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-primary">
              รายละเอียดวันที่ {selectedDate}
            </h3>
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[8px] bg-primary text-primary-foreground text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              เพิ่มกำหนดการ
            </button>
          </div>

          {showAdd && (
            <form
              onSubmit={handleAddEvent}
              className="mb-4 p-3 rounded-[12px] bg-background border border-border space-y-2.5"
            >
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as CalendarEventType)}
                  className="px-2.5 py-2 text-xs bg-surface border border-border rounded-[8px]"
                >
                  <option value="INCOME">รายรับคาดการณ์</option>
                  <option value="BILL">บิล / รายจ่ายประจำ</option>
                  <option value="DEBT_PAYMENT">กำหนดชำระหนี้</option>
                  <option value="INVESTMENT">ปันผล / ลงทุน</option>
                  <option value="REMINDER">แจ้งเตือนทั่วไป</option>
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="จำนวนเงิน (ถ้ามี)"
                  className="px-2.5 py-2 text-xs tabular-nums bg-surface border border-border rounded-[8px]"
                />
              </div>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="เช่น ค่าอินเทอร์เน็ต, เงินเดือนเข้า"
                className="w-full px-3 py-2 text-xs bg-surface border border-border rounded-[8px]"
              />
              <button
                type="submit"
                className="w-full py-2 rounded-[8px] bg-accent text-white text-xs font-medium"
              >
                บันทึกกำหนดการ
              </button>
            </form>
          )}

          {selectedDayItems.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted">
              ไม่มีรายการหรือกำหนดการในวันนี้
            </p>
          ) : (
            <div className="divide-y divide-border">
              {selectedDayItems.map((item) => (
                <CalendarEventRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      </div>
    </MobileShell>
  );
}
