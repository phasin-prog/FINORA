'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { MobileShell } from '@/components/layout/MobileShell';
import { useFinora } from '@/components/layout/FinoraProvider';
import {
  CATEGORY_ICON_CHOICES,
  CategoryIcon,
} from '@/components/financial/category-icon';
import { createCategory } from '@/modules/categories/service';

const COLOR_CHOICES = ['#202B27', '#39846C', '#C28B48', '#C75B50', '#858B85'];

export default function CategoriesPage() {
  const { householdId, categories, refresh } = useFinora();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [categoryType, setCategoryType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [icon, setIcon] = useState('utensils');
  const [color, setColor] = useState('#202B27');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createCategory({
        householdId,
        name: name.trim(),
        categoryType,
        icon,
        color,
      });
      setName('');
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถสร้างหมวดหมู่ได้');
    }
  }

  return (
    <MobileShell title="จัดการหมวดหมู่">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">เพิ่มหมวดหมู่รายรับ-รายจ่ายและไอคอน</p>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] bg-primary text-primary-foreground text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            เพิ่มหมวดหมู่
          </button>
        </div>

        {showForm && (
          <form
            onSubmit={handleCreate}
            className="bg-surface border border-border rounded-[18px] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">เพิ่มหมวดหมู่ใหม่</h2>
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
                <label className="block text-xs text-muted mb-1">ชื่อหมวดหมู่</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="เช่น ค่าน้ำมัน, โบนัส"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">ประเภท</label>
                <select
                  value={categoryType}
                  onChange={(e) =>
                    setCategoryType(e.target.value as 'EXPENSE' | 'INCOME')
                  }
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-[8px]"
                >
                  <option value="EXPENSE">รายจ่าย (Expense)</option>
                  <option value="INCOME">รายรับ (Income)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1.5">เลือกไอคอน</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_ICON_CHOICES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setIcon(c.key)}
                    title={c.label}
                    className={`p-2 rounded-[10px] border transition-colors ${
                      icon === c.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-primary border-border'
                    }`}
                  >
                    <CategoryIcon icon={c.key} className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1.5">สีหมวดหมู่</label>
              <div className="flex items-center gap-2">
                {COLOR_CHOICES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full border-2 ${
                      color === c ? 'border-primary scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`สี ${c}`}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <button
              type="submit"
              className="w-full py-2.5 rounded-[10px] bg-primary text-primary-foreground text-sm font-medium"
            >
              บันทึกหมวดหมู่
            </button>
          </form>
        )}

        <section className="bg-surface border border-border rounded-[18px] divide-y divide-border overflow-hidden">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="px-4 py-3 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: cat.color || '#202B27' }}
                >
                  <CategoryIcon icon={cat.icon} className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-primary truncate">
                    {cat.name}
                  </p>
                  <p className="text-[11px] text-muted uppercase">
                    {cat.category_type}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </MobileShell>
  );
}
