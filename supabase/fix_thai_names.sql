-- Repair any mojibake Thai names in existing Supabase rows
UPDATE public.accounts SET name = 'เงินสด (Cash)' WHERE account_type = 'cash' AND name LIKE '%(Cash)%';
UPDATE public.accounts SET name = 'บัญชีธนาคารหลัก (Main Bank)' WHERE account_type = 'bank' AND name LIKE '%(Main Bank)%';

UPDATE public.categories SET name = 'เงินเดือน (Salary)' WHERE name LIKE '%(Salary)%';
UPDATE public.categories SET name = 'ฟรีแลนซ์ (Freelance)' WHERE name LIKE '%(Freelance)%';
UPDATE public.categories SET name = 'เงินปันผล (Dividends)' WHERE name LIKE '%(Dividends)%';
UPDATE public.categories SET name = 'อาหารและเครื่องดื่ม (Food)' WHERE name LIKE '%(Food)%';
UPDATE public.categories SET name = 'การเดินทาง (Transport)' WHERE name LIKE '%(Transport)%';
UPDATE public.categories SET name = 'ที่อยู่อาศัย (Housing)' WHERE name LIKE '%(Housing)%';
UPDATE public.categories SET name = 'ส่วนตัว (Personal)' WHERE name LIKE '%(Personal)%';
UPDATE public.categories SET name = 'ดอกเบี้ยและค่าธรรมเนียม' WHERE icon = 'percent' AND is_system = TRUE;
UPDATE public.categories SET name = 'อื่นๆ (Miscellaneous)' WHERE name LIKE '%(Miscellaneous)%';
UPDATE public.categories SET name = 'โอนเงินระหว่างบัญชี (Transfer)' WHERE name LIKE '%(Transfer)%';
