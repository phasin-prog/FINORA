import { sanitizeMoneyInput } from '@/lib/utilities/money';
import { createLocalTransaction } from '@/modules/transactions/service';
import { localDb } from '@/offline/indexeddb/db';
import type { TransactionType } from '@/types/financial';

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export async function importTransactionsFromCsv(params: {
  csvText: string;
  householdId: string;
  userId: string;
  defaultAccountId?: string;
}): Promise<{ importedCount: number; skippedCount: number }> {
  const cleanText = params.csvText.replace(/^\uFEFF/, '');
  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('ไฟล์ CSV ไม่มีข้อมูลรายการ');
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const dateIdx = headers.findIndex((h) => h === 'date' || h === 'transaction_date' || h === 'วันที่');
  const typeIdx = headers.findIndex((h) => h === 'type' || h === 'transaction_type' || h === 'ประเภท');
  const amountIdx = headers.findIndex((h) => h === 'amount' || h === 'จำนวนเงิน');
  const descIdx = headers.findIndex((h) => h === 'description' || h === 'รายละเอียด');
  const statusIdx = headers.findIndex((h) => h === 'status');

  if (dateIdx === -1 || amountIdx === -1) {
    throw new Error('ไฟล์ CSV ต้องมีคอลัมน์ date และ amount');
  }

  const [accounts, categories] = await Promise.all([
    localDb.accounts.where('household_id').equals(params.householdId).toArray(),
    localDb.categories.where('household_id').equals(params.householdId).toArray(),
  ]);

  const targetAccountId = params.defaultAccountId || accounts[0]?.id;
  if (!targetAccountId) {
    throw new Error('ไม่พบบัญชีสำหรับนำเข้าข้อมูล');
  }

  const defaultIncomeCat = categories.find((c) => c.category_type === 'INCOME')?.id ?? null;
  const defaultExpenseCat = categories.find((c) => c.category_type === 'EXPENSE')?.id ?? null;

  let importedCount = 0;
  let skippedCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const rawDate = cols[dateIdx] ?? '';
    const rawAmount = cols[amountIdx] ?? '';
    const rawType = (typeIdx >= 0 ? cols[typeIdx] : '')?.toLowerCase() ?? '';
    const rawDesc = (descIdx >= 0 ? cols[descIdx] : '') ?? '';
    const rawStatus = (statusIdx >= 0 ? cols[statusIdx] : '')?.toLowerCase() ?? '';

    if (rawStatus === 'reversed' || rawStatus === 'cancelled') {
      skippedCount += 1;
      continue;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      skippedCount += 1;
      continue;
    }

    const sanitizedAmt = sanitizeMoneyInput(rawAmount);
    if (!sanitizedAmt || Number(sanitizedAmt) <= 0) {
      skippedCount += 1;
      continue;
    }

    let txType: TransactionType = 'expense';
    if (
      rawType === 'income' ||
      rawType === 'รายรับ' ||
      (!rawType && !rawAmount.trim().startsWith('-') && rawAmount.trim().startsWith('+'))
    ) {
      txType = 'income';
    } else if (rawType === 'transfer' || rawType === 'โอนเงิน') {
      // Transfers require two distinct accounts; skip if only 1 account exists
      if (accounts.length < 2) {
        skippedCount += 1;
        continue;
      }
      txType = 'transfer';
    }

    const categoryId =
      txType === 'income'
        ? defaultIncomeCat
        : txType === 'expense'
          ? defaultExpenseCat
          : null;

    if (txType !== 'transfer' && !categoryId) {
      skippedCount += 1;
      continue;
    }

    await createLocalTransaction(
      {
        householdId: params.householdId,
        transactionType: txType,
        amount: sanitizedAmt,
        currencyCode: 'THB',
        transactionDate: rawDate,
        accountId: targetAccountId,
        toAccountId: txType === 'transfer' ? accounts[1]?.id ?? null : null,
        categoryId,
        description: rawDesc,
        idempotencyKey: crypto.randomUUID(),
        asDraft: false,
      },
      params.userId
    );
    importedCount += 1;
  }

  return { importedCount, skippedCount };
}
