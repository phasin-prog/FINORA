'use client';

import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { useFinora } from '@/components/layout/FinoraProvider';
import { formatFriendlyError, sanitizeMoneyInput } from '@/lib/utilities/money';
import {
  deleteOrReverseTransaction,
  updateOrCorrectTransaction,
} from '@/modules/transactions/service';
import { toBangkokDateString } from '@/modules/calendar/calendar.utils';

export function EditTransactionSheet() {
  const {
    editingTransaction,
    closeEditTransaction,
    userId,
    accounts,
    categories,
    refresh,
  } = useFinora();

  const [amount, setAmount] = useState('');
  const [txDate, setTxDate] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!editingTransaction) return;
    setAmount(Number(editingTransaction.amount).toString());
    setTxDate(editingTransaction.transaction_date);
    setDescription(editingTransaction.description);
    setCategoryId(editingTransaction.category_id ?? '');
    setAccountId(editingTransaction.account_id);
    setError(null);
  }, [editingTransaction]);

  if (!editingTransaction) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTransaction) return;
    setError(null);
    setSubmitting(true);

    try {
      await updateOrCorrectTransaction(
        editingTransaction.id,
        {
          amount: amount.trim(),
          transactionDate: txDate,
          description: description.trim(),
          categoryId:
            editingTransaction.transaction_type === 'transfer'
              ? null
              : categoryId || null,
          accountId,
        },
        userId
      );
      await refresh();
      closeEditTransaction();
    } catch (err) {
      setError(formatFriendlyError(err, 'ไม่สามารถแก้ไขรายการได้'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editingTransaction) return;
    setError(null);
    setSubmitting(true);
    try {
      await deleteOrReverseTransaction(
        editingTransaction.id,
        toBangkokDateString()
      );
      await refresh();
      closeEditTransaction();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถลบรายการได้');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="แก้ไขรายการและยอดเงิน"
    >
      <div className="w-full max-w-lg bg-surface border border-border rounded-t-[20px] sm:rounded-[20px] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-primary">
            แก้ไขรายการ / แก้ไขยอดเงิน
          </h2>
          <button
            type="button"
            onClick={closeEditTransaction}
            className="p-2 -mr-2 rounded-full text-muted hover:text-primary"
            aria-label="ปิด"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              จำนวนเงิน (THB)
            </label>
            <input
              type="text"
              inputMode="decimal"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(sanitizeMoneyInput(e.target.value))}
              className="w-full px-4 py-3 text-2xl font-semibold tabular-nums bg-background border border-border rounded-[10px] text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                บัญชี
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-[8px] text-primary"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                วันที่
              </label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-[8px] text-primary"
              />
            </div>
          </div>

          {editingTransaction.transaction_type !== 'transfer' && (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                หมวดหมู่
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-[8px] text-primary"
              >
                {categories
                  .filter((c) =>
                    editingTransaction.transaction_type === 'income'
                      ? c.category_type === 'INCOME'
                      : c.category_type === 'EXPENSE'
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              รายละเอียด
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-[8px] text-primary"
            />
          </div>

          {error && (
            <div className="p-3 rounded-[8px] bg-danger/10 border border-danger/30 text-xs text-danger">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleDelete()}
              className="px-4 py-3 rounded-[10px] border border-danger/40 bg-danger/10 text-danger text-sm font-medium inline-flex items-center gap-1.5 hover:bg-danger/20"
            >
              <Trash2 className="w-4 h-4" />
              ลบ
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-3 px-4 rounded-[10px] bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึกยอดเงินใหม่'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
