'use client';

import { useMemo } from 'react';
import Decimal from 'decimal.js';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import {
  LazyCashFlowBarChart,
  LazySpendingDoughnutChart,
} from '@/components/charts/LazyCharts';
import type { MonthlyCashFlowPoint } from '@/components/charts/CashFlowBarChart';
import { formatTHB, toDecimal } from '@/lib/utilities/money';

export default function AnalyticsPage() {
  const { transactions, categories } = useFinora();

  const posted = useMemo(
    () => transactions.filter((t) => t.status === 'posted'),
    [transactions]
  );

  const monthlySeries = useMemo<MonthlyCashFlowPoint[]>(() => {
    const map = new Map<string, { income: Decimal; expense: Decimal }>();

    for (const tx of posted) {
      const ym = tx.transaction_date.slice(0, 7);
      const bucket = map.get(ym) ?? {
        income: new Decimal(0),
        expense: new Decimal(0),
      };
      if (tx.transaction_type === 'income') {
        bucket.income = bucket.income.plus(toDecimal(tx.amount));
      } else if (tx.transaction_type === 'expense') {
        bucket.expense = bucket.expense.plus(toDecimal(tx.amount));
      }
      map.set(ym, bucket);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, vals]) => ({
        month,
        income: Number(vals.income.toFixed(2)),
        expense: Number(vals.expense.toFixed(2)),
      }));
  }, [posted]);

  const { expenseTotal, spendingSlices } = useMemo(() => {
    let exp = new Decimal(0);
    const byCat = new Map<string, Decimal>();

    for (const tx of posted) {
      if (tx.transaction_type !== 'expense') continue;
      const amt = toDecimal(tx.amount);
      exp = exp.plus(amt);
      const catId = tx.category_id ?? 'other';
      byCat.set(catId, (byCat.get(catId) ?? new Decimal(0)).plus(amt));
    }

    const slices = Array.from(byCat.entries())
      .map(([catId, val]) => {
        const cat = categories.find((c) => c.id === catId);
        return {
          name: cat?.name ?? 'อื่นๆ',
          value: Number(val.toFixed(2)),
          color: cat?.color ?? undefined,
        };
      })
      .sort((a, b) => b.value - a.value);

    return { expenseTotal: exp, spendingSlices: slices };
  }, [posted, categories]);

  return (
    <MobileShell title="วิเคราะห์การเงิน">
      <div className="space-y-5">
        <section className="bg-surface border border-border rounded-[18px] p-5">
          <h2 className="text-sm font-semibold text-primary mb-2">
            รายรับเทียบรายจ่ายรายเดือน
          </h2>
          {monthlySeries.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              ยังไม่มีข้อมูลรายรับ-รายจ่ายที่ Post แล้ว
            </p>
          ) : (
            <LazyCashFlowBarChart data={monthlySeries} />
          )}
        </section>

        <section className="bg-surface border border-border rounded-[18px] p-5">
          <h2 className="text-sm font-semibold text-primary mb-2">
            สัดส่วนรายจ่ายรวมทั้งหมด
          </h2>
          <LazySpendingDoughnutChart
            data={spendingSlices}
            totalLabel={formatTHB(expenseTotal)}
          />
        </section>
      </div>
    </MobileShell>
  );
}
