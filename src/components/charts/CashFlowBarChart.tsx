'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { formatTHB } from '@/lib/utilities/money';

export interface MonthlyCashFlowPoint {
  month: string;
  income: number;
  expense: number;
}

export function CashFlowBarChart({ data }: { data: MonthlyCashFlowPoint[] }) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ seriesName: string; value: number; axisValue: string }>) => {
          if (!params.length) return '';
          const header = `<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`;
          const rows = params
            .map((p) => `${p.seriesName}: <strong>${formatTHB(p.value)}</strong>`)
            .join('<br/>');
          return header + rows;
        },
      },
      legend: {
        bottom: 0,
        textStyle: { color: '#858B85', fontSize: 12 },
      },
      grid: { top: 16, right: 12, bottom: 36, left: 48 },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.month),
        axisLine: { lineStyle: { color: '#E6E5DF' } },
        axisLabel: { color: '#858B85', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#E6E5DF', type: 'dashed' } },
        axisLabel: {
          color: '#858B85',
          fontSize: 11,
          formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`),
        },
      },
      series: [
        {
          name: 'รายรับ',
          type: 'bar',
          barMaxWidth: 20,
          itemStyle: { color: '#39846C', borderRadius: [4, 4, 0, 0] },
          data: data.map((d) => d.income),
        },
        {
          name: 'รายจ่าย',
          type: 'bar',
          barMaxWidth: 20,
          itemStyle: { color: '#202B27', borderRadius: [4, 4, 0, 0] },
          data: data.map((d) => d.expense),
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.dispose();
    };
  }, [data]);

  return <div ref={chartRef} className="w-full h-64" />;
}
