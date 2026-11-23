'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  Calendar,
  ChevronRight,
  CreditCard,
  Download,
  HardDriveDownload,
  LogIn,
  RefreshCw,
  Tag,
  Target,
  Upload,
  Wallet,
} from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import { formatTHB } from '@/lib/utilities/money';
import {
  exportFullBackupJson,
  restoreFullBackupJson,
} from '@/offline/backup';
import type { OutboxItem } from '@/offline/indexeddb/db';
import {
  listOutboxItems,
  resolveConflictDiscardLocal,
  resolveConflictKeepLocal,
  retryOutboxItem,
} from '@/offline/conflict/resolver';

export default function SettingsPage() {
  const {
    householdId,
    accounts,
    transactions,
    pendingSyncCount,
    triggerSync,
    refresh,
  } = useFinora();
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadOutbox = useCallback(async () => {
    const items = await listOutboxItems(householdId);
    setOutboxItems(items);
  }, [householdId]);

  useEffect(() => {
    let active = true;
    void listOutboxItems(householdId).then((items) => {
      if (active) setOutboxItems(items);
    });
    return () => {
      active = false;
    };
  }, [householdId, transactions, pendingSyncCount]);

  function handleExportCsv() {
    const header = [
      'id',
      'date',
      'type',
      'amount',
      'currency',
      'status',
      'sync_status',
      'description',
    ];
    const rows = transactions.map((t) => [
      t.id,
      t.transaction_date,
      t.transaction_type,
      t.amount,
      t.currency_code,
      t.status,
      t.sync_status,
      `"${(t.description || '').replace(/"/g, '""')}"`,
    ]);

    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finora-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportJsonBackup() {
    setBackupError(null);
    setBackupMessage(null);
    const json = await exportFullBackupJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finora-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage('สำรองข้อมูลไฟล์ JSON เรียบร้อยแล้ว');
  }

  async function handleRestoreJsonBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupError(null);
    setBackupMessage(null);
    try {
      const text = await file.text();
      const res = await restoreFullBackupJson(text);
      await refresh();
      setBackupMessage(
        `กู้คืนข้อมูลสำเร็จ: ${res.accountsRestored} บัญชี, ${res.transactionsRestored} รายการ`
      );
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'ไฟล์สำรองข้อมูลไม่ถูกต้อง'
      );
    } finally {
      e.target.value = '';
    }
  }

  return (
    <MobileShell title="บัญชีและการตั้งค่า">
      <div className="space-y-5">
        {/* Quick Links to Calendar, Notifications, Budgets & Debts */}
        <section className="bg-surface border border-border rounded-[18px] divide-y divide-border overflow-hidden">
          <Link
            href="/accounts"
            className="px-5 py-4 flex items-center justify-between hover:bg-background/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Wallet className="w-4 h-4 text-accent" />
              <div>
                <p className="text-sm font-semibold text-primary">จัดการบัญชี (Accounts)</p>
                <p className="text-xs text-muted">เพิ่ม/แก้ไขบัญชีและหมายเลขธนาคาร</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted" />
          </Link>

          <Link
            href="/categories"
            className="px-5 py-4 flex items-center justify-between hover:bg-background/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Tag className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-semibold text-primary">จัดการหมวดหมู่ (Categories)</p>
                <p className="text-xs text-muted">เพิ่มหมวดหมู่รายรับ-รายจ่ายและเลือกไอคอน</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted" />
          </Link>

          <Link
            href="/calendar"
            className="px-5 py-4 flex items-center justify-between hover:bg-background/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-accent" />
              <div>
                <p className="text-sm font-semibold text-primary">ปฏิทินการเงิน (Financial Calendar)</p>
                <p className="text-xs text-muted">ดูกระแสเงินสดรายเดือน รายการจริง vs คาดการณ์</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted" />
          </Link>

          <Link
            href="/notifications"
            className="px-5 py-4 flex items-center justify-between hover:bg-background/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Bell className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-semibold text-primary">ศูนย์การแจ้งเตือน (Notifications)</p>
                <p className="text-xs text-muted">กำหนดชำระหนี้ งบประมาณ และตั้งค่ากฎแจ้งเตือน</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted" />
          </Link>

          <Link
            href="/budgets"
            className="px-5 py-4 flex items-center justify-between hover:bg-background/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Target className="w-4 h-4 text-accent" />
              <div>
                <p className="text-sm font-semibold text-primary">งบประมาณ (Budgets)</p>
                <p className="text-xs text-muted">ตั้งวงเงินรายหมวดและติดตามการใช้จริง</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted" />
          </Link>

          <Link
            href="/debts"
            className="px-5 py-4 flex items-center justify-between hover:bg-background/60 transition-colors"
          >
            <div className="flex items-center gap-3">
              <CreditCard className="w-4 h-4 text-warning" />
              <div>
                <p className="text-sm font-semibold text-primary">หนี้สินและการชำระ (Debts)</p>
                <p className="text-xs text-muted">ติดตามยอดคงเหลือ ดอกเบี้ย และวันครบกำหนด</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted" />
          </Link>
        </section>

        {/* Accounts Summary */}
        <section className="bg-surface border border-border rounded-[18px] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-primary">บัญชีทั้งหมด</h2>
          </div>
          <ul className="divide-y divide-border">
            {accounts.map((acc) => (
              <li
                key={acc.id}
                className="py-3 flex items-center justify-between text-sm"
              >
                <div>
                  <p className="font-medium text-primary">{acc.name}</p>
                  <p className="text-xs text-muted uppercase">
                    {acc.institution || acc.account_type}
                    {acc.account_number ? ` · ${acc.account_number}` : ''}
                  </p>
                </div>
                <span className="font-semibold tabular-nums text-primary">
                  {formatTHB(acc.current_balance)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Data Ownership & Cloud Auth */}
        <section className="bg-surface border border-border rounded-[18px] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-primary">
            ข้อมูลและความปลอดภัย
          </h2>
          <p className="text-xs text-muted">
            รายการค้างซิงค์ในเครื่อง: {pendingSyncCount} รายการ
          </p>

          <button
            type="button"
            onClick={handleExportCsv}
            className="w-full py-2.5 px-4 rounded-[10px] border border-border bg-background text-primary text-sm font-medium flex items-center justify-center gap-2 hover:border-primary/40"
          >
            <Download className="w-4 h-4" />
            ส่งออกข้อมูล CSV ({transactions.length} รายการ)
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void handleExportJsonBackup()}
              className="py-2.5 px-3 rounded-[10px] border border-border bg-background text-primary text-xs font-medium flex items-center justify-center gap-1.5 hover:border-primary/40"
            >
              <HardDriveDownload className="w-4 h-4 text-accent" />
              สำรองข้อมูล (.json)
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-3 rounded-[10px] border border-border bg-background text-primary text-xs font-medium flex items-center justify-center gap-1.5 hover:border-primary/40"
            >
              <Upload className="w-4 h-4 text-warning" />
              กู้คืนข้อมูล (.json)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(e) => void handleRestoreJsonBackup(e)}
              className="hidden"
            />
          </div>

          {backupMessage && (
            <p className="text-xs text-accent">{backupMessage}</p>
          )}
          {backupError && (
            <p className="text-xs text-danger">{backupError}</p>
          )}

          <Link
            href="/login"
            className="w-full py-2.5 px-4 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90"
          >
            <LogIn className="w-4 h-4" />
            เข้าสู่ระบบ / เชื่อมต่อ Cloud (Supabase)
          </Link>
        </section>

        {/* Outbox & Conflict Inspector */}
        {outboxItems.length > 0 && (
          <section className="bg-surface border border-border rounded-[18px] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning" />
                <h2 className="text-sm font-semibold text-primary">
                  คิวซิงค์และรายการขัดแย้ง ({outboxItems.length})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => void triggerSync()}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                ซิงค์ตอนนี้
              </button>
            </div>

            <ul className="divide-y divide-border">
              {outboxItems.map((item) => (
                <li key={item.id} className="py-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-primary">
                      {item.entity_type} · {item.operation}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase ${
                        item.sync_status === 'conflict'
                          ? 'bg-danger/10 text-danger'
                          : 'bg-warning/10 text-warning'
                      }`}
                    >
                      {item.sync_status}
                    </span>
                  </div>
                  {item.last_error && (
                    <p className="text-danger">{item.last_error}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {item.sync_status === 'conflict' ? (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await resolveConflictKeepLocal(item.id);
                            await refresh();
                            await loadOutbox();
                          }}
                          className="px-2.5 py-1 rounded-[8px] bg-accent/10 text-accent font-medium"
                        >
                          เก็บข้อมูลในเครื่องและซิงค์ใหม่
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await resolveConflictDiscardLocal(item.id);
                            await refresh();
                            await loadOutbox();
                          }}
                          className="px-2.5 py-1 rounded-[8px] bg-danger/10 text-danger font-medium"
                        >
                          ยกเลิกรายการในเครื่อง
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          await retryOutboxItem(item.id);
                          await triggerSync();
                          await loadOutbox();
                        }}
                        className="px-2.5 py-1 rounded-[8px] border border-border text-primary font-medium"
                      >
                        ลองส่งใหม่
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </MobileShell>
  );
}
