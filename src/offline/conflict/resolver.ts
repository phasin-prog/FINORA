import { localDb, type OutboxItem } from '@/offline/indexeddb/db';

export async function listOutboxItems(
  householdId: string
): Promise<OutboxItem[]> {
  return localDb.outbox
    .where('household_id')
    .equals(householdId)
    .sortBy('created_at');
}

export async function retryOutboxItem(outboxId: string): Promise<void> {
  const item = await localDb.outbox.get(outboxId);
  if (!item) return;

  const now = new Date().toISOString();
  await localDb.transaction('rw', [localDb.outbox, localDb.transactions], async () => {
    await localDb.outbox.update(outboxId, {
      sync_status: 'sync_pending',
      last_error: undefined,
      updated_at: now,
    });
    if (item.entity_type === 'transaction') {
      await localDb.transactions.update(item.entity_id, {
        sync_status: 'sync_pending',
        updated_at: now,
      });
    }
  });
}

/**
 * Resolves a conflict by keeping the local record and assigning a fresh
 * idempotency key so the next sync attempt creates a distinct record on Cloud.
 */
export async function resolveConflictKeepLocal(outboxId: string): Promise<void> {
  const item = await localDb.outbox.get(outboxId);
  if (!item) return;

  const newKey = crypto.randomUUID();
  const now = new Date().toISOString();

  await localDb.transaction('rw', [localDb.outbox, localDb.transactions], async () => {
    await localDb.outbox.update(outboxId, {
      idempotency_key: newKey,
      sync_status: 'sync_pending',
      last_error: undefined,
      payload: {
        ...item.payload,
        idempotencyKey: newKey,
      },
      updated_at: now,
    });

    if (item.entity_type === 'transaction') {
      await localDb.transactions.update(item.entity_id, {
        idempotency_key: newKey,
        sync_status: 'sync_pending',
        updated_at: now,
      });
    }
  });
}

/**
 * Resolves a conflict by discarding the conflicted local outbox item
 * and marking the local transaction as cancelled (never silently deleting history).
 */
export async function resolveConflictDiscardLocal(outboxId: string): Promise<void> {
  const item = await localDb.outbox.get(outboxId);
  if (!item) return;

  const now = new Date().toISOString();

  await localDb.transaction(
    'rw',
    [localDb.outbox, localDb.transactions, localDb.journal_entries],
    async () => {
      await localDb.outbox.delete(outboxId);

      if (item.entity_type === 'transaction') {
        const tx = await localDb.transactions.get(item.entity_id);
        if (tx) {
          await localDb.transactions.update(tx.id, {
            status: 'cancelled',
            sync_status: 'synced',
            updated_at: now,
          });
          if (tx.journal_entry_id) {
            await localDb.journal_entries.update(tx.journal_entry_id, {
              status: 'reversed',
            });
          }
        }
      }
    }
  );
}
