'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTranslation } from '@/lib/i18n/useTranslation';

const PCOLORS = ['#10b981', '#6366f1', '#06b6d4', '#ec4899', '#8b5cf6', '#f97316'];

export default function DashboardChart({ data, products }: { data: Record<string, string | number>[]; products: string[] }) {
  const { t } = useTranslation();
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <XAxis dataKey="date" tick={{ fontSize:11 }} />
        <YAxis tick={{ fontSize:11 }} allowDecimals={false} />
        <Tooltip formatter={(v, n) => n === 'revenue' ? [`KSh ${Number(v).toLocaleString()}`, t('revenue')] : [`${v}`, String(n)]} />
        {products.map((p, i) => <Bar key={p} dataKey={p} stackId="prod" fill={PCOLORS[i % PCOLORS.length]} radius={[4,4,0,0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}
