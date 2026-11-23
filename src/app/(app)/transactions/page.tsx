'use client';

import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Search, RotateCcw, Check, XCircle } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { formatTHB, toDecimal } from '@/lib/utilities/money';
import {
  cancelDraftTransaction,
  postDraftTransaction,
  reversePostedTransaction,
} from '@/modules/transactions/service';
import type { Transaction, TransactionType } from '@/types/financial';

export default function TransactionsPage() {
  const { transactions, accounts, categories, refresh } = useFinora();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'amount_desc' | 'amount_asc'>(
    'date_desc'
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = [...transactions];
    if (typeFilter !== 'all') {
      list = list.filter((t) => t.transaction_type === typeFilter);
    }
    if (accountFilter !== 'all') {
      list = list.filter((t) => t.account_id === accountFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => {
        const cat = categories.find((c) => c.id === t.category_id);
        return (
          t.description.toLowerCase().includes(q) ||
          (cat?.name.toLowerCase().includes(q) ?? false)
        );
      });
    }

    list.sort((a, b) => {
      if (sortBy === 'amount_desc') {
        return toDecimal(b.amount).comparedTo(toDecimal(a.amount));
      }
      if (sortBy === 'amount_asc') {
        return toDecimal(a.amount).comparedTo(toDecimal(b.amount));
      }
      return (
        b.transaction_date.localeCompare(a.transaction_date) ||
        b.created_at.localeCompare(a.created_at)
      );
    });
    return list;
  }, [transactions, typeFilter, accountFilter, search, sortBy, categories]);

  // Group by date with daily summary
  const groupedByDate = useMemo(() => {
    const groups = new Map<
      string,
      { items: Transaction[]; income: Decimal; expense: Decimal }
    >();

    for (const tx of filtered) {
      const entry = groups.get(tx.transaction_date) ?? {
        items: [],
        income: new Decimal(0),
        expense: new Decimal(0),
      };
      entry.items.push(tx);
      if (tx.status === 'posted') {
        if (tx.transaction_type === 'income') {
          entry.income = entry.income.plus(toDecimal(tx.amount));
        } else if (tx.transaction_type === 'expense') {
          entry.expense = entry.expense.plus(toDecimal(tx.amount));
        }
      }
      groups.set(tx.transaction_date, entry);
    }

    return Array.from(groups.entries());
  }, [filtered]);

  async function handleReverse(txId: string) {
    setActionError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await reversePostedTransaction(txId, today, 'กลับรายการจากหน้ากิจกรรม');
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'กลับรายการไม่สำเร็จ');
    }
  }

  async function handlePostDraft(txId: string) {
    setActionError(null);
    try {
      await postDraftTransaction(txId);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Post รายการไม่สำเร็จ');
    }
  }

  async function handleCancelDraft(txId: string) {
    setActionError(null);
    try {
      await cancelDraftTransaction(txId);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ยกเลิกรายการไม่สำเร็จ');
    }
  }

  return (
    <MobileShell title="ประวัติธุรกรรม">
      <div className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหารายละเอียดหรือหมวดหมู่..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-[10px] text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { value: 'all', label: 'ทั้งหมด' },
              { value: 'expense', label: 'รายจ่าย' },
              { value: 'income', label: 'รายรับ' },
              { value: 'transfer', label: 'โอนเงิน' },
            ] as const
          ).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                typeFilter === f.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-muted border-border hover:text-primary'
              }`}
            >
              {f.label}
            </button>
          ))}

          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="px-3 py-1.5 rounded-full text-xs bg-surface border border-border text-primary"
          >
            <option value="all">ทุกบัญชี</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as 'date_desc' | 'amount_desc' | 'amount_asc')
            }
            className="px-3 py-1.5 rounded-full text-xs bg-surface border border-border text-primary"
          >
            <option value="date_desc">ล่าสุดก่อน</option>
            <option value="amount_desc">ยอดมาก → น้อย</option>
            <option value="amount_asc">ยอดน้อย → มาก</option>
          </select>
        </div>

        {actionError && (
          <div className="p-3 rounded-[10px] bg-danger/10 border border-danger/30 text-xs text-danger">
            {actionError}
          </div>
        )}

        {/* Daily Groups */}
        {groupedByDate.length === 0 ? (
          <div className="bg-surface border border-border rounded-[18px] p-8 text-center text-sm text-muted">
            ไม่พบรายการที่ตรงกับเงื่อนไข
          </div>
        ) : (
          <div className="space-y-4">
            {groupedByDate.map(([date, group]) => (
              <section
                key={date}
                className="bg-surface border border-border rounded-[18px] overflow-hidden"
              >
                <div className="px-4 py-2.5 bg-background/60 border-b border-border flex items-center justify-between text-xs">
                  <span className="font-semibold text-primary">{date}</span>
                  <div className="flex items-center gap-3 tabular-nums">
                    {group.income.gt(0) && (
                      <span className="text-accent">+{formatTHB(group.income)}</span>
                    )}
                    {group.expense.gt(0) && (
                      <span className="text-primary">-{formatTHB(group.expense)}</span>
                    )}
                  </div>
                </div>

                <ul className="divide-y divide-border">
                  {group.items.map((tx) => {
                    const cat = categories.find((c) => c.id === tx.category_id);
                    const acc = accounts.find((a) => a.id === tx.account_id);
                    const isIncome = tx.transaction_type === 'income';
                    const isTransfer = tx.transaction_type === 'transfer';

                    return (
                      <li key={tx.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary truncate">
                            {tx.description || cat?.name || 'โอนเงินระหว่างบัญชี'}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span>{acc?.name ?? 'บัญชี'}</span>
                            <span className="px-1.5 py-0.5 rounded bg-background border border-border text-[10px] uppercase">
                              {tx.status}
                            </span>
                            {tx.sync_status !== 'synced' && (
                              <span className="text-[10px] text-warning">
                                {tx.sync_status}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-sm font-semibold tabular-nums ${
                              tx.status === 'reversed' || tx.status === 'cancelled'
                                ? 'line-through text-muted'
                                : isIncome
                                  ? 'text-accent'
                                  : isTransfer
                                    ? 'text-muted'
                                    : 'text-primary'
                            }`}
                          >
                            {isIncome ? '+' : isTransfer ? '' : '-'}
                            {formatTHB(tx.amount)}
                          </span>

                          {tx.status === 'draft' && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handlePostDraft(tx.id)}
                                title="Post ลงบัญชี"
                                className="p-1.5 rounded-[8px] bg-accent/10 text-accent hover:bg-accent/20"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCancelDraft(tx.id)}
                                title="ยกเลิก Draft"
                                className="p-1.5 rounded-[8px] bg-danger/10 text-danger hover:bg-danger/20"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          {tx.status === 'posted' && !tx.reversed_transaction_id && (
                            <button
                              type="button"
                              onClick={() => void handleReverse(tx.id)}
                              title="กลับรายการ (Reverse)"
                              className="p-1.5 rounded-[8px] border border-border text-muted hover:text-danger hover:border-danger/40"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </MobileShell>
  );
}
