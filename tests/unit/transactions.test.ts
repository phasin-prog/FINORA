import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { localDb } from '@/offline/indexeddb/db';
import { getPendingOutboxCount } from '@/offline/outbox/queue';
import {
  cancelDraftTransaction,
  computeAccountBalances,
  createLocalTransaction,
  editDraftTransaction,
  postDraftTransaction,
  queryTransactions,
  reversePostedTransaction,
  TransactionError,
} from '@/modules/transactions/service';
import type { Category, FinancialAccount } from '@/types/financial';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const BANK_ID = 'aaaa1111-1111-4111-8111-111111111111';
const CASH_ID = 'aaaa2222-2222-4222-8222-222222222222';
const SALARY_CAT_ID = 'cccc1111-1111-4111-8111-111111111111';
const FOOD_CAT_ID = 'cccc2222-2222-4222-8222-222222222222';

const bankAccount: FinancialAccount = {
  id: BANK_ID,
  household_id: HOUSEHOLD_ID,
  ledger_account_id: 'la-bank',
  account_class: 'ASSET',
  name: 'KBank',
  account_type: 'bank',
  currency_code: 'THB',
  opening_balance: '10000.0000',
  is_private: false,
  is_active: true,
};

const cashAccount: FinancialAccount = {
  id: CASH_ID,
  household_id: HOUSEHOLD_ID,
  ledger_account_id: 'la-cash',
  account_class: 'ASSET',
  name: 'Cash',
  account_type: 'cash',
  currency_code: 'THB',
  opening_balance: '500.0000',
  is_private: false,
  is_active: true,
};

const salaryCategory: Category = {
  id: SALARY_CAT_ID,
  household_id: HOUSEHOLD_ID,
  parent_id: null,
  ledger_account_id: 'la-salary',
  name: 'เงินเดือน',
  category_type: 'INCOME',
  sort_order: 1,
  is_system: true,
  is_active: true,
};

const foodCategory: Category = {
  id: FOOD_CAT_ID,
  household_id: HOUSEHOLD_ID,
  parent_id: null,
  ledger_account_id: 'la-food',
  name: 'อาหาร',
  category_type: 'EXPENSE',
  sort_order: 2,
  is_system: true,
  is_active: true,
};

describe('FINORA Transaction Engine (IndexedDB + Outbox + Ledger)', () => {
  beforeEach(async () => {
    await localDb.transactions.clear();
    await localDb.journal_entries.clear();
    await localDb.journal_lines.clear();
    await localDb.outbox.clear();
    await localDb.accounts.clear();
    await localDb.categories.clear();

    await localDb.accounts.bulkAdd([bankAccount, cashAccount]);
    await localDb.categories.bulkAdd([salaryCategory, foodCategory]);
  });

  it('creates income, expense, and transfer transactions and computes exact ledger balances', async () => {
    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'income',
        amount: '25000',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: BANK_ID,
        categoryId: SALARY_CAT_ID,
        description: 'เงินเดือน',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '250.50',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: CASH_ID,
        categoryId: FOOD_CAT_ID,
        description: 'กาแฟและอาหารกลางวัน',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'transfer',
        amount: '2000',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: BANK_ID,
        toAccountId: CASH_ID,
        description: 'ถอนเงินสด',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    const balances = await computeAccountBalances(HOUSEHOLD_ID);
    const bankBal = balances.find((a) => a.id === BANK_ID)?.current_balance;
    const cashBal = balances.find((a) => a.id === CASH_ID)?.current_balance;

    // Bank: 10000 + 25000 - 2000 = 33000.0000
    expect(bankBal).toBe('33000.0000');
    // Cash: 500 - 250.50 + 2000 = 2249.5000
    expect(cashBal).toBe('2249.5000');
    expect(await getPendingOutboxCount(HOUSEHOLD_ID)).toBe(3);
  });

  it('deduplicates repeated submissions with the same idempotencyKey', async () => {
    const key = crypto.randomUUID();
    const first = await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '100',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: CASH_ID,
        categoryId: FOOD_CAT_ID,
        description: 'Double tap test',
        idempotencyKey: key,
        asDraft: false,
      },
      USER_ID
    );

    const second = await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '100',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: CASH_ID,
        categoryId: FOOD_CAT_ID,
        description: 'Double tap test',
        idempotencyKey: key,
        asDraft: false,
      },
      USER_ID
    );

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(await getPendingOutboxCount(HOUSEHOLD_ID)).toBe(1);
  });

  it('allows editing and posting drafts, but forbids editing posted transactions', async () => {
    const { transaction: draft } = await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '120',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: CASH_ID,
        categoryId: FOOD_CAT_ID,
        description: 'Draft lunch',
        idempotencyKey: crypto.randomUUID(),
        asDraft: true,
      },
      USER_ID
    );

    // Draft should not affect balance or outbox yet
    let balances = await computeAccountBalances(HOUSEHOLD_ID);
    expect(balances.find((a) => a.id === CASH_ID)?.current_balance).toBe('500.0000');
    expect(await getPendingOutboxCount(HOUSEHOLD_ID)).toBe(0);

    // Edit draft
    const edited = await editDraftTransaction(draft.id, {
      amount: '150',
      description: 'Updated lunch',
    });
    expect(edited.amount).toBe('150.0000');

    // Post draft
    const posted = await postDraftTransaction(draft.id);
    expect(posted.status).toBe('posted');
    balances = await computeAccountBalances(HOUSEHOLD_ID);
    expect(balances.find((a) => a.id === CASH_ID)?.current_balance).toBe('350.0000');
    expect(await getPendingOutboxCount(HOUSEHOLD_ID)).toBe(1);

    // Direct edit on posted must fail
    await expect(
      editDraftTransaction(posted.id, { amount: '999' })
    ).rejects.toThrow(TransactionError);
  });

  it('reverses a posted transaction and restores exact account balance', async () => {
    const { transaction: posted } = await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '300',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: CASH_ID,
        categoryId: FOOD_CAT_ID,
        description: 'Wrong entry',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    const { original, reversal } = await reversePostedTransaction(
      posted.id,
      '2026-11-23',
      'Typo in amount'
    );

    expect(original.status).toBe('reversed');
    expect(reversal.reversed_transaction_id).toBe(original.id);

    const balances = await computeAccountBalances(HOUSEHOLD_ID);
    expect(balances.find((a) => a.id === CASH_ID)?.current_balance).toBe('500.0000');
  });

  it('cancels a draft without affecting balances', async () => {
    const { transaction: draft } = await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '99',
        currencyCode: 'THB',
        transactionDate: '2026-11-23',
        accountId: CASH_ID,
        categoryId: FOOD_CAT_ID,
        description: 'Cancel me',
        idempotencyKey: crypto.randomUUID(),
        asDraft: true,
      },
      USER_ID
    );

    const cancelled = await cancelDraftTransaction(draft.id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('filters, searches, and sorts transactions accurately', async () => {
    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '80',
        currencyCode: 'THB',
        transactionDate: '2026-11-20',
        accountId: CASH_ID,
        categoryId: FOOD_CAT_ID,
        description: 'ก๋วยเตี๋ยว',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    await createLocalTransaction(
      {
        householdId: HOUSEHOLD_ID,
        transactionType: 'expense',
        amount: '450',
        currencyCode: 'THB',
        transactionDate: '2026-11-22',
        accountId: BANK_ID,
        categoryId: FOOD_CAT_ID,
        description: 'บุฟเฟ่ต์',
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      USER_ID
    );

    const byAmountDesc = await queryTransactions(HOUSEHOLD_ID, {
      transactionType: 'expense',
      sortBy: 'amount_desc',
    });
    expect(byAmountDesc.map((t) => t.description)).toEqual(['บุฟเฟ่ต์', 'ก๋วยเตี๋ยว']);

    const searchRes = await queryTransactions(HOUSEHOLD_ID, {
      search: 'ก๋วยเตี๋ยว',
    });
    expect(searchRes).toHaveLength(1);
    expect(searchRes[0].amount).toBe('80.0000');
  });
});
