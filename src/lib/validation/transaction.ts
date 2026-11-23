import { z } from 'zod';

export const moneyStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, 'จำนวนเงินต้องเป็นตัวเลขบวก (ทศนิยมไม่เกิน 4 ตำแหน่ง)')
  .refine((val) => Number(val) > 0, 'จำนวนเงินต้องมากกว่า 0');

export const createTransactionSchema = z
  .object({
    householdId: z.string().uuid(),
    transactionType: z.enum(['income', 'expense', 'transfer']),
    amount: moneyStringSchema,
    currencyCode: z.string().length(3).default('THB'),
    transactionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD'),
    accountId: z.string().uuid(),
    toAccountId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    description: z.string().max(500).default(''),
    notes: z.string().max(2000).nullable().optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
    idempotencyKey: z.string().uuid(),
    asDraft: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.transactionType === 'transfer') {
      if (!data.toAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toAccountId'],
          message: 'กรุณาเลือกบัญชีปลายทางสำหรับการโอนเงิน',
        });
      } else if (data.toAccountId === data.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['toAccountId'],
          message: 'บัญชีต้นทางและปลายทางต้องไม่ซ้ำกัน',
        });
      }
    } else if (!data.categoryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryId'],
        message: 'กรุณาเลือกหมวดหมู่',
      });
    }
  });

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
