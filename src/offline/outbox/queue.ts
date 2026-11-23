import { localDb, type OutboxItem } from '@/offline/indexeddb/db';

export async function enqueueOutboxOperation(params: {
  householdId: string;
  entityType: OutboxItem['entity_type'];
  entityId: string;
  operation: OutboxItem['operation'];
  idempotencyKey: string;
  payload: Record<string, unknown>;
}): Promise<OutboxItem> {
  const now = new Date().toISOString();
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    household_id: params.householdId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    operation: params.operation,
    idempotency_key: params.idempotencyKey,
    payload: params.payload,
    sync_status: 'sync_pending',
    retry_count: 0,
    created_at: now,
    updated_at: now,
  };

  await localDb.outbox.add(item);
  return item;
}

export async function getPendingOutboxCount(householdId?: string): Promise<number> {
  if (householdId) {
    return localDb.outbox
      .where('household_id')
      .equals(householdId)
      .filter((item) => item.sync_status === 'sync_pending' || item.sync_status === 'sync_failed')
      .count();
  }
  return localDb.outbox
    .where('sync_status')
    .anyOf(['sync_pending', 'sync_failed'])
    .count();
}
