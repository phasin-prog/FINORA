'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { formatTHB } from '@/lib/utilities/money';

export interface SpendingSlice {
  name: string;
  value: number;
  color?: string;
}

const EDITORIAL_PALETTE = [
  '#202B27',
  '#39846C',
  '#C28B48',
  '#858B85',
  '#C75B50',
  '#4DA488',
];

export function SpendingDoughnutChart({
  data,
  totalLabel,
}: {
  data: SpendingSlice[];
  totalLabel: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);

    const hasData = data.length > 0 && data.some((d) => d.value > 0);
    const seriesData = hasData
      ? data.map((d, idx) => ({
          name: d.name,
          value: d.value,
          itemStyle: {
            color: d.color || EDITORIAL_PALETTE[idx % EDITORIAL_PALETTE.length],
          },
        }))
      : [{ name: 'ยังไม่มีรายจ่าย', value: 1, itemStyle: { color: '#E6E5DF' } }];

    chart.setOption({
      tooltip: {
        trigger: 'item',
        formatter: (params: { name: string; value: number; percent: number }) => {
          if (!hasData) return 'ยังไม่มีรายจ่ายในช่วงนี้';
          return `${params.name}<br/><strong>${formatTHB(params.value)}</strong> (${params.percent}%)`;
        },
      },
      series: [
        {
          name: 'สัดส่วนรายจ่าย',
          type: 'pie',
          radius: ['58%', '82%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: '#FFFFFF',
            borderWidth: 2,
          },
          label: { show: false },
          data: seriesData,
        },
      ],
      graphic: [
        {
          type: 'group',
          left: 'center',
          top: 'center',
          children: [
            {
              type: 'text',
              style: {
                text: 'รวมรายจ่าย',
                fill: '#858B85',
                font: '500 11px Inter, sans-serif',
                textAlign: 'center',
              },
              left: 'center',
              top: -12,
            },
            {
              type: 'text',
              style: {
                text: totalLabel,
                fill: '#202B27',
                font: '600 16px Inter, sans-serif',
                textAlign: 'center',
              },
              left: 'center',
              top: 6,
            },
          ],
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
    };
  }, [data, totalLabel]);

  return (
    <div>
      <div ref={chartRef} className="w-full h-56" />
      {data.length > 0 && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.map((item, idx) => (
            <div
              key={item.name}
              className="flex items-center justify-between text-xs py-1 px-2 rounded-[8px] bg-background"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      item.color || EDITORIAL_PALETTE[idx % EDITORIAL_PALETTE.length],
                  }}
                />
                <span className="truncate text-primary">{item.name}</span>
              </div>
              <span className="tabular-nums font-medium text-primary ml-2">
                {formatTHB(item.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
