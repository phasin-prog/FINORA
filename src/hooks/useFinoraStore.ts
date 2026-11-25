'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_LOCAL_HOUSEHOLD_ID,
  DEFAULT_LOCAL_USER_ID,
  ensureLocalHouseholdInitialized,
} from '@/offline/bootstrap';
import { localDb } from '@/offline/indexeddb/db';
import { getPendingOutboxCount } from '@/offline/outbox/queue';
import {
  registerSafariSyncListeners,
  syncOutbox,
  type SyncSummary,
} from '@/offline/sync/engine';
import { pullCloudHouseholdState } from '@/offline/sync/pull';
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
  isAuthenticated: boolean;
  authEmail: string | null;
  accounts: AccountWithBalance[];
  categories: Category[];
  transactions: Transaction[];
  pendingSyncCount: number;
  unreadNotificationsCount: number;
  isOnline: boolean;
  isSyncing: boolean;
  loading: boolean;
  refresh: (pullFromCloud?: boolean) => Promise<void>;
  triggerSync: () => Promise<SyncSummary>;
}

export function useFinoraStore(): FinoraStoreState {
  const [householdId, setHouseholdId] = useState(DEFAULT_LOCAL_HOUSEHOLD_ID);
  const [userId, setUserId] = useState(DEFAULT_LOCAL_USER_ID);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authEmail, setAuthEmail] = useState<string | null>(null);

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

  const hasBootstrappedRef = useRef(false);

  const refresh = useCallback(async (pullFromCloud = false) => {
    let activeHousehold = householdId;
    let activeUser = userId;

    if (!hasBootstrappedRef.current || pullFromCloud) {
      hasBootstrappedRef.current = true;
      try {
        const cloud = await pullCloudHouseholdState();
        if (cloud.authenticated && cloud.householdId && cloud.userId) {
          activeHousehold = cloud.householdId;
          activeUser = cloud.userId;
          setHouseholdId(cloud.householdId);
          setUserId(cloud.userId);
          setIsAuthenticated(true);
          setAuthEmail(cloud.email ?? null);
        } else {
          activeHousehold = DEFAULT_LOCAL_HOUSEHOLD_ID;
          activeUser = DEFAULT_LOCAL_USER_ID;
          setHouseholdId(DEFAULT_LOCAL_HOUSEHOLD_ID);
          setUserId(DEFAULT_LOCAL_USER_ID);
          setIsAuthenticated(false);
          setAuthEmail(null);
          await ensureLocalHouseholdInitialized();
        }
      } catch {
        await ensureLocalHouseholdInitialized();
      }
    }

    const [accBal, cats, txs, pending, notifs] = await Promise.all([
      computeAccountBalances(activeHousehold),
      localDb.categories.where('household_id').equals(activeHousehold).sortBy('sort_order'),
      queryTransactions(activeHousehold, { sortBy: 'date_desc' }),
      getPendingOutboxCount(activeHousehold),
      evaluateAndGenerateNotifications(activeHousehold, activeUser),
    ]);

    setAccounts(accBal);
    setCategories(cats);
    setTransactions(txs);
    setPendingSyncCount(pending);
    setUnreadNotificationsCount(notifs.filter((n) => n.status !== 'read').length);
    setLoading(false);
  }, [householdId, userId]);

  const triggerSync = useCallback(async (): Promise<SyncSummary> => {
    setIsSyncing(true);
    try {
      const summary = await syncOutbox(householdId);
      await refresh(true);
      return summary;
    } catch (err) {
      return {
        syncedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        offline: false,
        error: err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้',
      };
    } finally {
      setIsSyncing(false);
    }
  }, [householdId, refresh]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void refresh(true);
      }
    });

    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    const cleanupSync = registerSafariSyncListeners(householdId, () => {
      if (active) void refresh(true);
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
    isAuthenticated,
    authEmail,
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
