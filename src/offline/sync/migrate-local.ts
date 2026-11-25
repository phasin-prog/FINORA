import { getClientAuthHeaders } from '@/lib/supabase/client';
import { DEFAULT_LOCAL_HOUSEHOLD_ID } from '@/offline/bootstrap';
import { localDb } from '@/offline/indexeddb/db';
import type { Category, FinancialAccount } from '@/types/financial';

/**
 * Migrates local-only records (created under DEFAULT_LOCAL_HOUSEHOLD_ID before
 * Cloud login) into the user's real Supabase household.
 */
export async function pushLocalDataToCloudHousehold(params: {
  cloudHouseholdId: string;
  cloudAccounts: FinancialAccount[];
  cloudCategories: Category[];
}): Promise<{ uploadedTransactions: number }> {
  const [localAccounts, localCategories, localTxs] = await Promise.all([
    localDb.accounts.where('household_id').equals(DEFAULT_LOCAL_HOUSEHOLD_ID).toArray(),
    localDb.categories.where('household_id').equals(DEFAULT_LOCAL_HOUSEHOLD_ID).toArray(),
    localDb.transactions
      .where('household_id')
      .equals(DEFAULT_LOCAL_HOUSEHOLD_ID)
      .filter((t) => t.status === 'posted' && !t.reversed_transaction_id)
      .toArray(),
  ]);

  if (localTxs.length === 0 && localAccounts.length === 0) {
    return { uploadedTransactions: 0 };
  }

  const authHeaders = await getClientAuthHeaders();
  if (!authHeaders.Authorization) {
    return { uploadedTransactions: 0 };
  }

  // 1. Map local accounts -> cloud accounts (match by name/type or create)
  const accountIdMap = new Map<string, string>();
  for (const la of localAccounts) {
    const matched =
      params.cloudAccounts.find((ca) => ca.name === la.name) ??
      params.cloudAccounts.find((ca) => ca.account_type === la.account_type);

    if (matched) {
      accountIdMap.set(la.id, matched.id);
    } else {
      const newId = crypto.randomUUID();
      await fetch('/api/sync/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          kind: 'account',
          data: {
            id: newId,
            household_id: params.cloudHouseholdId,
            name: la.name,
            account_type: la.account_type,
            institution: la.institution ?? null,
            account_number: la.account_number ?? null,
            icon: la.icon ?? null,
            currency_code: la.currency_code,
            opening_balance: la.opening_balance,
            is_active: la.is_active,
          },
        }),
      });
      accountIdMap.set(la.id, newId);
    }
  }

  // 2. Map local categories -> cloud categories
  const categoryIdMap = new Map<string, string>();
  for (const lc of localCategories) {
    const matched =
      params.cloudCategories.find((cc) => cc.name === lc.name) ??
      params.cloudCategories.find((cc) => cc.category_type === lc.category_type);

    if (matched) {
      categoryIdMap.set(lc.id, matched.id);
    } else {
      const newId = crypto.randomUUID();
      await fetch('/api/sync/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          kind: 'category',
          data: {
            id: newId,
            household_id: params.cloudHouseholdId,
            name: lc.name,
            category_type: lc.category_type,
            icon: lc.icon ?? null,
            color: lc.color ?? null,
            sort_order: lc.sort_order,
            is_active: lc.is_active,
          },
        }),
      });
      categoryIdMap.set(lc.id, newId);
    }
  }

  // 3. Upload active posted transactions in batches
  const items = localTxs
    .map((tx) => {
      const mappedAccount = accountIdMap.get(tx.account_id);
      if (!mappedAccount) return null;
      const mappedCategory = tx.category_id
        ? categoryIdMap.get(tx.category_id) ?? null
        : null;

      return {
        outboxId: crypto.randomUUID(),
        operation: 'create' as const,
        payload: {
          id: tx.id,
          householdId: params.cloudHouseholdId,
          transactionType: tx.transaction_type,
          amount: tx.amount,
          currencyCode: tx.currency_code,
          transactionDate: tx.transaction_date,
          accountId: mappedAccount,
          toAccountId: null,
          categoryId: tx.transaction_type === 'transfer' ? null : mappedCategory,
          description: tx.description,
          notes: tx.notes ?? null,
          tags: tx.tags ?? [],
          idempotencyKey: tx.idempotency_key,
          asDraft: false,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.payload.transactionType !== 'transfer');

  if (items.length === 0) {
    return { uploadedTransactions: 0 };
  }

  const res = await fetch('/api/transactions/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ items: items.slice(0, 50) }),
  });

  if (!res.ok) {
    return { uploadedTransactions: 0 };
  }

  // Mark local seed transactions as migrated by clearing DEFAULT_LOCAL_HOUSEHOLD_ID outbox
  await localDb.outbox
    .where('household_id')
    .equals(DEFAULT_LOCAL_HOUSEHOLD_ID)
    .delete();

  return { uploadedTransactions: items.length };
}
