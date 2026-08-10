'use client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Legend } from 'recharts';
import { useTranslation } from '@/lib/i18n/useTranslation';

const fmtKES = (n: number) => `KSh ${Math.abs(n).toLocaleString('en-KE')}`;

export function CostDonut({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Tooltip formatter={(v: number) => fmtKES(v)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CumulativeChart({ data }: { data: { day: number; cost: number; revenue: number }[] }) {
  const { t } = useTranslation();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top:5, right:10, bottom:0, left:0 }}>
        <XAxis dataKey="day" tick={{ fontSize:10 }} label={{ value:'Day', position:'insideBottom', offset:-2 }} />
        <YAxis tick={{ fontSize:10 }} tickFormatter={v=>`${(v/1000).toFixed(0)}K`} />
        {/* Recharts passes `n` the Area's `name` prop below (already the
            translated "Cost"/"Revenue" label), not the raw dataKey — so just
            format the value and let each series' own `name` supply the label,
            rather than re-deriving it here (a re-derivation that previously
            compared against the untranslated 'cost' string, never matched,
            and made every row show "Revenue"). */}
        <Tooltip formatter={(v: number) => fmtKES(v)} />
        <Legend />
        <Area type="monotone" dataKey="cost" stroke="#ef4444" fill="#fee2e2" name={t('cost')} strokeWidth={2} />
        <Area type="monotone" dataKey="revenue" stroke="#16a34a" fill="#dcfce7" name={t('revenue')} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
