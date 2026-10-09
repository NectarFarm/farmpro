'use client';
// Platform admin: PAYE, NSSF and SHIF rates (issue #420). No rate is seeded.
// A fixed amount is stored in the rate_bps column as cents. The percent on
// an existing row is not editable.
import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';
import { parseMoneyToCents, formatMoney } from '@/lib/money';
import { useAdminCapabilities } from '@/components/admin/capabilities';
import { Button } from '@/components/ui-kit/button';
import { Field } from '@/components/ui-kit/field';
import { Input } from '@/components/ui-kit/input';
import { DateField } from '@/components/ui-kit/date-field';
import { Select } from '@/components/ui-kit/select';

interface StatutoryRateRow {
  id: string;
  code: string;
  payer: string;
  kind: string;
  rateBps: number;
  brackets: string | null;
  ceilingCents: number | null;
  floorCents: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

interface BandDraft {
  upTo: string;
  rate: string;
  open: boolean;
}

const inputClass = 'min-h-11 h-11';

function percentToBps(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const bps = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) return null;
  return bps;
}

function describe(row: StatutoryRateRow): string {
  if (row.kind === 'percent') return `${(row.rateBps / 100).toFixed(2)}%`;
  if (row.kind === 'fixed') return `${formatMoney(row.rateBps)} fixed`;
  return 'Brackets';
}

export function StatutoryRatesPanel() {
  const { loading: capLoading, has } = useAdminCapabilities();
  const [rates, setRates] = useState<StatutoryRateRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [code, setCode] = useState('');
  const [payer, setPayer] = useState('');
  const [kind, setKind] = useState('');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [floor, setFloor] = useState('');
  const [bands, setBands] = useState<BandDraft[]>([{ upTo: '', rate: '', open: false }]);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [endDates, setEndDates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    apiClient.get<StatutoryRateRow[]>('/api/admin/statutory-rates').then((res) => {
      if (res.success) {
        setRates(res.data);
        setLoadError('');
      } else {
        setRates(null);
        setLoadError(res.error || 'Could not load statutory rates.');
      }
    });
  }, []);

  const canManageCatalogue = !capLoading && has('catalogue.manage');
  useEffect(() => { if (canManageCatalogue) load(); }, [canManageCatalogue, load]);

  async function addRate() {
    setFormError('');
    if (!code || !payer || !kind) { setFormError('Choose the scheme, who pays, and the kind of rate.'); return; }
    if (!effectiveFrom) { setFormError('Enter the first day this rate applies.'); return; }
    const body: Record<string, unknown> = { code, payer, kind, effectiveFrom, effectiveTo: effectiveTo || undefined };
    if (kind === 'percent') {
      const rateBps = percentToBps(percent);
      if (rateBps == null) { setFormError('Enter the percent, for example 6 for 6.00%.'); return; }
      body.rateBps = rateBps;
    } else if (kind === 'fixed') {
      const amountCents = parseMoneyToCents(amount);
      if (amountCents == null || amountCents < 0) { setFormError('Enter the fixed amount. It is stored in cents.'); return; }
      body.amountCents = amountCents;
    } else {
      const parsed: { upToCents: number | null; rateBps: number }[] = [];
      for (const band of bands) {
        const rateBps = percentToBps(band.rate);
        if (rateBps == null) { setFormError('Each band needs a percent.'); return; }
        if (band.open) {
          parsed.push({ upToCents: null, rateBps });
        } else {
          const upToCents = parseMoneyToCents(band.upTo);
          if (upToCents == null || upToCents <= 0) { setFormError('Each closed band needs an upper amount.'); return; }
          parsed.push({ upToCents, rateBps });
        }
      }
      body.brackets = parsed;
    }
    if (ceiling.trim()) {
      const ceilingCents = parseMoneyToCents(ceiling);
      if (ceilingCents == null) { setFormError('The ceiling must be an amount.'); return; }
      body.ceilingCents = ceilingCents;
    }
    if (floor.trim()) {
      const floorCents = parseMoneyToCents(floor);
      if (floorCents == null) { setFormError('The floor must be an amount.'); return; }
      body.floorCents = floorCents;
    }
    setSaving(true);
    const res = await apiClient.post<StatutoryRateRow>('/api/admin/statutory-rates', body);
    setSaving(false);
    if (res.success) {
      setPercent('');
      setAmount('');
      setCeiling('');
      setFloor('');
      setBands([{ upTo: '', rate: '', open: false }]);
      setEffectiveFrom('');
      setEffectiveTo('');
      load();
    } else {
      setFormError(res.error || 'Could not add that rate.');
    }
  }

  async function setEnd(row: StatutoryRateRow) {
    const end = endDates[row.id];
    setFormError('');
    if (!end) { setFormError('Pick the last day this rate applies.'); return; }
    const res = await apiClient.patch<StatutoryRateRow>(`/api/admin/statutory-rates/${row.id}`, { effectiveTo: end });
    if (res.success) load();
    else setFormError(res.error || 'Could not set that end date.');
  }

  async function removeRate(row: StatutoryRateRow) {
    setFormError('');
    if (!window.confirm(`Remove the ${row.code} ${row.payer} rate starting ${row.effectiveFrom}?`)) return;
    const res = await apiClient.delete<StatutoryRateRow>(`/api/admin/statutory-rates/${row.id}`);
    if (res.success) load();
    else setFormError(res.error || 'Could not remove that rate.');
  }

  if (!capLoading && !has('catalogue.manage')) {
    return (
      <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="section-eyebrow" style={{ marginBottom: 8 }}>Statutory rates</div>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Maintaining PAYE, NSSF and SHIF needs the catalogue.manage capability. This session does not have it.
        </p>
      </div>
    );
  }

  return (
    <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Statutory rates</div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
        Shared across every farm. A payroll run uses the row effective on the period end and stores the result on the payslip. The rate cannot be edited afterwards; an end date can be changed, and a rate no payroll run has been calculated under can be removed. Housing levy is not calculated. No rate is filled in until you add one.
      </p>
      {capLoading && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)' }}>Checking access…</div>}
      {loadError && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 8 }}>{loadError}</div>}
      {rates === null && !loadError && !capLoading && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)' }}>Loading statutory rates…</div>}
      {rates !== null && rates.length === 0 && !loadError && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-dim)', marginBottom: 10 }}>
          No statutory rate is configured. A payroll run still saves, and the payslip says PAYE, NSSF and SHIF are not configured for that period end.
        </div>
      )}
      {rates !== null && rates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {rates.map((rate) => (
            <div key={rate.id} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 650 }}>{rate.code} · {rate.payer} · {describe(rate)}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                {rate.effectiveFrom} to {rate.effectiveTo ?? 'open'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <DateField value={endDates[rate.id] ?? ''} onChange={(value) => setEndDates((prev) => ({ ...prev, [rate.id]: value }))} aria-label={`End date for ${rate.code}`} />
                <Button type="button" size="lg" variant="outline" className="min-h-11 w-full" onClick={() => setEnd(rate)}>
                  {rate.effectiveTo == null ? 'Set end date' : 'Change end date'}
                </Button>
                <Button type="button" size="lg" variant="outline" className="min-h-11 w-full" onClick={() => removeRate(rate)}>
                  Remove rate
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {formError && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 8 }}>{formError}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Field label="Scheme">
          <Select value={code} onChange={setCode} placeholder="PAYE, NSSF or SHIF" aria-label="Scheme" className="min-h-11 h-11 w-full">
            <option value="PAYE">PAYE</option>
            <option value="NSSF">NSSF</option>
            <option value="SHIF">SHIF</option>
          </Select>
        </Field>
        <Field label="Who pays">
          <Select value={payer} onChange={setPayer} placeholder="Employee or employer" aria-label="Who pays" className="min-h-11 h-11 w-full">
            <option value="employee">Employee</option>
            <option value="employer">Employer</option>
          </Select>
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={setKind} placeholder="Percent, brackets or a fixed amount" aria-label="Kind of rate" className="min-h-11 h-11 w-full">
            <option value="percent">Percent</option>
            <option value="bracket">Brackets</option>
            <option value="fixed">Fixed amount</option>
          </Select>
        </Field>
        {kind === 'percent' && (
          <Field label="Percent">
            <Input className={inputClass} inputMode="decimal" placeholder="6" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </Field>
        )}
        {kind === 'fixed' && (
          <Field label="Fixed amount (stored in cents)">
            <Input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
        {kind === 'bracket' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bands.map((band, index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Field label={band.open ? 'Top band (no upper amount)' : 'Upper amount'}>
                  <Input className={inputClass} inputMode="decimal" disabled={band.open} value={band.upTo} onChange={(e) => {
                    const next = bands.slice();
                    next[index] = { ...band, upTo: e.target.value };
                    setBands(next);
                  }} />
                </Field>
                <Field label="Percent on this band">
                  <Input className={inputClass} inputMode="decimal" value={band.rate} onChange={(e) => {
                    const next = bands.slice();
                    next[index] = { ...band, rate: e.target.value };
                    setBands(next);
                  }} />
                </Field>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" className="size-5" checked={band.open} onChange={(e) => {
                    const next = bands.slice();
                    next[index] = { ...band, open: e.target.checked, upTo: e.target.checked ? '' : band.upTo };
                    setBands(next);
                  }} />
                  Open-ended top band
                </label>
              </div>
            ))}
            <Button type="button" size="lg" variant="outline" className="min-h-11 w-full" onClick={() => setBands([...bands, { upTo: '', rate: '', open: false }])}>
              Add a band
            </Button>
          </div>
        )}
        {(kind === 'percent' || kind === 'bracket') && (
          <>
            <Field label="Ceiling (optional)">
              <Input className={inputClass} inputMode="decimal" value={ceiling} onChange={(e) => setCeiling(e.target.value)} />
            </Field>
            <Field label="Floor (optional)">
              <Input className={inputClass} inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} />
            </Field>
          </>
        )}
        <Field label="First day">
          <DateField value={effectiveFrom} onChange={setEffectiveFrom} aria-label="First day this rate applies" />
        </Field>
        <Field label="Last day (optional)">
          <DateField value={effectiveTo} onChange={setEffectiveTo} aria-label="Last day this rate applies" />
        </Field>
        <Button type="button" size="lg" className="min-h-11 w-full" disabled={saving} onClick={addRate}>
          {saving ? 'Saving…' : 'Add statutory rate'}
        </Button>
      </div>
    </div>
  );
}
