'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useTranslation } from '@/lib/i18n/useTranslation';

const PRODUCT_COLORS = ['#10b981', '#6366f1', '#06b6d4', '#ec4899', '#8b5cf6', '#f97316'];

export default function ProductionChart({ data, products }: { data: Record<string, string | number>[]; products: string[] }) {
  const { t } = useTranslation();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top:4, right:8, bottom:0, left:-8 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize:11, fill:'#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="prod" orientation="left" tick={{ fontSize:11, fill:'#94a3b8' }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
        <YAxis yAxisId="rev" orientation="right" tick={{ fontSize:11, fill:'#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}K`} width={36} />
        <Tooltip cursor={{ fill:'#f8fafc' }} contentStyle={{ borderRadius:12, border:'1px solid #e2e8f0', fontSize:12, boxShadow:'0 4px 12px rgba(0,0,0,0.06)' }}
          formatter={(v, n) => n === 'revenue' ? [`KSh ${Number(v).toLocaleString()}`, t('revenue')] : [`${v}`, String(n)]} />
        {products.map((p, i) => (
          <Bar key={p} yAxisId="prod" dataKey={p} stackId="prod" fill={PRODUCT_COLORS[i % PRODUCT_COLORS.length]} maxBarSize={28} />
        ))}
        <Bar yAxisId="rev" dataKey="revenue" fill="#fbbf24" radius={[4,4,0,0]} maxBarSize={12} />
      </BarChart>
    </ResponsiveContainer>
  );
}
