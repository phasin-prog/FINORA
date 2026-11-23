'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { formatFriendlyError, formatTHB, sanitizeMoneyInput } from '@/lib/utilities/money';
import {
  createBudget,
  deleteBudget,
  evaluateBudgets,
  type BudgetEvaluation,
} from '@/modules/budgets/service';

export default function BudgetsPage() {
  const { householdId, categories, transactions } = useFinora();
  const [budgets, setBudgets] = useState<BudgetEvaluation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [categoryId, setCategoryId] = useState<string>('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const expenseCategories = categories.filter((c) => c.category_type === 'EXPENSE');

  const loadBudgets = useCallback(async () => {
    const evals = await evaluateBudgets(householdId);
    setBudgets(evals);
  }, [householdId]);

  useEffect(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);
    setPeriodStart((prev) => prev || start);
    setPeriodEnd((prev) => prev || end);
  }, []);

  useEffect(() => {
    void loadBudgets();
  }, [loadBudgets, transactions]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createBudget({
        householdId,
        categoryId: categoryId || null,
        periodType: 'monthly',
        periodStart,
        periodEnd,
        budgetAmount: budgetAmount.trim(),
        currencyCode: 'THB',
      });
      setBudgetAmount('');
      setShowForm(false);
      await loadBudgets();
    } catch (err) {
      setError(formatFriendlyError(err, 'ไม่สามารถสร้างงบประมาณได้'));
    }
  }

  async function handleDelete(id: string) {
    await deleteBudget(id);
    await loadBudgets();
  }

  return (
    <MobileShell title="งบประมาณ">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            คำนวณจากรายการที่ Post แล้วเท่านั้น (ไม่รวม Draft)
          </p>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-primary text-primary-foreground text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            ตั้งงบใหม่
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleCreate}
            className="bg-surface border border-border rounded-[18px] p-4 space-y-3"
          >
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                หมวดหมู่
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px] text-primary"
              >
                <option value="">งบประมาณรวมทุกหมวด</option>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                วงเงินงบประมาณ (THB)
              </label>
              <input
                type="text"
                inputMode="decimal"
                required
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(sanitizeMoneyInput(e.target.value))}
                placeholder="10000"
                className="w-full px-3 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px] text-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  วันเริ่มต้น
                </label>
                <input
                  type="date"
                  required
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px] text-primary"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">
                  วันสิ้นสุด
                </label>
                <input
                  type="date"
                  required
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px] text-primary"
                />
              </div>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              type="submit"
              className="w-full py-2.5 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium"
            >
              บันทึกงบประมาณ
            </button>
          </form>
        )}

        {budgets.length === 0 ? (
          <div className="bg-surface border border-border rounded-[18px] p-8 text-center text-sm text-muted">
            ยังไม่มีงบประมาณที่ตั้งไว้ กด “ตั้งงบใหม่” เพื่อเริ่มต้น
          </div>
        ) : (
          <div className="space-y-3">
            {budgets.map((b) => {
              const cat = categories.find((c) => c.id === b.category_id);
              const barColor =
                b.health === 'exceeded'
                  ? 'bg-danger'
                  : b.health === 'warning'
                    ? 'bg-warning'
                    : 'bg-accent';
              const widthPct = Math.min(b.percent_used, 100);

              return (
                <div
                  key={b.id}
                  className="bg-surface border border-border rounded-[18px] p-4 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-primary">
                        {cat ? cat.name : 'งบประมาณรวมทุกหมวด'}
                      </p>
                      <p className="text-xs text-muted">
                        {b.period_start} ถึง {b.period_end}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(b.id)}
                      className="p-1.5 text-muted hover:text-danger"
                      title="ลบงบประมาณ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="w-full h-2 bg-background rounded-full overflow-hidden border border-border">
                    <div
                      className={`h-full ${barColor} transition-all`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="text-primary">
                      ใช้ไป {formatTHB(b.spent_amount)} / {formatTHB(b.budget_amount)}
                    </span>
                    <span
                      className={
                        b.health === 'exceeded'
                          ? 'text-danger font-semibold'
                          : b.health === 'warning'
                            ? 'text-warning font-semibold'
                            : 'text-accent font-semibold'
                      }
                    >
                      {b.percent_used}% (คงเหลือ {formatTHB(b.remaining_amount)})
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MobileShell>
  );
}
