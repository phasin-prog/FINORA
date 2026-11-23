import Decimal from 'decimal.js';
import { toDecimal, toNumericString } from '@/lib/utilities/money';
import { localDb } from '@/offline/indexeddb/db';
import { createLiability } from '@/modules/liabilities/service';
import type { DebtSchedule, DebtType, Liability } from '@/types/financial';

export interface InstallmentCalculationInput {
  totalPrice: string;
  downPayment?: string;
  annualInterestRate: string; // e.g. "0", "12"
  months: number;
  interestMode: 'flat' | 'reducing';
  firstDueDate: string; // YYYY-MM-DD
}

export interface InstallmentScheduleRow {
  installmentNo: number;
  dueDate: string;
  principalDue: string;
  interestDue: string;
  totalDue: string;
  remainingBalance: string;
}

export interface InstallmentPlanResult {
  financedPrincipal: string;
  monthlyPayment: string;
  totalInterest: string;
  totalPayable: string;
  schedule: InstallmentScheduleRow[];
}

function addMonthsYYYYMMDD(baseDate: string, monthsToAdd: number): string {
  const [y, m, d] = baseDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + monthsToAdd, d));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function calculateInstallmentPlan(
  input: InstallmentCalculationInput
): InstallmentPlanResult {
  if (!Number.isInteger(input.months) || input.months <= 0 || input.months > 360) {
    throw new Error('จำนวนงวดต้องอยู่ระหว่าง 1 ถึง 360 เดือน');
  }

  const totalPrice = toDecimal(input.totalPrice);
  const down = toDecimal(input.downPayment || '0');
  const principal = totalPrice.minus(down);
  if (principal.lte(0)) {
    throw new Error('ยอดจัดผ่อนหลังหักเงินดาวน์ต้องมากกว่า 0');
  }

  const annualRate = toDecimal(input.annualInterestRate || '0');
  if (annualRate.lt(0)) {
    throw new Error('อัตราดอกเบี้ยต้องไม่ติดลบ');
  }

  const schedule: InstallmentScheduleRow[] = [];
  let totalInterest = new Decimal(0);
  let monthlyPayment = new Decimal(0);

  if (annualRate.eq(0) || input.interestMode === 'flat') {
    // Flat-rate / 0% installment
    const years = new Decimal(input.months).div(12);
    totalInterest = principal.times(annualRate.div(100)).times(years);
    const totalPayable = principal.plus(totalInterest);
    monthlyPayment = totalPayable.div(input.months);

    const basePrincipal = principal.div(input.months).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    const baseInterest = totalInterest.div(input.months).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    let rem = principal;

    for (let i = 1; i <= input.months; i += 1) {
      const isLast = i === input.months;
      const pDue = isLast ? rem : basePrincipal;
      const iDue = isLast
        ? totalInterest.minus(baseInterest.times(input.months - 1))
        : baseInterest;
      rem = rem.minus(pDue);

      schedule.push({
        installmentNo: i,
        dueDate: addMonthsYYYYMMDD(input.firstDueDate, i - 1),
        principalDue: pDue.toFixed(2),
        interestDue: iDue.toFixed(2),
        totalDue: pDue.plus(iDue).toFixed(2),
        remainingBalance: rem.toFixed(2),
      });
    }
  } else {
    // Reducing-balance PMT formula
    const r = annualRate.div(100).div(12);
    const onePlusR = new Decimal(1).plus(r);
    const factor = onePlusR.pow(input.months);
    monthlyPayment = principal.times(r.times(factor)).div(factor.minus(1));

    let rem = principal;
    for (let i = 1; i <= input.months; i += 1) {
      const isLast = i === input.months;
      const iDue = rem.times(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const pDue = isLast
        ? rem
        : monthlyPayment.minus(iDue).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      rem = rem.minus(pDue);
      totalInterest = totalInterest.plus(iDue);

      schedule.push({
        installmentNo: i,
        dueDate: addMonthsYYYYMMDD(input.firstDueDate, i - 1),
        principalDue: pDue.toFixed(2),
        interestDue: iDue.toFixed(2),
        totalDue: pDue.plus(iDue).toFixed(2),
        remainingBalance: rem.toFixed(2),
      });
    }
  }

  const totalPayable = principal.plus(totalInterest);

  return {
    financedPrincipal: principal.toFixed(2),
    monthlyPayment: monthlyPayment.toFixed(2),
    totalInterest: totalInterest.toFixed(2),
    totalPayable: totalPayable.toFixed(2),
    schedule,
  };
}

export async function createInstallmentLiability(params: {
  householdId: string;
  creditorName: string;
  debtName: string;
  debtType: DebtType;
  calcInput: InstallmentCalculationInput;
}): Promise<{ liability: Liability; schedules: DebtSchedule[]; plan: InstallmentPlanResult }> {
  const plan = calculateInstallmentPlan(params.calcInput);

  const liability = await createLiability({
    householdId: params.householdId,
    creditorName: params.creditorName,
    debtName: params.debtName,
    debtType: params.debtType,
    originalPrincipal: toNumericString(plan.financedPrincipal, 4),
    outstandingBalance: toNumericString(plan.financedPrincipal, 4),
    interestRate: toNumericString(params.calcInput.annualInterestRate || '0', 4),
    interestType:
      toDecimal(params.calcInput.annualInterestRate || '0').eq(0)
        ? 'zero'
        : params.calcInput.interestMode === 'flat'
          ? 'fixed'
          : 'reducing',
    minimumPayment: toNumericString(plan.monthlyPayment, 4),
    scheduledPayment: toNumericString(plan.monthlyPayment, 4),
    paymentFrequency: 'monthly',
    nextDueDate: params.calcInput.firstDueDate,
    currencyCode: 'THB',
  });

  const schedules: DebtSchedule[] = plan.schedule.map((row) => ({
    id: crypto.randomUUID(),
    liability_id: liability.id,
    installment_no: row.installmentNo,
    due_date: row.dueDate,
    principal_due: toNumericString(row.principalDue, 4),
    interest_due: toNumericString(row.interestDue, 4),
    is_paid: false,
  }));

  await localDb.debt_schedules.bulkAdd(schedules);
  return { liability, schedules, plan };
}

export interface SpendingAffordabilityResult {
  remainingBudget: string;
  dailySafeToSpend: string;
  dailySafeAfterInstallment: string;
  debtServiceRatioPct: number;
  status: 'comfortable' | 'tight' | 'over_budget';
}

export function calculateSpendingAffordability(params: {
  monthlyIncome: string;
  monthlyBudgetLimit: string;
  spentThisMonth: string;
  remainingDaysInMonth: number;
  newMonthlyInstallment?: string;
}): SpendingAffordabilityResult {
  const income = toDecimal(params.monthlyIncome || '0');
  const limit = toDecimal(params.monthlyBudgetLimit || '0');
  const spent = toDecimal(params.spentThisMonth || '0');
  const installment = toDecimal(params.newMonthlyInstallment || '0');
  const days = Math.max(1, params.remainingDaysInMonth);

  const remainingBudget = limit.minus(spent);
  const dailySafe = remainingBudget.div(days);
  const dailyAfterInstallment = remainingBudget.minus(installment).div(days);

  const dsr = income.gt(0)
    ? Number(installment.div(income).times(100).toFixed(1))
    : 0;

  let status: SpendingAffordabilityResult['status'] = 'comfortable';
  if (remainingBudget.minus(installment).lt(0) || dsr > 40) {
    status = 'over_budget';
  } else if (dsr > 25 || dailyAfterInstallment.lt(100)) {
    status = 'tight';
  }

  return {
    remainingBudget: remainingBudget.toFixed(2),
    dailySafeToSpend: dailySafe.toFixed(2),
    dailySafeAfterInstallment: dailyAfterInstallment.toFixed(2),
    debtServiceRatioPct: dsr,
    status,
  };
}
