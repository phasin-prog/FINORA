import Decimal from 'decimal.js';
import {
  createTransactionSchema,
  type CreateTransactionInput,
} from '@/lib/validation/transaction';
import { toDecimal, toNumericString } from '@/lib/utilities/money';
import {
  buildJournalForTransaction,
  buildReversalJournal,
  calculateAccountBalance,
} from '@/modules/accounting/engine';
import { localDb } from '@/offline/indexeddb/db';
import { enqueueOutboxOperation } from '@/offline/outbox/queue';
import type {
  FinancialAccount,
  JournalEntry,
  JournalLine,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@/types/financial';

export class TransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionError';
  }
}

export interface TransactionQueryFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  categoryId?: string;
  accountId?: string;
  transactionType?: TransactionType;
  status?: TransactionStatus;
  sortBy?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
}

export interface AccountWithBalance extends FinancialAccount {
  current_balance: string;
}

/**
 * Creates a transaction locally in IndexedDB.
 * - If asDraft=true: saves as 'draft' without posting to the ledger.
 * - Otherwise: posts immediately with a balanced Double-Entry Journal and
 *   queues an Outbox item for Cloud sync.
 */
export async function createLocalTransaction(
  rawInput: CreateTransactionInput,
  createdBy: string
): Promise<{ transaction: Transaction; idempotentReplay: boolean }> {
  const input = createTransactionSchema.parse(rawInput);

  // Idempotency guard (Section 2.2 & 10)
  const existing = await localDb.transactions
    .where('idempotency_key')
    .equals(input.idempotencyKey)
    .first();

  if (existing && existing.household_id === input.householdId) {
    return { transaction: existing, idempotentReplay: true };
  }

  const account = await localDb.accounts.get(input.accountId);
  if (!account || account.household_id !== input.householdId) {
    throw new TransactionError('ไม่พบบัญชีที่เลือกในกลุ่มการเงินนี้');
  }

  const toAccount = input.toAccountId
    ? await localDb.accounts.get(input.toAccountId)
    : null;
  if (input.transactionType === 'transfer' && (!toAccount || toAccount.household_id !== input.householdId)) {
    throw new TransactionError('ไม่พบบัญชีปลายทางในกลุ่มการเงินนี้');
  }

  const category = input.categoryId
    ? await localDb.categories.get(input.categoryId)
    : null;
  if (input.transactionType !== 'transfer' && (!category || category.household_id !== input.householdId)) {
    throw new TransactionError('ไม่พบหมวดหมู่ที่เลือก');
  }

  const now = new Date().toISOString();
  const txId = crypto.randomUUID();
  const normalizedAmount = toNumericString(input.amount, 4);

  if (input.asDraft) {
    const draftTx: Transaction = {
      id: txId,
      household_id: input.householdId,
      created_by: createdBy,
      account_id: input.accountId,
      category_id: input.categoryId ?? null,
      transaction_type: input.transactionType,
      amount: normalizedAmount,
      currency_code: input.currencyCode.toUpperCase(),
      transaction_date: input.transactionDate,
      description: input.description,
      status: 'draft',
      sync_status: 'sync_pending',
      idempotency_key: input.idempotencyKey,
      journal_entry_id: null,
      reversed_transaction_id: null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      created_at: now,
      updated_at: now,
    };

    await localDb.transactions.add(draftTx);
    return { transaction: draftTx, idempotentReplay: false };
  }

  const journalDraft = buildJournalForTransaction({
    householdId: input.householdId,
    transactionId: txId,
    transactionType: input.transactionType,
    amount: normalizedAmount,
    currencyCode: input.currencyCode.toUpperCase(),
    transactionDate: input.transactionDate,
    description: input.description,
    account,
    category,
    toAccount,
  });

  const journalId = crypto.randomUUID();
  const journalEntry: JournalEntry = {
    id: journalId,
    household_id: input.householdId,
    transaction_id: txId,
    entry_date: journalDraft.entry_date,
    description: journalDraft.description,
    status: 'posted',
    posted_at: now,
    created_at: now,
  };

  const journalLines: JournalLine[] = journalDraft.lines.map((line) => ({
    ...line,
    id: crypto.randomUUID(),
    journal_entry_id: journalId,
  }));

  const postedTx: Transaction = {
    id: txId,
    household_id: input.householdId,
    created_by: createdBy,
    account_id: input.accountId,
    category_id: input.categoryId ?? null,
    transaction_type: input.transactionType,
    amount: normalizedAmount,
    currency_code: input.currencyCode.toUpperCase(),
    transaction_date: input.transactionDate,
    description: input.description,
    status: 'posted',
    sync_status: 'sync_pending',
    idempotency_key: input.idempotencyKey,
    journal_entry_id: journalId,
    reversed_transaction_id: null,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
    created_at: now,
    updated_at: now,
  };

  await localDb.transaction(
    'rw',
    [localDb.transactions, localDb.journal_entries, localDb.journal_lines, localDb.outbox],
    async () => {
      await localDb.transactions.add(postedTx);
      await localDb.journal_entries.add(journalEntry);
      await localDb.journal_lines.bulkAdd(journalLines);
      await enqueueOutboxOperation({
        householdId: input.householdId,
        entityType: 'transaction',
        entityId: txId,
        operation: 'create',
        idempotencyKey: input.idempotencyKey,
        payload: {
          ...input,
          id: txId,
          toAccountId: input.toAccountId ?? null,
        },
      });
    }
  );

  return { transaction: postedTx, idempotentReplay: false };
}

/**
 * Edits a draft or pending transaction.
 * Strictly blocks direct edits to posted or reversed transactions (Section 2.2 & 10).
 */
export async function editDraftTransaction(
  txId: string,
  patch: Partial<
    Pick<
      Transaction,
      'amount' | 'transaction_date' | 'description' | 'category_id' | 'account_id' | 'notes' | 'tags'
    >
  >
): Promise<Transaction> {
  const existing = await localDb.transactions.get(txId);
  if (!existing) {
    throw new TransactionError('ไม่พบรายการธุรกรรม');
  }

  if (existing.status === 'posted' || existing.status === 'reversed') {
    throw new TransactionError(
      'ห้ามแก้ไขรายการที่ Post แล้วโดยตรง กรุณาใช้การกลับรายการ (Reverse) แล้วสร้างรายการใหม่'
    );
  }

  if (existing.status === 'cancelled') {
    throw new TransactionError('ไม่สามารถแก้ไขรายการที่ยกเลิกแล้ว');
  }

  const nextAmount = patch.amount ? toNumericString(patch.amount, 4) : existing.amount;
  const updated: Transaction = {
    ...existing,
    ...patch,
    amount: nextAmount,
    updated_at: new Date().toISOString(),
  };

  await localDb.transactions.put(updated);
  return updated;
}

/**
 * Posts a local draft transaction to the Double-Entry Ledger and queues sync.
 */
export async function postDraftTransaction(
  txId: string,
  toAccountId?: string | null
): Promise<Transaction> {
  const tx = await localDb.transactions.get(txId);
  if (!tx) {
    throw new TransactionError('ไม่พบรายการธุรกรรม');
  }
  if (tx.status !== 'draft' && tx.status !== 'pending') {
    throw new TransactionError(`ไม่สามารถ Post รายการที่มีสถานะ ${tx.status} ได้`);
  }

  const account = await localDb.accounts.get(tx.account_id);
  if (!account) {
    throw new TransactionError('ไม่พบบัญชีของรายการนี้');
  }

  const toAccount = toAccountId ? await localDb.accounts.get(toAccountId) : null;
  const category = tx.category_id ? await localDb.categories.get(tx.category_id) : null;

  const journalDraft = buildJournalForTransaction({
    householdId: tx.household_id,
    transactionId: tx.id,
    transactionType: tx.transaction_type,
    amount: tx.amount,
    currencyCode: tx.currency_code,
    transactionDate: tx.transaction_date,
    description: tx.description,
    account,
    category,
    toAccount,
  });

  const now = new Date().toISOString();
  const journalId = crypto.randomUUID();
  const journalEntry: JournalEntry = {
    id: journalId,
    household_id: tx.household_id,
    transaction_id: tx.id,
    entry_date: journalDraft.entry_date,
    description: journalDraft.description,
    status: 'posted',
    posted_at: now,
    created_at: now,
  };

  const journalLines: JournalLine[] = journalDraft.lines.map((line) => ({
    ...line,
    id: crypto.randomUUID(),
    journal_entry_id: journalId,
  }));

  const postedTx: Transaction = {
    ...tx,
    status: 'posted',
    sync_status: 'sync_pending',
    journal_entry_id: journalId,
    updated_at: now,
  };

  await localDb.transaction(
    'rw',
    [localDb.transactions, localDb.journal_entries, localDb.journal_lines, localDb.outbox],
    async () => {
      await localDb.transactions.put(postedTx);
      await localDb.journal_entries.add(journalEntry);
      await localDb.journal_lines.bulkAdd(journalLines);
      await enqueueOutboxOperation({
        householdId: tx.household_id,
        entityType: 'transaction',
        entityId: tx.id,
        operation: 'create',
        idempotencyKey: tx.idempotency_key,
        payload: {
          id: tx.id,
          householdId: tx.household_id,
          transactionType: tx.transaction_type,
          amount: tx.amount,
          currencyCode: tx.currency_code,
          transactionDate: tx.transaction_date,
          accountId: tx.account_id,
          toAccountId: toAccountId ?? null,
          categoryId: tx.category_id,
          description: tx.description,
          notes: tx.notes ?? null,
          tags: tx.tags ?? [],
          idempotencyKey: tx.idempotency_key,
        },
      });
    }
  );

  return postedTx;
}

/**
 * Reverses a posted transaction by creating a counter-balancing reversal
 * transaction and journal entry (Section 10 Rule 4).
 */
export async function reversePostedTransaction(
  txId: string,
  reversalDate: string,
  reason = 'User reversal'
): Promise<{ original: Transaction; reversal: Transaction }> {
  const original = await localDb.transactions.get(txId);
  if (!original) {
    throw new TransactionError('ไม่พบรายการธุรกรรมที่ต้องการกลับรายการ');
  }
  if (original.status !== 'posted' || !original.journal_entry_id) {
    throw new TransactionError('สามารถกลับรายการได้เฉพาะรายการที่ Post แล้วเท่านั้น');
  }

  const originalLines = await localDb.journal_lines
    .where('journal_entry_id')
    .equals(original.journal_entry_id)
    .toArray();

  const reversalTxId = crypto.randomUUID();
  const reversalIdempotencyKey = crypto.randomUUID();

  const reversalJournalDraft = buildReversalJournal({
    householdId: original.household_id,
    reversalTransactionId: reversalTxId,
    reversalDate,
    originalDescription: original.description,
    originalLines,
    reason,
  });

  const now = new Date().toISOString();
  const reversalJournalId = crypto.randomUUID();

  const reversalJournal: JournalEntry = {
    id: reversalJournalId,
    household_id: original.household_id,
    transaction_id: reversalTxId,
    entry_date: reversalJournalDraft.entry_date,
    description: reversalJournalDraft.description,
    status: 'posted',
    posted_at: now,
    created_at: now,
  };

  const reversalLines: JournalLine[] = reversalJournalDraft.lines.map((line) => ({
    ...line,
    id: crypto.randomUUID(),
    journal_entry_id: reversalJournalId,
  }));

  const updatedOriginal: Transaction = {
    ...original,
    status: 'reversed',
    sync_status: 'sync_pending',
    updated_at: now,
  };

  const reversalTx: Transaction = {
    id: reversalTxId,
    household_id: original.household_id,
    created_by: original.created_by,
    account_id: original.account_id,
    category_id: original.category_id,
    transaction_type: original.transaction_type,
    amount: original.amount,
    currency_code: original.currency_code,
    transaction_date: reversalDate,
    description: reversalJournalDraft.description,
    status: 'posted',
    sync_status: 'sync_pending',
    idempotency_key: reversalIdempotencyKey,
    journal_entry_id: reversalJournalId,
    reversed_transaction_id: original.id,
    notes: reason,
    tags: original.tags ?? [],
    created_at: now,
    updated_at: now,
  };

  await localDb.transaction(
    'rw',
    [localDb.transactions, localDb.journal_entries, localDb.journal_lines, localDb.outbox],
    async () => {
      await localDb.transactions.put(updatedOriginal);
      await localDb.transactions.add(reversalTx);
      await localDb.journal_entries.update(original.journal_entry_id!, { status: 'reversed' });
      await localDb.journal_entries.add(reversalJournal);
      await localDb.journal_lines.bulkAdd(reversalLines);

      // If the original 'create' never synced to Cloud yet, cancel it from Outbox
      // instead of queuing both 'create' and 'reverse'.
      const unsyncedCreate = await localDb.outbox
        .where('entity_id')
        .equals(original.id)
        .filter((o) => o.operation === 'create' && o.sync_status !== 'conflict')
        .first();

      if (unsyncedCreate) {
        await localDb.outbox.delete(unsyncedCreate.id);
        await localDb.transactions.update(original.id, { sync_status: 'synced' });
        await localDb.transactions.update(reversalTxId, { sync_status: 'synced' });
      } else {
        await enqueueOutboxOperation({
          householdId: original.household_id,
          entityType: 'transaction',
          entityId: reversalTxId,
          operation: 'reverse',
          idempotencyKey: reversalIdempotencyKey,
          payload: {
            originalTransactionId: original.id,
            reversalTransactionId: reversalTxId,
            reversalDate,
            idempotencyKey: reversalIdempotencyKey,
            reason,
          },
        });
      }
    }
  );

  return { original: updatedOriginal, reversal: reversalTx };
}

/**
 * Cancels a draft or pending transaction (never a posted transaction).
 */
export async function cancelDraftTransaction(txId: string): Promise<Transaction> {
  const tx = await localDb.transactions.get(txId);
  if (!tx) {
    throw new TransactionError('ไม่พบรายการธุรกรรม');
  }
  if (tx.status !== 'draft' && tx.status !== 'pending') {
    throw new TransactionError('ยกเลิกได้เฉพาะรายการ Draft หรือ Pending เท่านั้น');
  }
  const cancelled: Transaction = {
    ...tx,
    status: 'cancelled',
    updated_at: new Date().toISOString(),
  };
  await localDb.transactions.put(cancelled);
  return cancelled;
}

/**
 * User-friendly edit for any transaction (including posted ones):
 * - Draft/Pending: edits in place.
 * - Posted: performs an audit-safe Reversal + Re-entry with the updated amount/details
 *   so the Double-Entry General Ledger remains 100% balanced and traceable.
 */
export async function updateOrCorrectTransaction(
  txId: string,
  patch: {
    amount?: string;
    transactionDate?: string;
    description?: string;
    categoryId?: string | null;
    accountId?: string;
    toAccountId?: string | null;
  },
  actorUserId: string
): Promise<Transaction> {
  const existing = await localDb.transactions.get(txId);
  if (!existing) {
    throw new TransactionError('ไม่พบรายการธุรกรรม');
  }

  if (existing.status === 'draft' || existing.status === 'pending') {
    return editDraftTransaction(txId, {
      amount: patch.amount,
      transaction_date: patch.transactionDate,
      description: patch.description,
      category_id: patch.categoryId,
      account_id: patch.accountId,
    });
  }

  if (existing.status !== 'posted') {
    throw new TransactionError(`ไม่สามารถแก้ไขรายการที่มีสถานะ ${existing.status} ได้`);
  }

  await reversePostedTransaction(
    existing.id,
    patch.transactionDate ?? existing.transaction_date,
    'แก้ไขรายการ'
  );

  const { transaction: corrected } = await createLocalTransaction(
    {
      householdId: existing.household_id,
      transactionType: existing.transaction_type,
      amount: patch.amount ?? existing.amount,
      currencyCode: existing.currency_code,
      transactionDate: patch.transactionDate ?? existing.transaction_date,
      accountId: patch.accountId ?? existing.account_id,
      toAccountId: patch.toAccountId ?? null,
      categoryId:
        patch.categoryId !== undefined ? patch.categoryId : existing.category_id,
      description:
        patch.description !== undefined ? patch.description : existing.description,
      notes: existing.notes ?? null,
      tags: existing.tags ?? [],
      idempotencyKey: crypto.randomUUID(),
      asDraft: false,
    },
    actorUserId
  );

  return corrected;
}

/**
 * Deletes a draft/cancelled transaction, or reverses a posted transaction
 * so account balances are accurately restored.
 */
export async function deleteOrReverseTransaction(
  txId: string,
  reversalDate: string
): Promise<{ mode: 'deleted' | 'reversed' }> {
  const existing = await localDb.transactions.get(txId);
  if (!existing) {
    throw new TransactionError('ไม่พบรายการธุรกรรม');
  }

  if (
    existing.status === 'draft' ||
    existing.status === 'pending' ||
    existing.status === 'cancelled'
  ) {
    await localDb.transactions.delete(txId);
    return { mode: 'deleted' };
  }

  if (existing.status === 'posted') {
    await reversePostedTransaction(txId, reversalDate, 'ลบรายการโดยผู้ใช้');
    return { mode: 'reversed' };
  }

  throw new TransactionError('รายการนี้ถูกกลับรายการไปแล้ว');
}

/**
 * Queries transactions with search, filters, and Decimal-safe amount sorting (Screen 03).
 */
export async function queryTransactions(
  householdId: string,
  filters: TransactionQueryFilters = {}
): Promise<Transaction[]> {
  let items = await localDb.transactions
    .where('household_id')
    .equals(householdId)
    .toArray();

  if (filters.dateFrom) {
    items = items.filter((t) => t.transaction_date >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    items = items.filter((t) => t.transaction_date <= filters.dateTo!);
  }
  if (filters.categoryId) {
    items = items.filter((t) => t.category_id === filters.categoryId);
  }
  if (filters.accountId) {
    items = items.filter((t) => t.account_id === filters.accountId);
  }
  if (filters.transactionType) {
    items = items.filter((t) => t.transaction_type === filters.transactionType);
  }
  if (filters.status) {
    items = items.filter((t) => t.status === filters.status);
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    items = items.filter(
      (t) =>
        t.description.toLowerCase().includes(q) ||
        (t.notes?.toLowerCase().includes(q) ?? false) ||
        (t.tags?.some((tag) => tag.toLowerCase().includes(q)) ?? false)
    );
  }

  const sortBy = filters.sortBy ?? 'date_desc';
  items.sort((a, b) => {
    if (sortBy === 'date_asc') {
      return a.transaction_date.localeCompare(b.transaction_date) || a.created_at.localeCompare(b.created_at);
    }
    if (sortBy === 'amount_desc') {
      return toDecimal(b.amount).comparedTo(toDecimal(a.amount));
    }
    if (sortBy === 'amount_asc') {
      return toDecimal(a.amount).comparedTo(toDecimal(b.amount));
    }
    // Default: date_desc
    return b.transaction_date.localeCompare(a.transaction_date) || b.created_at.localeCompare(a.created_at);
  });

  return items;
}

/**
 * Computes account balances strictly from opening_balance + posted/reversed journal lines.
 * Draft and cancelled transactions are excluded.
 */
export async function computeAccountBalances(
  householdId: string
): Promise<AccountWithBalance[]> {
  const accounts = await localDb.accounts
    .where('household_id')
    .equals(householdId)
    .toArray();

  const entries = await localDb.journal_entries
    .where('household_id')
    .equals(householdId)
    .filter((je) => je.status === 'posted' || je.status === 'reversed')
    .toArray();

  const entryIds = new Set(entries.map((e) => e.id));
  const allLines = await localDb.journal_lines.toArray();
  const postedLinesByLedger = new Map<string, JournalLine[]>();

  for (const line of allLines) {
    if (!entryIds.has(line.journal_entry_id)) continue;
    const list = postedLinesByLedger.get(line.ledger_account_id) ?? [];
    list.push(line);
    postedLinesByLedger.set(line.ledger_account_id, list);
  }

  return accounts.map((acc) => {
    const lines = postedLinesByLedger.get(acc.ledger_account_id) ?? [];
    const balance: Decimal = calculateAccountBalance(
      acc.opening_balance,
      acc.account_class,
      lines
    );
    return {
      ...acc,
      current_balance: balance.toFixed(4),
    };
  });
}
