'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { ArrowDownLeft, ArrowUpRight, Repeat } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { LazySpendingDoughnutChart } from '@/components/charts/LazyCharts';
import { formatTHB, toDecimal } from '@/lib/utilities/money';
import { calculateFinancialPosition } from '@/modules/accounting/engine';
import { evaluateBudgets } from '@/modules/budgets/service';

type PeriodKey = 'this_month' | 'last_month' | '3m' | '6m';

function getPeriodRange(
  period: PeriodKey,
  anchor: Date | null
): { start: string; end: string } {
  if (!anchor) {
    return { start: '0000-01-01', end: '9999-12-31' };
  }
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  if (period === 'this_month') {
    return {
      start: fmt(new Date(year, month, 1)),
      end: fmt(new Date(year, month + 1, 0)),
    };
  }
  if (period === 'last_month') {
    return {
      start: fmt(new Date(year, month - 1, 1)),
      end: fmt(new Date(year, month, 0)),
    };
  }
  const monthsBack = period === '3m' ? 2 : 5;
  return {
    start: fmt(new Date(year, month - monthsBack, 1)),
    end: fmt(new Date(year, month + 1, 0)),
  };
}

export default function DashboardPage() {
  const {
    householdId,
    accounts,
    categories,
    transactions,
    loading,
    openEntry,
    openEditTransaction,
  } = useFinora();
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const [anchorDate, setAnchorDate] = useState<Date | null>(null);
  const [dailySafeToSpend, setDailySafeToSpend] = useState<Decimal | null>(null);

  useEffect(() => {
    setAnchorDate(new Date());
  }, []);

  useEffect(() => {
    if (!anchorDate) return;
    const todayStr = anchorDate.toISOString().slice(0, 10);
    const daysInMonth = new Date(
      anchorDate.getFullYear(),
      anchorDate.getMonth() + 1,
      0
    ).getDate();
    const remainingDays = Math.max(1, daysInMonth - anchorDate.getDate() + 1);

    void evaluateBudgets(householdId).then((evals) => {
      const totalBudget = evals.find(
        (b) => b.category_id === null && b.period_start <= todayStr && b.period_end >= todayStr
      );
      if (totalBudget) {
        setDailySafeToSpend(
          toDecimal(totalBudget.remaining_amount).div(remainingDays)
        );
      } else {
        setDailySafeToSpend(null);
      }
    });
  }, [householdId, anchorDate, transactions]);

  const range = useMemo(
    () => getPeriodRange(period, anchorDate),
    [period, anchorDate]
  );

  const position = useMemo(() => {
    return calculateFinancialPosition(
      accounts.map((a) => ({
        account_type: a.account_type,
        account_class: a.account_class,
        balance: toDecimal(a.current_balance),
      }))
    );
  }, [accounts]);

  // Only active posted transactions (exclude reversal audit rows) count toward Income / Expense
  const periodPosted = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.status === 'posted' &&
          !t.reversed_transaction_id &&
          t.transaction_date >= range.start &&
          t.transaction_date <= range.end
      ),
    [transactions, range]
  );

  const { incomeTotal, expenseTotal, netCashFlow, spendingSlices } = useMemo(() => {
    let inc = new Decimal(0);
    let exp = new Decimal(0);
    const byCat = new Map<string, Decimal>();

    for (const tx of periodPosted) {
      const amt = toDecimal(tx.amount);
      if (tx.transaction_type === 'income') {
        inc = inc.plus(amt);
      } else if (tx.transaction_type === 'expense') {
        exp = exp.plus(amt);
        const catKey = tx.category_id ?? 'uncategorized';
        byCat.set(catKey, (byCat.get(catKey) ?? new Decimal(0)).plus(amt));
      }
    }

    const slices = Array.from(byCat.entries())
      .map(([catId, total]) => {
        const cat = categories.find((c) => c.id === catId);
        return {
          name: cat?.name ?? 'อื่นๆ',
          value: Number(total.toFixed(2)),
          color: cat?.color ?? undefined,
        };
      })
      .sort((a, b) => b.value - a.value);

    return {
      incomeTotal: inc,
      expenseTotal: exp,
      netCashFlow: inc.minus(exp),
      spendingSlices: slices,
    };
  }, [periodPosted, categories]);

  const recentTransactions = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            t.status !== 'reversed' &&
            t.status !== 'cancelled' &&
            !t.reversed_transaction_id
        )
        .slice(0, 6),
    [transactions]
  );

  return (
    <MobileShell title="ภาพรวมการเงิน">
      <div className="space-y-5">
        {/* Period Filter */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(
            [
              { key: 'this_month', label: 'เดือนนี้' },
              { key: 'last_month', label: 'เดือนก่อน' },
              { key: '3m', label: '3 เดือน' },
              { key: '6m', label: '6 เดือน' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setPeriod(item.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                period === item.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-muted border-border hover:text-primary'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Available Cash & Net Worth Summary */}
        <section className="bg-surface border border-border rounded-[18px] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted">
                เงินสดและเงินฝากพร้อมใช้ (Available Cash)
              </p>
              <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-primary">
                {loading ? '...' : formatTHB(position.availableCash)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Net Worth</p>
              <p className="mt-1 text-sm font-semibold tabular-nums text-primary">
                {loading ? '...' : formatTHB(position.netWorth)}
              </p>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-border grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] text-muted">รายรับ</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-accent">
                {formatTHB(incomeTotal)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted">รายจ่าย</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-primary">
                {formatTHB(expenseTotal)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted">กระแสเงินสดสุทธิ</p>
              <p
                className={`mt-0.5 text-sm font-semibold tabular-nums ${
                  netCashFlow.gte(0) ? 'text-accent' : 'text-danger'
                }`}
              >
                {formatTHB(netCashFlow, { showSign: true })}
              </p>
            </div>
          </div>

          {dailySafeToSpend !== null && (
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
              <span className="text-muted">งบใช้จ่ายคงเหลือต่อวัน (Safe-to-Spend)</span>
              <span
                className={`font-semibold tabular-nums ${
                  dailySafeToSpend.gte(0) ? 'text-accent' : 'text-danger'
                }`}
              >
                {formatTHB(dailySafeToSpend)} / วัน
              </span>
            </div>
          )}
        </section>

        {/* Spending Breakdown */}
        <section className="bg-surface border border-border rounded-[18px] p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-primary">สัดส่วนรายจ่าย</h2>
            <Link
              href="/analytics"
              className="text-xs font-medium text-accent hover:underline"
            >
              ดูวิเคราะห์เชิงลึก
            </Link>
          </div>
          <LazySpendingDoughnutChart
            data={spendingSlices}
            totalLabel={formatTHB(expenseTotal)}
          />
        </section>

        {/* Recent Transactions */}
        <section className="bg-surface border border-border rounded-[18px] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-primary">รายการล่าสุด</h2>
            <Link
              href="/transactions"
              className="text-xs font-medium text-accent hover:underline"
            >
              ดูทั้งหมด
            </Link>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted">ยังไม่มีรายการธุรกรรม</p>
              <button
                type="button"
                onClick={openEntry}
                className="mt-3 px-4 py-2 rounded-[10px] bg-primary text-primary-foreground text-xs font-medium"
              >
                บันทึกรายการแรก
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentTransactions.map((tx) => {
                const cat = categories.find((c) => c.id === tx.category_id);
                const acc = accounts.find((a) => a.id === tx.account_id);
                const isIncome = tx.transaction_type === 'income';
                const isTransfer = tx.transaction_type === 'transfer';

                return (
                  <li key={tx.id}>
                    <button
                      type="button"
                      onClick={() => openEditTransaction(tx)}
                      className="w-full py-3 flex items-center justify-between gap-3 text-left hover:bg-background/50 rounded-[10px] px-1 -mx-1 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-background border border-border flex items-center justify-center shrink-0">
                          {isIncome ? (
                            <ArrowDownLeft className="w-4 h-4 text-accent" />
                          ) : isTransfer ? (
                            <Repeat className="w-4 h-4 text-muted" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4 text-primary" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary truncate">
                            {tx.description || cat?.name || 'โอนเงินระหว่างบัญชี'}
                          </p>
                          <p className="text-xs text-muted truncate">
                            {tx.transaction_date} · {acc?.name ?? 'บัญชี'}
                            {tx.status === 'draft' && ' · Draft'}
                            {tx.status === 'reversed' && ' · Reversed'}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p
                          className={`text-sm font-semibold tabular-nums ${
                            tx.status === 'reversed' || tx.status === 'cancelled'
                              ? 'line-through text-muted'
                              : isIncome
                                ? 'text-accent'
                                : isTransfer
                                  ? 'text-muted'
                                  : 'text-primary'
                          }`}
                        >
                          {isIncome ? '+' : isTransfer ? '' : '-'}
                          {formatTHB(tx.amount)}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </MobileShell>
  );
}
