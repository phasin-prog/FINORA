'use client';

import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Check, Pencil, Search, Trash2, XCircle } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { CategoryIcon } from '@/components/financial/category-icon';
import { formatTHB, toDecimal } from '@/lib/utilities/money';
import { toBangkokDateString } from '@/modules/calendar/calendar.utils';
import {
  cancelDraftTransaction,
  permanentlyDeleteTransaction,
  postDraftTransaction,
} from '@/modules/transactions/service';
import type { Transaction, TransactionType } from '@/types/financial';

type DatePreset = 'all' | 'today' | '7d' | 'month';

export default function TransactionsPage() {
  const {
    transactions,
    accounts,
    categories,
    refresh,
    openEditTransaction,
  } = useFinora();
  const [todayDate, setTodayDate] = useState('2026-11-23');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'amount_desc' | 'amount_asc'>(
    'date_desc'
  );
  const [hideReversed, setHideReversed] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setTodayDate(toBangkokDateString());
    });
    return () => {
      active = false;
    };
  }, []);

  const todayExpense = useMemo(() => {
    let total = new Decimal(0);
    for (const tx of transactions) {
      if (
        tx.status === 'posted' &&
        !tx.reversed_transaction_id &&
        tx.transaction_type === 'expense' &&
        tx.transaction_date === todayDate
      ) {
        total = total.plus(toDecimal(tx.amount));
      }
    }
    return total;
  }, [transactions, todayDate]);

  const filtered = useMemo(() => {
    let list = [...transactions];

    if (hideReversed) {
      list = list.filter(
        (t) =>
          t.status !== 'reversed' &&
          t.status !== 'cancelled' &&
          !t.reversed_transaction_id
      );
    }

    if (datePreset === 'today') {
      list = list.filter((t) => t.transaction_date === todayDate);
    } else if (datePreset === '7d') {
      const [y, m, d] = todayDate.split('-').map(Number);
      const start = new Date(Date.UTC(y, m - 1, d - 6)).toISOString().slice(0, 10);
      list = list.filter(
        (t) => t.transaction_date >= start && t.transaction_date <= todayDate
      );
    } else if (datePreset === 'month') {
      const ym = todayDate.slice(0, 7);
      list = list.filter((t) => t.transaction_date.startsWith(ym));
    }

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
  }, [
    transactions,
    hideReversed,
    datePreset,
    todayDate,
    typeFilter,
    accountFilter,
    search,
    sortBy,
    categories,
  ]);

  const filteredExpenseTotal = useMemo(() => {
    let total = new Decimal(0);
    for (const tx of filtered) {
      if (
        tx.status === 'posted' &&
        !tx.reversed_transaction_id &&
        tx.transaction_type === 'expense'
      ) {
        total = total.plus(toDecimal(tx.amount));
      }
    }
    return total;
  }, [filtered]);

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
      if (tx.status === 'posted' && !tx.reversed_transaction_id) {
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

  async function handleDelete(txId: string) {
    setActionError(null);
    try {
      await permanentlyDeleteTransaction(txId);
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ลบรายการไม่สำเร็จ');
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
        {/* Daily Expense Summary */}
        <section className="bg-surface border border-border rounded-[18px] p-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-muted">รายจ่ายวันนี้ ({todayDate})</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-primary">
              {formatTHB(todayExpense)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted">รายจ่ายตามตัวกรอง</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-primary">
              {formatTHB(filteredExpenseTotal)}
            </p>
          </div>
        </section>

        {/* Quick Date Presets */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(
            [
              { key: 'all', label: 'ทั้งหมด' },
              { key: 'today', label: 'วันนี้' },
              { key: '7d', label: '7 วันล่าสุด' },
              { key: 'month', label: 'เดือนนี้' },
            ] as const
          ).map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDatePreset(d.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                datePreset === d.key
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface text-muted border-border hover:text-primary'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

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
              { value: 'all', label: 'ทุกประเภท' },
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

          <label className="flex items-center gap-1.5 text-xs text-muted ml-auto cursor-pointer">
            <input
              type="checkbox"
              checked={hideReversed}
              onChange={(e) => setHideReversed(e.target.checked)}
              className="rounded border-border accent-accent"
            />
            ซ่อนรายการที่ลบ/กลับรายการ
          </label>
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
                      <li
                        key={tx.id}
                        className="px-4 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 border border-border bg-background text-primary"
                            style={
                              cat?.color
                                ? {
                                    backgroundColor: `${cat.color}18`,
                                    color: cat.color,
                                  }
                                : undefined
                            }
                          >
                            <CategoryIcon icon={cat?.icon} className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-primary truncate">
                              {tx.description || cat?.name || 'โอนเงินระหว่างบัญชี'}
                            </p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                              <span>{acc?.name ?? 'บัญชี'}</span>
                              {tx.status !== 'posted' && (
                                <span className="px-1.5 py-0.5 rounded bg-background border border-border text-[10px] uppercase">
                                  {tx.status}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={`text-sm font-semibold tabular-nums mr-1 ${
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
                            <>
                              <button
                                type="button"
                                onClick={() => void handlePostDraft(tx.id)}
                                title="Post ลงบัญชี"
                                className="p-1.5 rounded-[8px] bg-accent/10 text-accent"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCancelDraft(tx.id)}
                                title="ยกเลิก Draft"
                                className="p-1.5 rounded-[8px] bg-danger/10 text-danger"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          {(tx.status === 'draft' ||
                            (tx.status === 'posted' && !tx.reversed_transaction_id)) && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditTransaction(tx)}
                                title="แก้ไขรายการ"
                                className="p-1.5 rounded-[8px] border border-border text-muted hover:text-primary"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(tx.id)}
                                title="ลบรายการ"
                                className="p-1.5 rounded-[8px] border border-border text-muted hover:text-danger"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
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
