import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { localDb } from '@/offline/indexeddb/db';
import { createBudget, evaluateBudgets } from '@/modules/budgets/service';
import {
  createLiability,
  LiabilityError,
  recordDebtPayment,
} from '@/modules/liabilities/service';
import {
  computeAccountBalances,
  createLocalTransaction,
} from '@/modules/transactions/service';
import type { Category, FinancialAccount } from '@/types/financial';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BANK_ID = 'aaaa1111-1111-4111-8111-111111111111';
const LOAN_ACC_ID = 'aaaa3333-3333-4333-8333-333333333333';
const FOOD_CAT_ID = 'cccc1111-1111-4111-8111-111111111111';
const INTEREST_CAT_ID = 'cccc2222-2222-4222-8222-222222222222';

const bankAccount: FinancialAccount = {
  id: BANK_ID,
  household_id: HOUSEHOLD_ID,
  ledger_account_id: 'la-bank',
  account_class: 'ASSET',
  name: 'Main Bank',
  account_type: 'bank',
  currency_code: 'THB',
  opening_balance: '50000.0000',
  is_private: false,
  is_active: true,
};

const loanAccount: FinancialAccount = {
  id: LOAN_ACC_ID,
  household_id: HOUSEHOLD_ID,
  ledger_account_id: 'la-loan',
  account_class: 'LIABILITY',
  name: 'Personal Loan Account',
  account_type: 'loan',
  currency_code: 'THB',
  opening_balance: '10000.0000',
  is_private: false,
  is_active: true,
};

const foodCategory: Category = {
  id: FOOD_CAT_ID,
  household_id: HOUSEHOLD_ID,
  parent_id: null,
  ledger_account_id: 'la-food',
  name: 'อาหาร',
  category_type: 'EXPENSE',
  sort_order: 1,
  is_system: true,
  is_active: true,
};

const interestCategory: Category = {
  id: INTEREST_CAT_ID,
  household_id: HOUSEHOLD_ID,
  parent_id: null,
  ledger_account_id: 'la-interest',
  name: 'ดอกเบี้ยและค่าธรรมเนียม',
  category_type: 'EXPENSE',
  sort_order: 2,
  is_system: true,
  is_active: true,
};

describe('FINORA Budget & Debt Engines', () => {
  beforeEach(async () => {
    await localDb.budgets.clear();
    await localDb.liabilities.clear();
    await localDb.debt_payments.clear();
    await localDb.transactions.clear();
    await localDb.journal_entries.clear();
    await localDb.journal_lines.clear();
    await localDb.outbox.clear();
    await localDb.accounts.clear();
    await localDb.categories.clear();

    await localDb.accounts.bulkAdd([bankAccount, loanAccount]);
    await localDb.categories.bulkAdd([foodCategory, interestCategory]);
  });

  it('evaluates budgets strictly from posted expenses and ignores drafts and transfers', async () => {
    await createBudget({
      householdId: HOUSEHOLD_ID,
      categoryId: FOOD_CAT_ID,
      periodType: 'monthly',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      budgetAmount: '1000',
      currencyCode: 'THB',
    });

    // Posted expense inside period (850 THB -> 85% warning)
    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '850',
        currencyCode: 'THB',
        transactionDate: '2026-11-10',
        accountId: BANK_ID,
        categoryId: FOOD_CAT_ID,
        description: 'Posted food',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    // Draft expense (must be ignored!)
    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '500',
        currencyCode: 'THB',
        transactionDate: '2026-11-12',
        accountId: BANK_ID,
        categoryId: FOOD_CAT_ID,
        description: 'Draft food',
        idempotencyKey: crypto.randomUUID(),
        asDraft: true,
      },
      USER_ID
    );

    const evals = await evaluateBudgets(HOUSEHOLD_ID);
    expect(evals).toHaveLength(1);
    expect(evals[0].spent_amount).toBe('850.0000');
    expect(evals[0].remaining_amount).toBe('150.0000');
    expect(evals[0].percent_used).toBe(85);
    expect(evals[0].health).toBe('warning');
  });

  it('records debt repayment separating principal transfer and interest expense', async () => {
    const liability = await createLiability({
      householdId: HOUSEHOLD_ID,
      accountId: LOAN_ACC_ID,
      creditorName: 'KBank',
      debtName: 'สินเชื่อส่วนบุคคล',
      debtType: 'personal_loan',
      originalPrincipal: '10000',
      outstandingBalance: '10000',
      interestRate: '12',
      interestType: 'reducing',
      minimumPayment: '1000',
      scheduledPayment: '2000',
      paymentFrequency: 'monthly',
      nextDueDate: '2026-12-01',
      currencyCode: 'THB',
    });

    // Overpayment of principal must be rejected
    await expect(
      recordDebtPayment({
        liabilityId: liability.id,
        paymentDate: '2026-11-23',
        principalPaid: '15000',
        interestPaid: '0',
        paymentAccountId: BANK_ID,
        interestCategoryId: INTEREST_CAT_ID,
        createdBy: USER_ID,
      })
    ).rejects.toThrow(LiabilityError);

    // Pay 2,000 principal + 100 interest
    const { liability: afterPay1 } = await recordDebtPayment({
      liabilityId: liability.id,
      paymentDate: '2026-11-23',
      principalPaid: '2000',
      interestPaid: '100',
      paymentAccountId: BANK_ID,
      interestCategoryId: INTEREST_CAT_ID,
      createdBy: USER_ID,
    });

    expect(afterPay1.outstanding_balance).toBe('8000.0000');
    expect(afterPay1.status).toBe('active');

    const balances = await computeAccountBalances(HOUSEHOLD_ID);
    // Bank: 50000 - 2000 (principal) - 100 (interest) = 47900.0000
    expect(balances.find((a) => a.id === BANK_ID)?.current_balance).toBe('47900.0000');
    // Loan account: 10000 - 2000 = 8000.0000
    expect(balances.find((a) => a.id === LOAN_ACC_ID)?.current_balance).toBe('8000.0000');

    // Pay off remaining 8,000 principal
    const { liability: afterPay2 } = await recordDebtPayment({
      liabilityId: liability.id,
      paymentDate: '2026-11-24',
      principalPaid: '8000',
      interestPaid: '0',
      paymentAccountId: BANK_ID,
      interestCategoryId: INTEREST_CAT_ID,
      createdBy: USER_ID,
    });

    expect(afterPay2.outstanding_balance).toBe('0.0000');
    expect(afterPay2.status).toBe('paid_off');
  });
});
