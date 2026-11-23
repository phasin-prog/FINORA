'use client';

import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { AccountIcon } from '@/components/financial/category-icon';
import { formatTHB } from '@/lib/utilities/money';
import {
  createFinancialAccount,
  updateFinancialAccount,
} from '@/modules/accounts/service';
import type { AccountType, FinancialAccount } from '@/types/financial';

export default function AccountsPage() {
  const { householdId, userId, accounts, refresh } = useFinora();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FinancialAccount | null>(null);
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('bank');
  const [institution, setInstitution] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [error, setError] = useState<string | null>(null);

  function openNewForm() {
    setEditing(null);
    setName('');
    setAccountType('bank');
    setInstitution('');
    setAccountNumber('');
    setOpeningBalance('0');
    setError(null);
    setShowForm(true);
  }

  function openEditForm(acc: FinancialAccount) {
    setEditing(acc);
    setName(acc.name);
    setAccountType(acc.account_type);
    setInstitution(acc.institution ?? '');
    setAccountNumber(acc.account_number ?? '');
    setOpeningBalance(Number(acc.opening_balance).toString());
    setError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editing) {
        await updateFinancialAccount(editing.id, {
          name: name.trim(),
          account_type: accountType,
          institution: institution.trim() || null,
          account_number: accountNumber.trim() || null,
          opening_balance: openingBalance.trim() || '0',
        });
      } else {
        await createFinancialAccount({
          householdId,
          ownerUserId: userId,
          name: name.trim(),
          accountType,
          institution: institution.trim() || null,
          accountNumber: accountNumber.trim() || null,
          openingBalance: openingBalance.trim() || '0',
          currencyCode: 'THB',
        });
      }
      await refresh();
      setShowForm(false);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถบันทึกบัญชีได้');
    }
  }

  return (
    <MobileShell title="จัดการบัญชี">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            เพิ่มบัญชีธนาคาร หมายเลขบัญชี และยอดตั้งต้น
          </p>
          <button
            type="button"
            onClick={openNewForm}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-primary text-primary-foreground text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            เพิ่มบัญชี
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-surface border border-border rounded-[18px] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">
                {editing ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีใหม่'}
              </h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="p-1 text-muted hover:text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">ชื่อบัญชี</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="เช่น KBank ออมทรัพย์"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">ประเภทบัญชี</label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                >
                  <option value="bank">บัญชีธนาคาร (Bank)</option>
                  <option value="cash">เงินสด (Cash)</option>
                  <option value="wallet">E-Wallet</option>
                  <option value="investment">พอร์ตลงทุน</option>
                  <option value="credit_card">บัตรเครดิต</option>
                  <option value="loan">สินเชื่อ</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">ธนาคาร / สถาบัน</label>
                <input
                  type="text"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  placeholder="เช่น KBank, SCB, TrueMoney"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">
                  หมายเลขบัญชี / เลขบัตร
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="เช่น 012-3-45678-9"
                  className="w-full px-3 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1">ยอดตั้งต้น (THB)</label>
              <input
                type="text"
                inputMode="decimal"
                required
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="w-full px-3 py-2 text-sm tabular-nums bg-background border border-border rounded-[8px]"
              />
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              type="submit"
              className="w-full py-2.5 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium"
            >
              {editing ? 'บันทึกการแก้ไข' : 'สร้างบัญชี'}
            </button>
          </form>
        )}

        <div className="space-y-3">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="bg-surface border border-border rounded-[18px] p-4 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center shrink-0 text-primary">
                  <AccountIcon type={acc.account_type} className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary truncate">
                    {acc.name}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {acc.institution || acc.account_type.toUpperCase()}
                    {acc.account_number ? ` · ${acc.account_number}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-primary">
                    {formatTHB(acc.current_balance)}
                  </p>
                  <p className="text-[10px] text-muted uppercase">
                    {acc.account_class}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEditForm(acc)}
                  title="แก้ไขบัญชี"
                  className="p-2 rounded-[8px] border border-border text-muted hover:text-primary"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MobileShell>
  );
}
