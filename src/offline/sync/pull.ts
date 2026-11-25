import { localDb } from '@/offline/indexeddb/db';
import {
  createSupabaseBrowserClient,
  getClientAuthHeaders,
} from '@/lib/supabase/client';
import { pushLocalDataToCloudHousehold } from '@/offline/sync/migrate-local';
import type {
  Budget,
  Category,
  FinancialAccount,
  JournalEntry,
  JournalLine,
  Liability,
  Transaction,
} from '@/types/financial';
import type { CalendarEventRecord } from '@/modules/calendar/calendar.types';

export const ACTIVE_HOUSEHOLD_KEY = 'finora_active_household_id';
export const ACTIVE_USER_KEY = 'finora_active_user_id';
export const ACTIVE_EMAIL_KEY = 'finora_active_email';

export interface CloudBootstrapResult {
  authenticated: boolean;
  userId?: string;
  householdId?: string;
  email?: string | null;
  error?: string;
}

export async function pullCloudHouseholdState(): Promise<CloudBootstrapResult> {
  if (typeof window === 'undefined') {
    return { authenticated: false };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const cachedHousehold = localStorage.getItem(ACTIVE_HOUSEHOLD_KEY);
    const cachedUser = localStorage.getItem(ACTIVE_USER_KEY);
    const cachedEmail = localStorage.getItem(ACTIVE_EMAIL_KEY);
    if (cachedHousehold && cachedUser) {
      return {
        authenticated: true,
        householdId: cachedHousehold,
        userId: cachedUser,
        email: cachedEmail,
      };
    }
    return { authenticated: false };
  }

  let clientUser: { id: string; email?: string | null } | null = null;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      clientUser = {
        id: data.session.user.id,
        email: data.session.user.email ?? null,
      };
    }
  } catch {
    // Ignore if env not configured
  }

  const authHeaders = await getClientAuthHeaders();
  const res = await fetch('/api/sync/bootstrap', {
    cache: 'no-store',
    headers: authHeaders,
  });

  if (res.status === 401 && !clientUser) {
    localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
    localStorage.removeItem(ACTIVE_USER_KEY);
    localStorage.removeItem(ACTIVE_EMAIL_KEY);
    return { authenticated: false };
  }

  if (!res.ok) {
    let errText = `Cloud sync bootstrap failed (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: string };
      if (errJson?.error) errText = errJson.error;
    } catch {
      // ignore
    }
    if (clientUser) {
      return {
        authenticated: true,
        userId: clientUser.id,
        email: clientUser.email ?? null,
        error: errText,
      };
    }
    throw new Error(errText);
  }

  const payload = (await res.json()) as {
    authenticated: boolean;
    userId: string;
    email?: string | null;
    householdId: string;
    accounts: FinancialAccount[];
    categories: Category[];
    transactions: Transaction[];
    journalEntries: JournalEntry[];
    journalLines: JournalLine[];
    budgets: Budget[];
    liabilities: Liability[];
    calendarEvents?: CalendarEventRecord[];
  };

  if (!payload.authenticated) {
    return { authenticated: false };
  }

  // If Cloud has 0 transactions yet, auto-migrate local-only data (e.g. from Mobile)
  if (payload.transactions.length === 0) {
    const migrated = await pushLocalDataToCloudHousehold({
      cloudHouseholdId: payload.householdId,
      cloudAccounts: payload.accounts,
      cloudCategories: payload.categories,
    });
    if (migrated.uploadedTransactions > 0) {
      const refreshedRes = await fetch('/api/sync/bootstrap', {
        cache: 'no-store',
        headers: authHeaders,
      });
      if (refreshedRes.ok) {
        const refreshedPayload = (await refreshedRes.json()) as typeof payload;
        payload.accounts = refreshedPayload.accounts;
        payload.categories = refreshedPayload.categories;
        payload.transactions = refreshedPayload.transactions;
        payload.journalEntries = refreshedPayload.journalEntries;
        payload.journalLines = refreshedPayload.journalLines;
      }
    }
  }

  localStorage.setItem(ACTIVE_HOUSEHOLD_KEY, payload.householdId);
  localStorage.setItem(ACTIVE_USER_KEY, payload.userId);
  if (payload.email) {
    localStorage.setItem(ACTIVE_EMAIL_KEY, payload.email);
  }

  await localDb.transaction(
    'rw',
    [
      localDb.accounts,
      localDb.categories,
      localDb.transactions,
      localDb.journal_entries,
      localDb.journal_lines,
      localDb.budgets,
      localDb.liabilities,
      localDb.calendar_events,
    ],
    async () => {
      // Preserve any local unsynced transactions for this household
      const pendingLocalTxs = await localDb.transactions
        .where('household_id')
        .equals(payload.householdId)
        .filter((t) => t.sync_status !== 'synced')
        .toArray();
      const pendingIds = new Set(pendingLocalTxs.map((t) => t.id));

      if (payload.accounts.length > 0) {
        await localDb.accounts.bulkPut(payload.accounts);
      }
      if (payload.categories.length > 0) {
        await localDb.categories.bulkPut(payload.categories);
      }

      const cloudTxsToPut = payload.transactions.filter(
        (t) => !pendingIds.has(t.id)
      );
      if (cloudTxsToPut.length > 0) {
        await localDb.transactions.bulkPut(cloudTxsToPut);
      }

      if (payload.journalEntries.length > 0) {
        await localDb.journal_entries.bulkPut(payload.journalEntries);
      }
      if (payload.journalLines.length > 0) {
        await localDb.journal_lines.bulkPut(payload.journalLines);
      }
      if (payload.budgets.length > 0) {
        await localDb.budgets.bulkPut(payload.budgets);
      }
      if (payload.liabilities.length > 0) {
        await localDb.liabilities.bulkPut(payload.liabilities);
      }
      if (payload.calendarEvents && payload.calendarEvents.length > 0) {
        await localDb.calendar_events.bulkPut(payload.calendarEvents);
      }
    }
  );

  return {
    authenticated: true,
    userId: payload.userId,
    householdId: payload.householdId,
    email: payload.email ?? null,
  };
}
