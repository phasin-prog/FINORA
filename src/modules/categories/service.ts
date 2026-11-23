import { z } from 'zod';
import { localDb } from '@/offline/indexeddb/db';
import type { Category } from '@/types/financial';

export const createCategorySchema = z.object({
  householdId: z.string().uuid(),
  name: z.string().trim().min(1, 'กรุณาระบุชื่อหมวดหมู่'),
  categoryType: z.enum(['INCOME', 'EXPENSE', 'INVESTMENT']),
  icon: z.string().trim().max(40).default('tag'),
  color: z.string().trim().max(20).default('#202B27'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export async function createCategory(
  rawInput: CreateCategoryInput
): Promise<Category> {
  const input = createCategorySchema.parse(rawInput);

  const ledgerId =
    input.categoryType === 'INCOME'
      ? 'la-4100-salary'
      : input.categoryType === 'INVESTMENT'
        ? 'la-1400-invest'
        : 'la-5900-misc';

  const existingCount = await localDb.categories
    .where('household_id')
    .equals(input.householdId)
    .count();

  const category: Category = {
    id: crypto.randomUUID(),
    household_id: input.householdId,
    parent_id: null,
    ledger_account_id: ledgerId,
    name: input.name,
    category_type: input.categoryType,
    icon: input.icon,
    color: input.color,
    sort_order: existingCount + 10,
    is_system: false,
    is_active: true,
  };

  await localDb.categories.add(category);
  return category;
}

export async function updateCategory(
  categoryId: string,
  patch: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'is_active'>>
): Promise<Category> {
  const existing = await localDb.categories.get(categoryId);
  if (!existing) {
    throw new Error('ไม่พบหมวดหมู่ที่ต้องการแก้ไข');
  }
  const updated: Category = {
    ...existing,
    ...patch,
  };
  await localDb.categories.put(updated);
  return updated;
}
