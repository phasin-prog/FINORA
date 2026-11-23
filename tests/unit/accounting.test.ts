import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  AccountingError,
  buildJournalForTransaction,
  buildReversalJournal,
  calculateAccountBalance,
  calculateFinancialPosition,
  validateJournalLines,
} from '@/modules/accounting/engine';
import type { Category, FinancialAccount } from '@/types/financial';

const HOUSEHOLD_ID = '11111111-1111-1111-1111-111111111111';

const bankAccountA: FinancialAccount = {
  id: 'aaaa1111-1111-1111-1111-111111111111',
  household_id: HOUSEHOLD_ID,
  ledger_account_id: 'la-bank-a',
  account_class: 'ASSET',
  name: 'KBank Savings',
  account_type: 'bank',
  currency_code: 'THB',
  opening_balance: '10000.0000',
  is_private: false,
  is_active: true,
};

const bankAccountB: FinancialAccount = {
  id: 'aaaa2222-2222-2222-2222-222222222222',
  household_id: HOUSEHOLD_ID,
  ledger_account_id: 'la-bank-b',
  account_class: 'ASSET',
  name: 'SCB Savings',
  account_type: 'bank',
  currency_code: 'THB',
  opening_balance: '0.0000',
  is_private: false,
  is_active: true,
};

const creditCardAccount: FinancialAccount = {
  id: 'aaaa3333-3333-3333-3333-333333333333',
  household_id: HOUSEHOLD_ID,
  ledger_account_id: 'la-credit-card',
  account_class: 'LIABILITY',
  name: 'KTC Credit Card',
  account_type: 'credit_card',
  currency_code: 'THB',
  opening_balance: '0.0000',
  is_private: false,
  is_active: true,
};

const salaryCategory: Category = {
  id: 'cccc1111-1111-1111-1111-111111111111',
  household_id: HOUSEHOLD_ID,
  parent_id: null,
  ledger_account_id: 'la-salary-income',
  name: 'เงินเดือน (Salary)',
  category_type: 'INCOME',
  sort_order: 1,
  is_system: true,
  is_active: true,
};

const foodCategory: Category = {
  id: 'cccc2222-2222-2222-2222-222222222222',
  household_id: HOUSEHOLD_ID,
  parent_id: null,
  ledger_account_id: 'la-food-expense',
  name: 'อาหารและเครื่องดื่ม (Food)',
  category_type: 'EXPENSE',
  sort_order: 10,
  is_system: true,
  is_active: true,
};

describe('FINORA Double-Entry Accounting Engine', () => {
  it('posts a salary income transaction with balanced Debit = Credit', () => {
    const entry = buildJournalForTransaction({
      householdId: HOUSEHOLD_ID,
      transactionId: 'tx-salary-1',
      transactionType: 'income',
      amount: '25000',
      currencyCode: 'THB',
      transactionDate: '2026-11-23',
      description: 'เงินเดือน',
      account: bankAccountA,
      category: salaryCategory,
    });

    expect(entry.lines).toHaveLength(2);
    expect(entry.lines[0]).toMatchObject({
      ledger_account_id: 'la-bank-a',
      debit: '25000.0000',
      credit: '0.0000',
    });
    expect(entry.lines[1]).toMatchObject({
      ledger_account_id: 'la-salary-income',
      debit: '0.0000',
      credit: '25000.0000',
    });

    const newBankBalance = calculateAccountBalance(
      bankAccountA.opening_balance,
      'ASSET',
      [entry.lines[0]]
    );
    expect(newBankBalance.toFixed(4)).toBe('35000.0000');
  });

  it('maintains exact Decimal precision without floating-point drift (0.1 + 0.2)', () => {
    const entry1 = buildJournalForTransaction({
      householdId: HOUSEHOLD_ID,
      transactionId: 'tx-dec-1',
      transactionType: 'expense',
      amount: '0.1',
      currencyCode: 'THB',
      transactionDate: '2026-11-23',
      description: 'Item 1',
      account: bankAccountA,
      category: foodCategory,
    });
    const entry2 = buildJournalForTransaction({
      householdId: HOUSEHOLD_ID,
      transactionId: 'tx-dec-2',
      transactionType: 'expense',
      amount: '0.2',
      currencyCode: 'THB',
      transactionDate: '2026-11-23',
      description: 'Item 2',
      account: bankAccountA,
      category: foodCategory,
    });

    const bankLines = [entry1.lines[1], entry2.lines[1]];
    const balance = calculateAccountBalance('1.0000', 'ASSET', bankLines);
    expect(balance.toFixed(4)).toBe('0.7000');
  });

  it('posts a transfer between accounts without touching income or expense', () => {
    const entry = buildJournalForTransaction({
      householdId: HOUSEHOLD_ID,
      transactionId: 'tx-transfer-1',
      transactionType: 'transfer',
      amount: '4000',
      currencyCode: 'THB',
      transactionDate: '2026-11-23',
      description: 'โอนออมเงิน',
      account: bankAccountA,
      toAccount: bankAccountB,
    });

    const ledgerIds = entry.lines.map((l) => l.ledger_account_id);
    expect(ledgerIds).toEqual(['la-bank-b', 'la-bank-a']);
    expect(ledgerIds).not.toContain('la-salary-income');
    expect(ledgerIds).not.toContain('la-food-expense');

    const balA = calculateAccountBalance(bankAccountA.opening_balance, 'ASSET', [
      entry.lines[1],
    ]);
    const balB = calculateAccountBalance(bankAccountB.opening_balance, 'ASSET', [
      entry.lines[0],
    ]);
    expect(balA.toFixed(2)).toBe('6000.00');
    expect(balB.toFixed(2)).toBe('4000.00');
    expect(balA.plus(balB).toFixed(2)).toBe('10000.00');
  });

  it('handles credit card expense and subsequent bill repayment without double-counting expenses', () => {
    // Step 1: Buy food 500 THB with Credit Card
    const ccExpense = buildJournalForTransaction({
      householdId: HOUSEHOLD_ID,
      transactionId: 'tx-cc-spend',
      transactionType: 'expense',
      amount: '500',
      currencyCode: 'THB',
      transactionDate: '2026-11-23',
      description: 'Dinner on CC',
      account: creditCardAccount,
      category: foodCategory,
    });

    // Credit Card liability increases to 500
    const ccBalanceAfterSpend = calculateAccountBalance(
      creditCardAccount.opening_balance,
      'LIABILITY',
      [ccExpense.lines[1]]
    );
    expect(ccBalanceAfterSpend.toFixed(2)).toBe('500.00');

    // Step 2: Pay Credit Card bill from Bank A (Transfer: Bank A -> Credit Card)
    const ccRepayment = buildJournalForTransaction({
      householdId: HOUSEHOLD_ID,
      transactionId: 'tx-cc-pay',
      transactionType: 'transfer',
      amount: '500',
      currencyCode: 'THB',
      transactionDate: '2026-11-25',
      description: 'Pay KTC Bill',
      account: bankAccountA,
      toAccount: creditCardAccount,
    });

    const ccBalanceAfterPay = calculateAccountBalance(
      creditCardAccount.opening_balance,
      'LIABILITY',
      [ccExpense.lines[1], ccRepayment.lines[0]]
    );
    const bankBalanceAfterPay = calculateAccountBalance(
      bankAccountA.opening_balance,
      'ASSET',
      [ccRepayment.lines[1]]
    );

    expect(ccBalanceAfterPay.toFixed(2)).toBe('0.00');
    expect(bankBalanceAfterPay.toFixed(2)).toBe('9500.00');
  });

  it('creates a balanced reversal entry that restores original balances', () => {
    const original = buildJournalForTransaction({
      householdId: HOUSEHOLD_ID,
      transactionId: 'tx-food-1',
      transactionType: 'expense',
      amount: '350.50',
      currencyCode: 'THB',
      transactionDate: '2026-11-23',
      description: 'Lunch',
      account: bankAccountA,
      category: foodCategory,
    });

    const reversal = buildReversalJournal({
      householdId: HOUSEHOLD_ID,
      reversalTransactionId: 'tx-food-1-rev',
      reversalDate: '2026-11-23',
      originalDescription: original.description,
      originalLines: original.lines,
      reason: 'Wrong amount',
    });

    const bankLines = [original.lines[1], reversal.lines[1]];
    const restoredBalance = calculateAccountBalance(
      bankAccountA.opening_balance,
      'ASSET',
      bankLines
    );
    expect(restoredBalance.toFixed(4)).toBe('10000.0000');
  });

  it('rejects unbalanced journal lines, single-line entries, and same-account transfers', () => {
    expect(() =>
      validateJournalLines([
        {
          ledger_account_id: 'a',
          debit: '100.0000',
          credit: '0.0000',
          currency_code: 'THB',
          description: 'only one line',
        },
      ])
    ).toThrow(AccountingError);

    expect(() =>
      validateJournalLines([
        {
          ledger_account_id: 'a',
          debit: '100.0000',
          credit: '0.0000',
          currency_code: 'THB',
          description: 'd',
        },
        {
          ledger_account_id: 'b',
          debit: '0.0000',
          credit: '99.9999',
          currency_code: 'THB',
          description: 'c',
        },
      ])
    ).toThrow(AccountingError);

    expect(() =>
      buildJournalForTransaction({
        householdId: HOUSEHOLD_ID,
        transactionId: 'tx-bad-transfer',
        transactionType: 'transfer',
        amount: '100',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        description: 'Self transfer',
        account: bankAccountA,
        toAccount: bankAccountA,
      })
    ).toThrow(AccountingError);
  });

  it('separates Available Cash, Total Assets, Total Liabilities, and Net Worth', () => {
    const pos = calculateFinancialPosition(
      [
        {
          account_type: 'bank',
          account_class: 'ASSET',
          balance: new Decimal('50000'),
        },
        {
          account_type: 'investment',
          account_class: 'ASSET',
          balance: new Decimal('120000'),
        },
        {
          account_type: 'credit_card',
          account_class: 'LIABILITY',
          balance: new Decimal('15000'),
        },
      ],
      [new Decimal('30000')], // e.g. gold/property asset
      [new Decimal('5000')] // e.g. personal loan liability
    );

    expect(pos.availableCash.toFixed(2)).toBe('50000.00');
    expect(pos.totalAssets.toFixed(2)).toBe('200000.00');
    expect(pos.totalLiabilities.toFixed(2)).toBe('20000.00');
    expect(pos.netWorth.toFixed(2)).toBe('180000.00');
  });
});
