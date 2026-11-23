'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LOCAL_HOUSEHOLD_ID,
  DEFAULT_LOCAL_USER_ID,
  ensureLocalHouseholdInitialized,
} from '@/offline/bootstrap';
import { localDb } from '@/offline/indexeddb/db';
import { getPendingOutboxCount } from '@/offline/outbox/queue';
import { registerSafariSyncListeners, syncOutbox } from '@/offline/sync/engine';
import {
  computeAccountBalances,
  queryTransactions,
  type AccountWithBalance,
} from '@/modules/transactions/service';
import { evaluateAndGenerateNotifications } from '@/modules/notifications/notification.service';
import type { Category, Transaction } from '@/types/financial';

export interface FinoraStoreState {
  householdId: string;
  userId: string;
  accounts: AccountWithBalance[];
  categories: Category[];
  transactions: Transaction[];
  pendingSyncCount: number;
  unreadNotificationsCount: number;
  isOnline: boolean;
  isSyncing: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  triggerSync: () => Promise<void>;
}

export function useFinoraStore(): FinoraStoreState {
  const householdId = DEFAULT_LOCAL_HOUSEHOLD_ID;
  const userId = DEFAULT_LOCAL_USER_ID;

  const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    await ensureLocalHouseholdInitialized();
    const [accBal, cats, txs, pending, notifs] = await Promise.all([
      computeAccountBalances(householdId),
      localDb.categories.where('household_id').equals(householdId).sortBy('sort_order'),
      queryTransactions(householdId, { sortBy: 'date_desc' }),
      getPendingOutboxCount(householdId),
      evaluateAndGenerateNotifications(householdId, userId),
    ]);

    setAccounts(accBal);
    setCategories(cats);
    setTransactions(txs);
    setPendingSyncCount(pending);
    setUnreadNotificationsCount(notifs.filter((n) => n.status !== 'read').length);
    setLoading(false);
  }, [householdId, userId]);

  const triggerSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      await syncOutbox(householdId);
      await refresh();
    } finally {
      setIsSyncing(false);
    }
  }, [householdId, refresh]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void refresh();
      }
    });

    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    const cleanupSync = registerSafariSyncListeners(householdId, () => {
      if (active) void refresh();
    });

    return () => {
      active = false;
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      cleanupSync();
    };
  }, [householdId, refresh]);

  return {
    householdId,
    userId,
    accounts,
    categories,
    transactions,
    pendingSyncCount,
    unreadNotificationsCount,
    isOnline,
    isSyncing,
    loading,
    refresh,
    triggerSync,
  };
}
