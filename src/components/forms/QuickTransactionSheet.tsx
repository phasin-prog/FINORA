'use client';

import { useEffect, useState } from 'react';
import { X, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useFinora } from '@/components/layout/FinoraProvider';
import { createCategory } from '@/modules/categories/service';
import { createLocalTransaction } from '@/modules/transactions/service';
import type { TransactionType } from '@/types/financial';

export function QuickTransactionSheet() {
  const {
    isEntryOpen,
    closeEntry,
    householdId,
    userId,
    accounts,
    categories,
    refresh,
  } = useFinora();

  const [txType, setTxType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [txDate, setTxDate] = useState('');
  const [description, setDescription] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [asDraft, setAsDraft] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const filteredCategories = categories.filter((c) =>
    txType === 'income' ? c.category_type === 'INCOME' : c.category_type === 'EXPENSE'
  );

  useEffect(() => {
    if (!isEntryOpen) return;
    if (!txDate) {
      setTxDate(new Date().toISOString().slice(0, 10));
    }
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
    if (!toAccountId && accounts.length > 1) {
      setToAccountId(accounts[1].id);
    }
  }, [isEntryOpen, accounts, accountId, toAccountId, txDate]);

  useEffect(() => {
    if (txType !== 'transfer' && filteredCategories.length > 0) {
      const stillValid = filteredCategories.some((c) => c.id === categoryId);
      if (!stillValid) {
        setCategoryId(filteredCategories[0].id);
      }
    }
  }, [txType, filteredCategories, categoryId]);

  if (!isEntryOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await createLocalTransaction(
        {
          householdId,
          transactionType: txType,
          amount: amount.trim(),
          currencyCode: 'THB',
          transactionDate: txDate,
          accountId,
          toAccountId: txType === 'transfer' ? toAccountId : null,
          categoryId: txType === 'transfer' ? null : categoryId,
          description: description.trim(),
          notes: notes.trim() || null,
          idempotencyKey: crypto.randomUUID(),
          asDraft,
        },
        userId
      );

      await refresh();
      setAmount('');
      setDescription('');
      setNotes('');
      setAsDraft(false);
      setShowAdvanced(false);
      closeEntry();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถบันทึกรายการได้');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="บันทึกรายการใหม่"
    >
      <div className="w-full max-w-lg bg-surface border border-border rounded-t-[20px] sm:rounded-[20px] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] max-h-[92vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-primary">บันทึกรายการ</h2>
          <button
            type="button"
            onClick={closeEntry}
            className="p-2 -mr-2 rounded-full text-muted hover:text-primary"
            aria-label="ปิด"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Transaction Type */}
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-background rounded-[10px] border border-border">
            {(
              [
                { value: 'expense', label: 'รายจ่าย' },
                { value: 'income', label: 'รายรับ' },
                { value: 'transfer', label: 'โอนเงิน' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTxType(opt.value)}
                className={`py-2 text-sm font-medium rounded-[8px] transition-colors ${
                  txType === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted hover:text-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 2. Amount */}
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
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 text-2xl font-semibold tabular-nums bg-background border border-border rounded-[10px] text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* 3. Category or Destination Account */}
          {txType !== 'transfer' ? (
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                หมวดหมู่
              </label>
              <div className="flex flex-wrap gap-2">
                {filteredCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      categoryId === cat.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-primary border-border hover:border-primary/40'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowNewCat((v) => !v)}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-full border border-dashed border-border text-muted hover:text-primary hover:border-primary/40 inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  หมวดหมู่ใหม่
                </button>
              </div>
              {showNewCat && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="ชื่อหมวดหมู่ใหม่..."
                    className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-[8px] text-primary"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newCatName.trim()) return;
                      const created = await createCategory({
                        householdId,
                        name: newCatName.trim(),
                        categoryType: txType === 'income' ? 'INCOME' : 'EXPENSE',
                        icon: 'tag',
                        color: txType === 'income' ? '#39846C' : '#202B27',
                      });
                      await refresh();
                      setCategoryId(created.id);
                      setNewCatName('');
                      setShowNewCat(false);
                    }}
                    className="px-3 py-1.5 rounded-[8px] bg-accent text-white text-xs font-medium"
                  >
                    เพิ่ม
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                ไปยังบัญชี (ปลายทาง)
              </label>
              <select
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-[8px] text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 4. Source Account & 5. Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                {txType === 'transfer' ? 'จากบัญชี (ต้นทาง)' : 'บัญชี'}
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-[8px] text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
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
                className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-[8px] text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* 6. Description */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">
              รายละเอียด
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="เช่น ค่ากาแฟ, เงินเดือน, โอนออม"
              className="w-full px-3.5 py-2.5 text-sm bg-background border border-border rounded-[8px] text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* Collapsible Advanced Options */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-primary"
            >
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              ตัวเลือกเพิ่มเติม (Draft / หมายเหตุ)
            </button>

            {showAdvanced && (
              <div className="mt-3 p-3 bg-background rounded-[10px] border border-border space-y-3">
                <label className="flex items-center gap-2 text-sm text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={asDraft}
                    onChange={(e) => setAsDraft(e.target.checked)}
                    className="rounded border-border accent-accent"
                  />
                  บันทึกเป็น Draft ก่อน (ยังไม่ลงบัญชีแยกประเภท)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="หมายเหตุเพิ่มเติม..."
                  className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-[8px] text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-[8px] bg-danger/10 border border-danger/30 text-xs text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 rounded-[10px] bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {submitting
              ? 'กำลังบันทึก...'
              : asDraft
                ? 'บันทึก Draft'
                : 'บันทึกรายการ'}
          </button>
        </form>
      </div>
    </div>
  );
}
