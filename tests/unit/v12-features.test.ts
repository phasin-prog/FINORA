import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { localDb } from '@/offline/indexeddb/db';
import {
  createFinancialAccount,
  updateFinancialAccount,
} from '@/modules/accounts/service';
import { createCategory } from '@/modules/categories/service';
import {
  calculateInstallmentPlan,
  calculateSpendingAffordability,
  createInstallmentLiability,
} from '@/modules/liabilities/installment';
import {
  computeAccountBalances,
  createLocalTransaction,
  deleteOrReverseTransaction,
  updateOrCorrectTransaction,
} from '@/modules/transactions/service';
import {
  exportFullBackupJson,
  restoreFullBackupJson,
} from '@/offline/backup';
import { importTransactionsFromCsv } from '@/offline/csv-import';
import { sanitizeMoneyInput } from '@/lib/utilities/money';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('FINORA v1.2 Accounts, Categories, Edit/Delete & Installment Calculators', () => {
  beforeEach(async () => {
    await localDb.accounts.clear();
    await localDb.categories.clear();
    await localDb.transactions.clear();
    await localDb.journal_entries.clear();
    await localDb.journal_lines.clear();
    await localDb.outbox.clear();
    await localDb.liabilities.clear();
    await localDb.debt_schedules.clear();
  });

  it('creates and edits a bank account with account_number', async () => {
    const acc = await createFinancialAccount({
      householdId: HOUSEHOLD_ID,
      ownerUserId: USER_ID,
      name: 'KBank ออมทรัพย์',
      accountType: 'bank',
      institution: 'KBank',
      accountNumber: '012-3-45678-9',
      openingBalance: '10000',
      currencyCode: 'THB',
    });

    expect(acc.account_number).toBe('012-3-45678-9');

    const updated = await updateFinancialAccount(acc.id, {
      account_number: '012-3-99999-0',
      opening_balance: '15000',
    });

    expect(updated.account_number).toBe('012-3-99999-0');
    expect(updated.opening_balance).toBe('15000.0000');
  });

  it('creates custom categories and edits/deletes posted transactions with accurate ledger balances', async () => {
    const acc = await createFinancialAccount({
      householdId: HOUSEHOLD_ID,
      ownerUserId: USER_ID,
      name: 'Cash',
      accountType: 'cash',
      openingBalance: '5000',
      currencyCode: 'THB',
    });

    const cat = await createCategory({
      householdId: HOUSEHOLD_ID,
      name: 'กาแฟ',
      categoryType: 'EXPENSE',
      icon: 'coffee',
      color: '#C28B48',
    });

    const { transaction: tx } = await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '100',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: acc.id,
        categoryId: cat.id,
        description: 'Latte',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    // Edit posted transaction amount from 100 -> 150
    const corrected = await updateOrCorrectTransaction(
      tx.id,
      { amount: '150', description: 'Large Latte' },
      USER_ID
    );
    expect(corrected.amount).toBe('150.0000');

    let balances = await computeAccountBalances(HOUSEHOLD_ID);
    expect(balances[0].current_balance).toBe('4850.0000');

    // Delete (reverse) the corrected posted transaction -> restores 5000.0000
    const delRes = await deleteOrReverseTransaction(corrected.id, '2026-11-23');
    expect(delRes.mode).toBe('reversed');

    balances = await computeAccountBalances(HOUSEHOLD_ID);
    expect(balances[0].current_balance).toBe('5000.0000');
  });

  it('calculates 0% and reducing-balance installment plans and spending affordability', async () => {
    const zeroPlan = calculateInstallmentPlan({
      totalPrice: '30000',
      downPayment: '0',
      annualInterestRate: '0',
      months: 10,
      interestMode: 'flat',
      firstDueDate: '2026-12-01',
    });
    expect(zeroPlan.monthlyPayment).toBe('3000.00');
    expect(zeroPlan.totalInterest).toBe('0.00');
    expect(zeroPlan.schedule).toHaveLength(10);

    const reducingPlan = calculateInstallmentPlan({
      totalPrice: '12000',
      downPayment: '2000',
      annualInterestRate: '12',
      months: 10,
      interestMode: 'reducing',
      firstDueDate: '2026-12-01',
    });
    expect(reducingPlan.financedPrincipal).toBe('10000.00');
    expect(Number(reducingPlan.totalInterest)).toBeGreaterThan(0);

    const { liability, schedules } = await createInstallmentLiability({
      householdId: HOUSEHOLD_ID,
      creditorName: 'KTC',
      debtName: 'iPad',
      debtType: 'credit_card',
      calcInput: {
        totalPrice: '30000',
        downPayment: '0',
        annualInterestRate: '0',
        months: 10,
        interestMode: 'flat',
        firstDueDate: '2026-12-01',
      },
    });
    expect(liability.scheduled_payment).toBe('3000.0000');
    expect(schedules).toHaveLength(10);

    const afford = calculateSpendingAffordability({
      monthlyIncome: '25000',
      monthlyBudgetLimit: '15000',
      spentThisMonth: '5000',
      remainingDaysInMonth: 10,
      newMonthlyInstallment: '3000',
    });
    expect(afford.dailySafeToSpend).toBe('1000.00');
    expect(afford.dailySafeAfterInstallment).toBe('700.00');
    expect(afford.debtServiceRatioPct).toBe(12);
    expect(afford.status).toBe('comfortable');
  });

  it('exports and restores full JSON backup cleanly', async () => {
    const acc = await createFinancialAccount({
      householdId: HOUSEHOLD_ID,
      ownerUserId: USER_ID,
      name: 'Backup Bank',
      accountType: 'bank',
      openingBalance: '12345',
      currencyCode: 'THB',
    });

    const json = await exportFullBackupJson();
    await localDb.accounts.clear();
    expect(await localDb.accounts.count()).toBe(0);

    const res = await restoreFullBackupJson(json);
    expect(res.accountsRestored).toBe(1);
    const restoredAcc = await localDb.accounts.get(acc.id);
    expect(restoredAcc?.name).toBe('Backup Bank');
  });

  it('sanitizes non-numeric characters in money inputs (e.g. 300ห -> 300)', () => {
    expect(sanitizeMoneyInput('300ห')).toBe('300');
    expect(sanitizeMoneyInput('1,250.56789')).toBe('1250.5678');
    expect(sanitizeMoneyInput('12.3.4')).toBe('12.34');
  });

  it('imports transactions from CSV and updates double-entry ledger balances', async () => {
    const acc = await createFinancialAccount({
      householdId: HOUSEHOLD_ID,
      ownerUserId: USER_ID,
      name: 'Import Bank',
      accountType: 'bank',
      openingBalance: '1000',
      currencyCode: 'THB',
    });

    await createCategory({
      householdId: HOUSEHOLD_ID,
      name: 'Salary',
      categoryType: 'INCOME',
    });
    await createCategory({
      householdId: HOUSEHOLD_ID,
      name: 'Food',
      categoryType: 'EXPENSE',
    });

    const csv = [
      '\uFEFFdate,type,amount,description',
      '2026-11-20,income,5000,"เงินเดือน, พิเศษ"',
      '2026-11-21,expense,250.50,อาหารกลางวัน',
      '2026-11-22,expense,100,reversed',
    ].join('\n');

    const res = await importTransactionsFromCsv({
      csvText: csv,
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      defaultAccountId: acc.id,
    });

    expect(res.importedCount).toBe(3);
    const balances = await computeAccountBalances(HOUSEHOLD_ID);
    // 1000 + 5000 - 250.50 - 100 = 5649.5000
    expect(balances[0].current_balance).toBe('5649.5000');
  });
});
