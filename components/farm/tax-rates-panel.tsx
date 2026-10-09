'use client';
// Platform admin: date-bounded VAT rates (issue #419). No rate is seeded.
// The percent on an existing row is not editable.
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';
import { formatRatePercent, TAX_CODE } from '@/lib/tax';
import { useAdminCapabilities } from '@/components/admin/capabilities';
import { Button } from '@/components/ui-kit/button';
import { Field } from '@/components/ui-kit/field';
import { Input } from '@/components/ui-kit/input';
import { DateField } from '@/components/ui-kit/date-field';

interface TaxCodeRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface TaxRateRow {
  id: string;
  taxCode: string;
  rateBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

const inputClass = 'min-h-11 h-11';

export function TaxRatesPanel() {
  const { loading: capLoading, has } = useAdminCapabilities();
  const [codes, setCodes] = useState<TaxCodeRow[] | null>(null);
  const [rates, setRates] = useState<TaxRateRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [percent, setPercent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [endDates, setEndDates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    apiClient.get<{ codes: TaxCodeRow[]; rates: TaxRateRow[] }>('/api/admin/tax-rates').then((res) => {
      if (res.success) {
        setCodes(res.data.codes);
        setRates(res.data.rates);
        setLoadError('');
      } else {
        setCodes(null);
        setRates(null);
        setLoadError(res.error || 'Could not load VAT rates.');
      }
    });
  }, []);

  const canManageCatalogue = !capLoading && has('catalogue.manage');
  useEffect(() => { if (canManageCatalogue) load(); }, [canManageCatalogue, load]);

  async function addRate() {
    setFormError('');
    if (!percent.trim()) { setFormError('Enter the percent. Nothing is filled in for you.'); return; }
    if (!effectiveFrom) { setFormError('Enter the first day this rate applies.'); return; }
    setSaving(true);
    const res = await apiClient.post<TaxRateRow>('/api/admin/tax-rates', {
      taxCode: TAX_CODE.VATABLE,
      percent: percent.trim(),
      effectiveFrom,
      effectiveTo: effectiveTo || undefined,
    });
    setSaving(false);
    if (res.success) {
      setPercent('');
      setEffectiveFrom('');
      setEffectiveTo('');
      load();
    } else {
      setFormError(res.error || 'Could not add that rate.');
    }
  }

  async function setEnd(row: TaxRateRow) {
    const end = endDates[row.id];
    setFormError('');
    if (!end) { setFormError('Pick the last day this rate applies.'); return; }
    const res = await apiClient.patch<TaxRateRow>(`/api/admin/tax-rates/${row.id}`, { effectiveTo: end });
    if (res.success) load();
    else setFormError(res.error || 'Could not set that end date.');
  }

  if (!capLoading && !has('catalogue.manage')) {
    return (
      <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="section-eyebrow" style={{ marginBottom: 8 }}>VAT rates</div>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Maintaining VAT rates needs the catalogue.manage capability. This session does not have it.
        </p>
      </div>
    );
  }

  const vatable = (codes ?? []).find((code) => code.code === TAX_CODE.VATABLE && code.active);

  return (
    <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>VAT rates</div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
        Shared across every farm. A rate applies to VATable documents whose posting date falls in its window, including the end date. The percent cannot be edited afterwards. No rate is filled in until you add one.
      </p>
      {capLoading && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)' }}>Checking access…</div>}
      {loadError && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 8 }}>{loadError}</div>}
      {rates === null && !loadError && !capLoading && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)' }}>Loading VAT rates…</div>}
      {rates !== null && rates.length === 0 && !loadError && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginBottom: 10 }}>
          No VAT rate is configured. A VATable document cannot be saved until a rate covers its posting date.
        </div>
      )}
      {rates !== null && rates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {rates.map((rate) => (
            <div key={rate.id} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 650 }}>{formatRatePercent(rate.rateBps)} · {rate.taxCode}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                {rate.effectiveFrom} to {rate.effectiveTo ?? 'open'}
              </div>
              {rate.effectiveTo == null && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  <DateField value={endDates[rate.id] ?? ''} onChange={(value) => setEndDates((prev) => ({ ...prev, [rate.id]: value }))} aria-label={`End date for ${formatRatePercent(rate.rateBps)}`} />
                  <Button type="button" size="lg" variant="outline" className="min-h-11 w-full" onClick={() => setEnd(rate)}>Set end date</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {formError && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 8 }}>{formError}</div>}
      {codes !== null && !vatable && !loadError && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>The VATable code is not in the catalogue, so a rate cannot be added.</p>
      )}
      {vatable && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="Rate (percent)">
            <Input className={inputClass} inputMode="decimal" placeholder="16" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </Field>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: -4 }}>16 is 16.00%. This applies to VATable only.</p>
          <Field label="First day">
            <DateField value={effectiveFrom} onChange={setEffectiveFrom} aria-label="First day this rate applies" />
          </Field>
          <Field label="Last day (optional)">
            <DateField value={effectiveTo} onChange={setEffectiveTo} aria-label="Last day this rate applies" />
          </Field>
          <Button type="button" size="lg" className="min-h-11 w-full" disabled={saving} onClick={addRate}>
            {saving ? 'Saving…' : 'Add VAT rate'}
          </Button>
        </div>
      )}
    </div>
  );
}
