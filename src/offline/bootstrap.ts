import { localDb } from '@/offline/indexeddb/db';
import type { Category, FinancialAccount } from '@/types/financial';

export const DEFAULT_LOCAL_HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
export const DEFAULT_LOCAL_USER_ID = '22222222-2222-4222-8222-222222222222';

const SEED_ACCOUNTS: FinancialAccount[] = [
  {
    id: 'aaaa1111-1111-4111-8111-111111111111',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    ledger_account_id: 'la-1100-cash',
    account_class: 'ASSET',
    name: 'เงินสด (Cash)',
    account_type: 'cash',
    institution: 'Wallet',
    currency_code: 'THB',
    opening_balance: '2500.0000',
    owner_user_id: DEFAULT_LOCAL_USER_ID,
    is_private: false,
    is_active: true,
  },
  {
    id: 'aaaa2222-2222-4222-8222-222222222222',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    ledger_account_id: 'la-1200-bank',
    account_class: 'ASSET',
    name: 'บัญชีธนาคารหลัก (Main Bank)',
    account_type: 'bank',
    institution: 'KBank',
    currency_code: 'THB',
    opening_balance: '35000.0000',
    owner_user_id: DEFAULT_LOCAL_USER_ID,
    is_private: false,
    is_active: true,
  },
  {
    id: 'aaaa3333-3333-4333-8333-333333333333',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    ledger_account_id: 'la-2100-cc',
    account_class: 'LIABILITY',
    name: 'บัตรเครดิต (Credit Card)',
    account_type: 'credit_card',
    institution: 'KTC',
    currency_code: 'THB',
    opening_balance: '0.0000',
    owner_user_id: DEFAULT_LOCAL_USER_ID,
    is_private: false,
    is_active: true,
  },
];

const SEED_CATEGORIES: Category[] = [
  {
    id: 'cccc1111-1111-4111-8111-111111111111',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    parent_id: null,
    ledger_account_id: 'la-4100-salary',
    name: 'เงินเดือน (Salary)',
    category_type: 'INCOME',
    icon: 'banknote',
    color: '#39846C',
    sort_order: 1,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cccc1222-1222-4122-8122-111111111111',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    parent_id: null,
    ledger_account_id: 'la-4200-freelance',
    name: 'ฟรีแลนซ์ (Freelance)',
    category_type: 'INCOME',
    icon: 'briefcase',
    color: '#4DA488',
    sort_order: 2,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cccc2111-2111-4211-8211-111111111111',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    parent_id: null,
    ledger_account_id: 'la-5200-food',
    name: 'อาหารและเครื่องดื่ม',
    category_type: 'EXPENSE',
    icon: 'utensils',
    color: '#202B27',
    sort_order: 10,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cccc2222-2222-4222-8222-111111111111',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    parent_id: null,
    ledger_account_id: 'la-5300-transport',
    name: 'การเดินทาง',
    category_type: 'EXPENSE',
    icon: 'car',
    color: '#39846C',
    sort_order: 20,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cccc2333-2333-4233-8233-111111111111',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    parent_id: null,
    ledger_account_id: 'la-5100-housing',
    name: 'ที่อยู่อาศัย & สาธารณูปโภค',
    category_type: 'EXPENSE',
    icon: 'home',
    color: '#C28B48',
    sort_order: 30,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cccc2444-2444-4244-8244-111111111111',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    parent_id: null,
    ledger_account_id: 'la-5400-personal',
    name: 'ส่วนตัว & ช้อปปิ้ง',
    category_type: 'EXPENSE',
    icon: 'shopping-bag',
    color: '#858B85',
    sort_order: 40,
    is_system: true,
    is_active: true,
  },
  {
    id: 'cccc2555-2555-4255-8255-111111111111',
    household_id: DEFAULT_LOCAL_HOUSEHOLD_ID,
    parent_id: null,
    ledger_account_id: 'la-5900-misc',
    name: 'อื่นๆ',
    category_type: 'EXPENSE',
    icon: 'more-horizontal',
    color: '#C75B50',
    sort_order: 90,
    is_system: true,
    is_active: true,
  },
];

let initPromise: Promise<void> | null = null;

export async function ensureLocalHouseholdInitialized(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const accountCount = await localDb.accounts.count();
    if (accountCount === 0) {
      await localDb.accounts.bulkPut(SEED_ACCOUNTS);
    }
    const categoryCount = await localDb.categories.count();
    if (categoryCount === 0) {
      await localDb.categories.bulkPut(SEED_CATEGORIES);
    }
  })();

  return initPromise;
}
