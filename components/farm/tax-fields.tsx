'use client';
// Tax code, inclusive/exclusive, and the gross / tax / net preview shared by
// Record sale, Record purchase, and Record expense (issue #419). The server
// recomputes. This component does not invent a code or a rate.
import React, { useEffect, useState } from 'react';
import { apiClient } from '@/lib/request';
import { formatMoney } from '@/lib/money';
import {
  formatRatePercent, previewTax, TAX_CODE,
  type RateWindow, type TaxPreview,
} from '@/lib/tax';
import { Field } from '@/components/ui-kit/field';
import { Select } from '@/components/ui-kit/select';
import { Button } from '@/components/ui-kit/button';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Receipt } from './icons';

export interface TaxCatalogue {
  codes: { code: string; name: string }[];
  rates: RateWindow[];
}

export function useTaxCatalogue(tenantId: string) {
  const [catalogue, setCatalogue] = useState<TaxCatalogue | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiClient.get<TaxCatalogue>(`/api/tax-codes?tenantId=${encodeURIComponent(tenantId)}`).then((res) => {
      if (cancelled) return;
      if (res.success) {
        setCatalogue(res.data);
        setError('');
      } else {
        setCatalogue(null);
        setError('Tax codes could not be loaded. This document will be saved with no tax code.');
      }
    });
    return () => { cancelled = true; };
  }, [tenantId]);

  return { catalogue, error };
}

export function TaxFields({
  catalogue,
  catalogueError,
  taxCode,
  onTaxCode,
  inclusive,
  onInclusive,
  baseCents,
  postingDay,
  figures,
}: {
  catalogue: TaxCatalogue | null;
  catalogueError: string;
  taxCode: string;
  onTaxCode: (code: string) => void;
  inclusive: boolean;
  onInclusive: (inclusive: boolean) => void;
  baseCents: number | null;
  postingDay: string | null;
  // A receipt taxes each line, then adds the results. Passing the sum as
  // baseCents would show a different cent. When set, these are the figures.
  figures?: { grossCents: number; taxCents: number; netCents: number; rateBps: number | null } | null;
}) {
  if (catalogueError) {
    return (
      <EmptyState
        icon={<Receipt className="size-5" aria-hidden="true" />}
        title="Tax codes unavailable"
        body={catalogueError}
      />
    );
  }

  if (catalogue === null) {
    return <p className="text-xs text-muted">Loading tax codes…</p>;
  }

  const preview: TaxPreview = previewTax({
    code: taxCode,
    baseCents,
    inclusive,
    rates: catalogue.rates,
    day: postingDay,
  });
  const vatable = taxCode === TAX_CODE.VATABLE;

  return (
    <div className="mb-3 flex w-full min-w-0 flex-col gap-2">
      <Field label="Tax code">
        <Select className="h-11 min-h-11 w-full" value={taxCode} onChange={onTaxCode} aria-label="Tax code">
          <option value="">No tax code</option>
          {catalogue.codes.map((code) => (
            <option key={code.code} value={code.code}>{code.name}</option>
          ))}
        </Select>
      </Field>
      {catalogue.codes.length === 0 && (
        <p className="text-xs text-muted">No tax codes are in the catalogue. This document will be saved with no tax code.</p>
      )}
      {vatable && (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="lg" className="min-h-11 w-full" variant={inclusive ? 'outline' : 'default'} onClick={() => onInclusive(false)}>
            Excludes VAT
          </Button>
          <Button type="button" size="lg" className="min-h-11 w-full" variant={inclusive ? 'default' : 'outline'} onClick={() => onInclusive(true)}>
            Includes VAT
          </Button>
        </div>
      )}
      {taxCode && taxCode !== TAX_CODE.VATABLE && (
        <p className="text-xs text-muted">This code computes no tax. Whether the amount includes VAT does not apply.</p>
      )}
      {preview.status === 'need-amount' && (
        <p className="text-xs text-muted">Enter the amount to see the VAT.</p>
      )}
      {preview.status === 'need-date' && (
        <p className="text-xs text-danger">{preview.message}</p>
      )}
      {preview.status === 'refused' && (
        <p className="text-xs text-danger">{preview.message}</p>
      )}
      {preview.status === 'ok' && (
        <div className="flex flex-col gap-1 rounded-lg bg-primary-soft px-3 py-2.5 text-sm">
          {(figures?.rateBps ?? preview.rateBps) != null && (
            <p className="text-xs text-muted">Rate {formatRatePercent((figures?.rateBps ?? preview.rateBps) as number)} on this date.</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Gross</span>
            <span className="font-medium">{formatMoney(figures?.grossCents ?? preview.grossCents)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Tax</span>
            <span className="font-medium">{formatMoney(figures?.taxCents ?? preview.taxCents)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Net</span>
            <span className="font-medium">{formatMoney(figures?.netCents ?? preview.netCents)}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">The settled amount is the gross. That is what is stored.</p>
        </div>
      )}
    </div>
  );
}
