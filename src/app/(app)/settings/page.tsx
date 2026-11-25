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
import { importTransactionsFromCsv } from '@/offline/csv-import';
import type { OutboxItem } from '@/offline/indexeddb/db';
import {
  clearOutboxForHousehold,
  listOutboxItems,
  removeOutboxItem,
  resolveConflictDiscardLocal,
  resolveConflictKeepLocal,
  retryOutboxItem,
} from '@/offline/conflict/resolver';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  ACTIVE_EMAIL_KEY,
  ACTIVE_HOUSEHOLD_KEY,
  ACTIVE_USER_KEY,
} from '@/offline/sync/pull';

export default function SettingsPage() {
  const {
    householdId,
    userId,
    isAuthenticated,
    authEmail,
    accounts,
    transactions,
    pendingSyncCount,
    triggerSync,
    refresh,
  } = useFinora();
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>([]);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

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

  async function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupError(null);
    setBackupMessage(null);
    try {
      const text = await file.text();
      const res = await importTransactionsFromCsv({
        csvText: text,
        householdId,
        userId,
        defaultAccountId: accounts[0]?.id,
      });
      await refresh();
      setBackupMessage(
        `นำเข้า CSV สำเร็จ ${res.importedCount} รายการ` +
          (res.skippedCount > 0 ? ` (ข้าม ${res.skippedCount} รายการ)` : '')
      );
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'ไม่สามารถนำเข้าไฟล์ CSV ได้'
      );
    } finally {
      e.target.value = '';
    }
  }

  return (
    <MobileShell title="บัญชีและการตั้งค่า">
      <div className="space-y-5">
        {/* User Account & Log In / Log Out Card (Top Position) */}
        <section className="bg-surface border border-border rounded-[18px] p-5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-medium mb-2">
            บัญชีผู้ใช้ (ACCOUNT)
          </p>
          {isAuthenticated ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                  <p className="text-sm font-semibold text-primary truncate">
                    {authEmail || 'บัญชีผู้ใช้ FINORA'}
                  </p>
                </div>
                <p className="text-xs text-muted mt-0.5 truncate">
                  สถานะ: เข้าสู่ระบบแล้ว · Sync เปิดใช้งาน
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const supabase = createSupabaseBrowserClient();
                  await supabase.auth.signOut();
                  localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
                  localStorage.removeItem(ACTIVE_USER_KEY);
                  localStorage.removeItem(ACTIVE_EMAIL_KEY);
                  await refresh(true);
                }}
                className="px-3.5 py-2 rounded-[10px] border border-danger/30 bg-danger/10 text-danger text-xs font-medium shrink-0 hover:bg-danger/20"
              >
                ออกจากระบบ
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">
                  ยังไม่ได้เข้าสู่ระบบ
                </p>
                <p className="text-xs text-muted mt-0.5">
                  กำลังใช้งานแบบออฟไลน์เฉพาะในเครื่องนี้
                </p>
              </div>
              <Link
                href="/login"
                className="px-4 py-2 rounded-[10px] bg-primary text-primary-foreground text-xs font-medium shrink-0 hover:opacity-90"
              >
                เข้าสู่ระบบ
              </Link>
            </div>
          )}
        </section>

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

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="py-2.5 px-3 rounded-[10px] border border-border bg-background text-primary text-xs font-medium flex items-center justify-center gap-1.5 hover:border-primary/40"
            >
              <Download className="w-4 h-4" />
              ส่งออก CSV ({transactions.length})
            </button>
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="py-2.5 px-3 rounded-[10px] border border-border bg-background text-primary text-xs font-medium flex items-center justify-center gap-1.5 hover:border-primary/40"
            >
              <Upload className="w-4 h-4 text-accent" />
              นำเข้า CSV
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void handleImportCsv(e)}
              className="hidden"
            />
          </div>

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

          {isAuthenticated ? (
            <div className="p-3 rounded-[10px] bg-accent/10 border border-accent/30 flex items-center justify-between gap-2 text-xs">
              <div>
                <p className="font-semibold text-accent">เชื่อมต่อ Cloud แล้ว</p>
                <p className="text-primary mt-0.5">{authEmail || 'Supabase Account'}</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const supabase = createSupabaseBrowserClient();
                  await supabase.auth.signOut();
                  localStorage.removeItem(ACTIVE_HOUSEHOLD_KEY);
                  localStorage.removeItem(ACTIVE_USER_KEY);
                  localStorage.removeItem(ACTIVE_EMAIL_KEY);
                  await refresh(true);
                }}
                className="px-3 py-1.5 rounded-[8px] border border-border bg-surface text-primary font-medium hover:text-danger"
              >
                ออกจากระบบ
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="w-full py-2.5 px-4 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 hover:opacity-90"
            >
              <LogIn className="w-4 h-4" />
              เข้าสู่ระบบ / เชื่อมต่อ Cloud (Supabase)
            </Link>
          )}
        </section>

        {/* Outbox & Conflict Inspector */}
        {outboxItems.length > 0 && (
          <section className="bg-surface border border-border rounded-[18px] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning" />
                <h2 className="text-sm font-semibold text-primary">
                  คิวซิงค์และรายการขัดแย้ง ({outboxItems.length})
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const summary = await triggerSync();
                    if (summary.error) {
                      setSyncFeedback(summary.error);
                    } else if (summary.offline) {
                      setSyncFeedback('ขณะนี้ออฟไลน์ กรุณาเชื่อมต่ออินเทอร์เน็ต');
                    } else if (summary.syncedCount > 0) {
                      setSyncFeedback(`ซิงค์สำเร็จ ${summary.syncedCount} รายการ`);
                    }
                    await loadOutbox();
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  ซิงค์ตอนนี้
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await clearOutboxForHousehold(householdId);
                    setSyncFeedback('ล้างคิวซิงค์ในเครื่องเรียบร้อยแล้ว');
                    await refresh();
                    await loadOutbox();
                  }}
                  className="px-2.5 py-1 rounded-[8px] border border-border text-xs font-medium text-muted hover:text-danger hover:border-danger/40"
                >
                  ล้างคิวทั้งหมด
                </button>
              </div>
            </div>

            {syncFeedback && (
              <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-[8px] px-3 py-2 flex items-center justify-between gap-2">
                <span>{syncFeedback}</span>
                {syncFeedback.includes('เข้าสู่ระบบ') && (
                  <Link
                    href="/login"
                    className="font-semibold text-primary underline shrink-0"
                  >
                    เข้าสู่ระบบ
                  </Link>
                )}
              </div>
            )}

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
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            await retryOutboxItem(item.id);
                            const summary = await triggerSync();
                            if (summary.error) {
                              setSyncFeedback(summary.error);
                            } else if (summary.syncedCount > 0) {
                              setSyncFeedback(`ซิงค์สำเร็จ ${summary.syncedCount} รายการ`);
                            }
                            await loadOutbox();
                          }}
                          className="px-2.5 py-1 rounded-[8px] border border-border text-primary font-medium"
                        >
                          ลองส่งใหม่
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await removeOutboxItem(item.id);
                            await refresh();
                            await loadOutbox();
                          }}
                          className="px-2.5 py-1 rounded-[8px] border border-border text-muted hover:text-danger font-medium"
                        >
                          นำออกจากคิว
                        </button>
                      </>
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
