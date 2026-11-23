import { localDb } from '@/offline/indexeddb/db';

export interface SyncSummary {
  syncedCount: number;
  conflictCount: number;
  failedCount: number;
  offline: boolean;
}

/**
 * Flushes pending Outbox items to /api/transactions/sync.
 * Never silently overwrites conflicts (Section 2.2 Conflict Resolution).
 */
export async function syncOutbox(householdId: string): Promise<SyncSummary> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { syncedCount: 0, conflictCount: 0, failedCount: 0, offline: true };
  }

  const pendingItems = await localDb.outbox
    .where('household_id')
    .equals(householdId)
    .filter(
      (item) =>
        (item.sync_status === 'sync_pending' || item.sync_status === 'sync_failed') &&
        (item.operation === 'create' || item.operation === 'reverse')
    )
    .sortBy('created_at');

  if (pendingItems.length === 0) {
    return { syncedCount: 0, conflictCount: 0, failedCount: 0, offline: false };
  }

  const response = await fetch('/api/transactions/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: pendingItems.map((item) => ({
        outboxId: item.id,
        operation: item.operation,
        payload: item.payload,
      })),
    }),
  });

  if (!response.ok) {
    return {
      syncedCount: 0,
      conflictCount: 0,
      failedCount: pendingItems.length,
      offline: false,
    };
  }

  const data = (await response.json()) as {
    results: Array<{
      outboxId: string;
      status: 'synced' | 'conflict' | 'failed';
      error?: string;
    }>;
  };

  let syncedCount = 0;
  let conflictCount = 0;
  let failedCount = 0;
  const now = new Date().toISOString();

  for (const res of data.results) {
    const outboxItem = pendingItems.find((i) => i.id === res.outboxId);
    if (!outboxItem) continue;

    if (res.status === 'synced') {
      syncedCount += 1;
      await localDb.transaction('rw', [localDb.outbox, localDb.transactions], async () => {
        await localDb.outbox.delete(outboxItem.id);
        await localDb.transactions.update(outboxItem.entity_id, {
          sync_status: 'synced',
          updated_at: now,
        });
      });
    } else if (res.status === 'conflict') {
      conflictCount += 1;
      await localDb.transaction('rw', [localDb.outbox, localDb.transactions], async () => {
        await localDb.outbox.update(outboxItem.id, {
          sync_status: 'conflict',
          last_error: res.error,
          updated_at: now,
        });
        await localDb.transactions.update(outboxItem.entity_id, {
          sync_status: 'conflict',
          updated_at: now,
        });
      });
    } else {
      failedCount += 1;
      await localDb.transaction('rw', [localDb.outbox, localDb.transactions], async () => {
        await localDb.outbox.update(outboxItem.id, {
          sync_status: 'sync_failed',
          retry_count: outboxItem.retry_count + 1,
          last_error: res.error,
          updated_at: now,
        });
        await localDb.transactions.update(outboxItem.entity_id, {
          sync_status: 'sync_failed',
          updated_at: now,
        });
      });
    }
  }

  return { syncedCount, conflictCount, failedCount, offline: false };
}

/**
 * Registers foreground & connectivity sync listeners for iPhone Safari (Section 2.2).
 * Safari does not guarantee background sync when closed, so we sync on open,
 * visibility return, and network reconnect.
 */
export function registerSafariSyncListeners(
  householdId: string,
  onSyncComplete?: (summary: SyncSummary) => void
): () => void {
  const triggerSync = async () => {
    try {
      const summary = await syncOutbox(householdId);
      onSyncComplete?.(summary);
    } catch {
      // Network/auth errors keep items safely in Outbox
    }
  };

  const handleOnline = () => {
    void triggerSync();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void triggerSync();
    }
  };

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  void triggerSync();

  return () => {
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
