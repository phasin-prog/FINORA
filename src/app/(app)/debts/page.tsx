'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Calculator, CreditCard, Plus } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { formatTHB, toDecimal } from '@/lib/utilities/money';
import {
  createLiability,
  listLiabilities,
  recordDebtPayment,
} from '@/modules/liabilities/service';
import {
  calculateInstallmentPlan,
  calculateSpendingAffordability,
  createInstallmentLiability,
} from '@/modules/liabilities/installment';
import type { DebtType, Liability } from '@/types/financial';

export default function DebtsPage() {
  const { householdId, userId, accounts, categories, refresh } = useFinora();
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showCalc, setShowCalc] = useState(false);

  // Installment & Spending Calculator state
  const [calcItemName, setCalcItemName] = useState('');
  const [calcCreditor, setCalcCreditor] = useState('บัตรเครดิต');
  const [calcTotalPrice, setCalcTotalPrice] = useState('15000');
  const [calcDownPayment, setCalcDownPayment] = useState('0');
  const [calcRate, setCalcRate] = useState('0');
  const [calcMonths, setCalcMonths] = useState(10);
  const [calcMode, setCalcMode] = useState<'flat' | 'reducing'>('flat');
  const [calcIncome, setCalcIncome] = useState('25000');
  const [calcMonthlyBudget, setCalcMonthlyBudget] = useState('15000');
  const [calcSpent, setCalcSpent] = useState('0');

  // Add form
  const [creditorName, setCreditorName] = useState('');
  const [debtName, setDebtName] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('personal_loan');
  const [principal, setPrincipal] = useState('');
  const [interestRate, setInterestRate] = useState('0');
  const [nextDueDate, setNextDueDate] = useState('');

  // Repayment modal state
  const [payingDebt, setPayingDebt] = useState<Liability | null>(null);
  const [principalPaid, setPrincipalPaid] = useState('');
  const [interestPaid, setInterestPaid] = useState('0');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadDebts = useCallback(async () => {
    const items = await listLiabilities(householdId);
    setLiabilities(items);
  }, [householdId]);

  useEffect(() => {
    setPaymentDate(new Date().toISOString().slice(0, 10));
    void loadDebts();
  }, [loadDebts]);

  useEffect(() => {
    if (!paymentAccountId && accounts.length > 0) {
      const cashOrBank = accounts.find(
        (a) => a.account_type === 'bank' || a.account_type === 'cash'
      );
      setPaymentAccountId(cashOrBank?.id ?? accounts[0].id);
    }
  }, [accounts, paymentAccountId]);

  const totalOutstanding = liabilities
    .filter((l) => l.status === 'active')
    .reduce((acc, l) => acc.plus(toDecimal(l.outstanding_balance)), new Decimal(0));

  const calcResult = useMemo(() => {
    try {
      const plan = calculateInstallmentPlan({
        totalPrice: calcTotalPrice || '0',
        downPayment: calcDownPayment || '0',
        annualInterestRate: calcRate || '0',
        months: calcMonths,
        interestMode: calcMode,
        firstDueDate: paymentDate || '2026-12-01',
      });
      const afford = calculateSpendingAffordability({
        monthlyIncome: calcIncome || '0',
        monthlyBudgetLimit: calcMonthlyBudget || '0',
        spentThisMonth: calcSpent || '0',
        remainingDaysInMonth: 15,
        newMonthlyInstallment: plan.monthlyPayment,
      });
      return { plan, afford, error: null as string | null };
    } catch (e) {
      return {
        plan: null,
        afford: null,
        error: e instanceof Error ? e.message : 'ข้อมูลไม่ถูกต้อง',
      };
    }
  }, [
    calcTotalPrice,
    calcDownPayment,
    calcRate,
    calcMonths,
    calcMode,
    paymentDate,
    calcIncome,
    calcMonthlyBudget,
    calcSpent,
  ]);

  async function handleSaveInstallmentPlan() {
    if (!calcResult.plan) return;
    setError(null);
    try {
      await createInstallmentLiability({
        householdId,
        creditorName: calcCreditor.trim() || 'ผ่อนชำระ',
        debtName: calcItemName.trim() || `ผ่อน ${calcMonths} เดือน`,
        debtType: 'credit_card',
        calcInput: {
          totalPrice: calcTotalPrice,
          downPayment: calcDownPayment,
          annualInterestRate: calcRate,
          months: calcMonths,
          interestMode: calcMode,
          firstDueDate: paymentDate || '2026-12-01',
        },
      });
      setCalcItemName('');
      setShowCalc(false);
      await loadDebts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกแผนผ่อนชำระไม่สำเร็จ');
    }
  }

  async function handleCreateDebt(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createLiability({
        householdId,
        creditorName,
        debtName,
        debtType,
        originalPrincipal: principal,
        outstandingBalance: principal,
        interestRate: interestRate || '0',
        interestType: 'reducing',
        minimumPayment: '0',
        scheduledPayment: '0',
        paymentFrequency: 'monthly',
        nextDueDate: nextDueDate || null,
        currencyCode: 'THB',
      });
      setCreditorName('');
      setDebtName('');
      setPrincipal('');
      setShowAdd(false);
      await loadDebts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถเพิ่มรายการหนี้ได้');
    }
  }

  async function handlePayDebt(e: React.FormEvent) {
    e.preventDefault();
    if (!payingDebt) return;
    setError(null);
    try {
      const interestCategory = categories.find(
        (c) => c.category_type === 'EXPENSE' && c.name.includes('ดอกเบี้ย')
      );
      await recordDebtPayment({
        liabilityId: payingDebt.id,
        paymentDate,
        principalPaid: principalPaid || '0',
        interestPaid: interestPaid || '0',
        paymentAccountId: paymentAccountId || null,
        interestCategoryId: interestCategory?.id ?? null,
        createdBy: userId,
      });
      setPayingDebt(null);
      setPrincipalPaid('');
      setInterestPaid('0');
      await loadDebts();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกการชำระไม่สำเร็จ');
    }
  }

  return (
    <MobileShell title="หนี้สินและการชำระ">
      <div className="space-y-4">
        <section className="bg-surface border border-border rounded-[18px] p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted">ยอดหนี้คงเหลือรวม</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-danger">
              {formatTHB(totalOutstanding)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCalc((v) => !v);
                setShowAdd(false);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-border bg-background text-primary text-xs font-medium"
            >
              <Calculator className="w-3.5 h-3.5 text-accent" />
              คำนวณผ่อน &amp; การใช้จ่าย
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAdd((v) => !v);
                setShowCalc(false);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-primary text-primary-foreground text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              เพิ่มหนี้สิน
            </button>
          </div>
        </section>

        {showCalc && (
          <section className="bg-surface border border-border rounded-[18px] p-4 space-y-3">
            <h2 className="text-sm font-semibold text-primary">
              คำนวณการผ่อนชำระ &amp; ผลกระทบต่อการใช้จ่าย
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">รายการที่จะผ่อน</label>
                <input
                  type="text"
                  value={calcItemName}
                  onChange={(e) => setCalcItemName(e.target.value)}
                  placeholder="เช่น iPhone, เครื่องใช้ไฟฟ้า"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">บัตร / ผู้ให้ผ่อน</label>
                <input
                  type="text"
                  value={calcCreditor}
                  onChange={(e) => setCalcCreditor(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-muted mb-1">ราคาสินค้า</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={calcTotalPrice}
                  onChange={(e) => setCalcTotalPrice(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">เงินดาวน์</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={calcDownPayment}
                  onChange={(e) => setCalcDownPayment(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">ดอกเบี้ย %/ปี</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={calcRate}
                  onChange={(e) => setCalcRate(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">จำนวนงวด (เดือน)</label>
                <select
                  value={calcMonths}
                  onChange={(e) => setCalcMonths(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                >
                  {[3, 6, 10, 12, 18, 24, 36].map((m) => (
                    <option key={m} value={m}>
                      {m} เดือน
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">วิธีคิดดอกเบี้ย</label>
                <select
                  value={calcMode}
                  onChange={(e) => setCalcMode(e.target.value as 'flat' | 'reducing')}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                >
                  <option value="flat">คงที่ (Flat / 0%)</option>
                  <option value="reducing">ลดต้นลดดอก (Reducing)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border">
              <div>
                <label className="block text-[11px] text-muted mb-1">รายได้/เดือน</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={calcIncome}
                  onChange={(e) => setCalcIncome(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1">งบใช้จ่าย/เดือน</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={calcMonthlyBudget}
                  onChange={(e) => setCalcMonthlyBudget(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1">ใช้ไปแล้วเดือนนี้</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={calcSpent}
                  onChange={(e) => setCalcSpent(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
            </div>

            {calcResult.error ? (
              <p className="text-xs text-danger">{calcResult.error}</p>
            ) : (
              calcResult.plan &&
              calcResult.afford && (
                <div className="p-3 rounded-[12px] bg-background border border-border space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted">ค่างวดต่อเดือน</span>
                    <span className="font-semibold tabular-nums text-primary text-sm">
                      {formatTHB(calcResult.plan.monthlyPayment)} / เดือน
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">ดอกเบี้ยรวม / ยอดชำระรวม</span>
                    <span className="tabular-nums text-primary">
                      {formatTHB(calcResult.plan.totalInterest)} /{' '}
                      {formatTHB(calcResult.plan.totalPayable)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">ภาระผ่อนต่อรายได้ / เงินใช้ได้ต่อวัน</span>
                    <span
                      className={`font-semibold tabular-nums ${
                        calcResult.afford.status === 'over_budget'
                          ? 'text-danger'
                          : calcResult.afford.status === 'tight'
                            ? 'text-warning'
                            : 'text-accent'
                      }`}
                    >
                      {calcResult.afford.debtServiceRatioPct}% ·{' '}
                      {formatTHB(calcResult.afford.dailySafeAfterInstallment)}/วัน
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSaveInstallmentPlan()}
                    className="w-full mt-2 py-2 rounded-[8px] bg-accent text-white text-xs font-medium"
                  >
                    บันทึกเป็นแผนผ่อนชำระในระบบหนี้สิน
                  </button>
                </div>
              )
            )}
          </section>
        )}

        {showAdd && (
          <form
            onSubmit={handleCreateDebt}
            className="bg-surface border border-border rounded-[18px] p-4 space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">ชื่อหนี้สิน</label>
                <input
                  type="text"
                  required
                  value={debtName}
                  onChange={(e) => setDebtName(e.target.value)}
                  placeholder="เช่น ผ่อนรถ, บัตร KTC"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">เจ้าหนี้/ธนาคาร</label>
                <input
                  type="text"
                  required
                  value={creditorName}
                  onChange={(e) => setCreditorName(e.target.value)}
                  placeholder="เช่น KBank"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-muted mb-1">ประเภท</label>
                <select
                  value={debtType}
                  onChange={(e) => setDebtType(e.target.value as DebtType)}
                  className="w-full px-2 py-2 text-xs bg-background border border-border rounded-[8px]"
                >
                  <option value="personal_loan">สินเชื่อบุคคล</option>
                  <option value="credit_card">บัตรเครดิต</option>
                  <option value="vehicle_loan">สินเชื่อรถ</option>
                  <option value="mortgage">สินเชื่อบ้าน</option>
                  <option value="other">อื่นๆ</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">ยอดเงินต้น</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={principal}
                  onChange={(e) => setPrincipal(e.target.value)}
                  placeholder="50000"
                  className="w-full px-2.5 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">ดอกเบี้ย %/ปี</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">วันครบกำหนดถัดไป</label>
              <input
                type="date"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
              />
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              type="submit"
              className="w-full py-2.5 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium"
            >
              บันทึกรายการหนี้
            </button>
          </form>
        )}

        {payingDebt && (
          <form
            onSubmit={handlePayDebt}
            className="bg-surface border-2 border-accent rounded-[18px] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-primary">
                บันทึกการชำระ: {payingDebt.debt_name}
              </p>
              <button
                type="button"
                onClick={() => setPayingDebt(null)}
                className="text-xs text-muted hover:text-primary"
              >
                ยกเลิก
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">ตัดเงินต้น (THB)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={principalPaid}
                  onChange={(e) => setPrincipalPaid(e.target.value)}
                  placeholder="2000"
                  className="w-full px-3 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">ดอกเบี้ย (THB)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={interestPaid}
                  onChange={(e) => setInterestPaid(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">จ่ายจากบัญชี</label>
                <select
                  value={paymentAccountId}
                  onChange={(e) => setPaymentAccountId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">วันที่ชำระ</label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                />
              </div>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              type="submit"
              className="w-full py-2.5 rounded-[10px] bg-accent text-white text-sm font-medium"
            >
              ยืนยันการชำระหนี้
            </button>
          </form>
        )}

        {liabilities.length === 0 ? (
          <div className="bg-surface border border-border rounded-[18px] p-8 text-center text-sm text-muted">
            ยังไม่มีรายการหนี้สิน
          </div>
        ) : (
          <div className="space-y-3">
            {liabilities.map((l) => (
              <div
                key={l.id}
                className="bg-surface border border-border rounded-[18px] p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-muted shrink-0" />
                    <p className="text-sm font-semibold text-primary truncate">
                      {l.debt_name}
                    </p>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {l.creditor_name} · ดอกเบี้ย {Number(l.interest_rate).toFixed(2)}%
                    {l.next_due_date ? ` · ครบกำหนด ${l.next_due_date}` : ''}
                  </p>
                </div>

                <div className="text-right shrink-0 space-y-1.5">
                  <p className="text-sm font-semibold tabular-nums text-primary">
                    {formatTHB(l.outstanding_balance)}
                  </p>
                  {l.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPayingDebt(l);
                        setError(null);
                      }}
                      className="px-2.5 py-1 rounded-[8px] bg-background border border-border text-xs font-medium text-primary hover:border-accent"
                    >
                      ชำระหนี้
                    </button>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
                      ปิดยอดแล้ว
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </MobileShell>
  );
}
