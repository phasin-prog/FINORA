'use client';

import dynamic from 'next/dynamic';

export const LazySpendingDoughnutChart = dynamic(
  () =>
    import('@/components/charts/SpendingDoughnutChart').then(
      (mod) => mod.SpendingDoughnutChart
    ),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-56 rounded-[14px] bg-background animate-pulse flex items-center justify-center text-xs text-muted">
        กำลังโหลดกราฟ...
      </div>
    ),
  }
);

export const LazyCashFlowBarChart = dynamic(
  () =>
    import('@/components/charts/CashFlowBarChart').then(
      (mod) => mod.CashFlowBarChart
    ),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-64 rounded-[14px] bg-background animate-pulse flex items-center justify-center text-xs text-muted">
        กำลังโหลดกราฟ...
      </div>
    ),
  }
);
