import { z } from 'zod';
import { toNumericString } from '@/lib/utilities/money';
import { localDb } from '@/offline/indexeddb/db';
import type { AccountClass, AccountType, FinancialAccount } from '@/types/financial';

const LEDGER_BY_ACCOUNT_TYPE: Record<
  AccountType,
  { ledgerId: string; accountClass: AccountClass }
> = {
  cash: { ledgerId: 'la-1100-cash', accountClass: 'ASSET' },
  bank: { ledgerId: 'la-1200-bank', accountClass: 'ASSET' },
  wallet: { ledgerId: 'la-1300-wallet', accountClass: 'ASSET' },
  investment: { ledgerId: 'la-1400-invest', accountClass: 'ASSET' },
  credit_card: { ledgerId: 'la-2100-cc', accountClass: 'LIABILITY' },
  loan: { ledgerId: 'la-2200-loan', accountClass: 'LIABILITY' },
};

export const createAccountSchema = z.object({
  householdId: z.string().uuid(),
  ownerUserId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อบัญชี'),
  accountType: z.enum(['cash', 'bank', 'wallet', 'investment', 'credit_card', 'loan']),
  institution: z.string().trim().max(100).nullable().optional(),
  accountNumber: z.string().trim().max(50).nullable().optional(),
  icon: z.string().trim().max(40).nullable().optional(),
  openingBalance: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'ยอดตั้งต้นต้องเป็นตัวเลข')
    .default('0'),
  currencyCode: z.string().length(3).default('THB'),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export async function createFinancialAccount(
  rawInput: CreateAccountInput
): Promise<FinancialAccount> {
  const input = createAccountSchema.parse(rawInput);
  const mapping = LEDGER_BY_ACCOUNT_TYPE[input.accountType];

  const account: FinancialAccount = {
    id: crypto.randomUUID(),
    household_id: input.householdId,
    ledger_account_id: `${mapping.ledgerId}-${crypto.randomUUID().slice(0, 8)}`,
    account_class: mapping.accountClass,
    name: input.name,
    account_type: input.accountType,
    institution: input.institution || null,
    account_number: input.accountNumber || null,
    icon: input.icon || null,
    currency_code: input.currencyCode.toUpperCase(),
    opening_balance: toNumericString(input.openingBalance, 4),
    owner_user_id: input.ownerUserId ?? null,
    is_private: false,
    is_active: true,
  };

  await localDb.accounts.add(account);
  return account;
}

export async function updateFinancialAccount(
  accountId: string,
  patch: Partial<
    Pick<
      FinancialAccount,
      'name' | 'account_type' | 'institution' | 'account_number' | 'opening_balance' | 'icon' | 'is_active'
    >
  >
): Promise<FinancialAccount> {
  const existing = await localDb.accounts.get(accountId);
  if (!existing) {
    throw new Error('ไม่พบบัญชีที่ต้องการแก้ไข');
  }

  const nextType = patch.account_type ?? existing.account_type;
  const mapping = LEDGER_BY_ACCOUNT_TYPE[nextType];

  const updated: FinancialAccount = {
    ...existing,
    ...patch,
    account_type: nextType,
    account_class: mapping.accountClass,
    opening_balance:
      patch.opening_balance !== undefined
        ? toNumericString(patch.opening_balance, 4)
        : existing.opening_balance,
  };

  await localDb.accounts.put(updated);
  return updated;
}
