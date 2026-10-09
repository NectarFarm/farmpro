'use client'
// Lines that hold or block a posting. Nothing is invented when the list is empty.
import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/request'
import { formatMoney, parseMoneyToCents } from '@/lib/money'
import { Button } from '@/components/ui-kit/button'
import { Field } from '@/components/ui-kit/field'
import { Input } from '@/components/ui-kit/input'
import { Select } from '@/components/ui-kit/select'
interface PolicyRow {
  id: string
  kind: string
  accountCode: string | null
  farmId: string | null
  thresholdCents: number
  effect: string
}

interface AccountRow {
  code: string
  name: string
}

export function PostingPoliciesPanel({ tenantId, farms, canEdit }: {
  tenantId: string
  farms: { id: string; name: string }[]
  canEdit: boolean
}) {
  const [rows, setRows] = useState<PolicyRow[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null)
  const [accountsError, setAccountsError] = useState('')
  const [kind, setKind] = useState('')
  const [accountCode, setAccountCode] = useState('')
  const [farmId, setFarmId] = useState('')
  const [amount, setAmount] = useState('')
  const [effect, setEffect] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function load() {
    apiClient.get<PolicyRow[]>(`/api/posting-policies?tenantId=${tenantId}`).then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setRows(res.data)
        setLoadError('')
      } else {
        setRows([])
        setLoadError(res.error || 'The approval lines could not be loaded.')
      }
    })
  }

  useEffect(() => {
    apiClient.get<PolicyRow[]>(`/api/posting-policies?tenantId=${tenantId}`).then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setRows(res.data)
        setLoadError('')
      } else {
        setRows([])
        setLoadError(res.error || 'The approval lines could not be loaded.')
      }
    })
  }, [tenantId])

  useEffect(() => {
    apiClient.get<AccountRow[]>('/api/gl/accounts').then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setAccounts(res.data)
        setAccountsError('')
      } else {
        setAccounts([])
        setAccountsError(res.error || 'The chart of accounts could not be loaded.')
      }
    })
  }, [])

  function describe(row: PolicyRow): string {
    const line = formatMoney(row.thresholdCents)
    const happens = row.effect === 'block' ? 'is blocked' : 'waits for approval'
    if (row.kind === 'amount') return `Any posting above ${line} ${happens}.`
    if (row.kind === 'account') return `Account ${row.accountCode ?? '—'} above ${line} ${happens}.`
    if (row.kind === 'farm') {
      const name = farms.find((farm) => farm.id === row.farmId)?.name
      return `${name ? name : `Farm ${row.farmId ?? '—'}`} above ${line} ${happens}.`
    }
    if (row.kind === 'variance') return `A stock count above ${line} ${happens}.`
    return 'This line could not be read.'
  }

  async function add() {
    setError('')
    if (!kind) { setError('Choose what this line applies to.'); return }
    if (kind === 'account' && !accountCode) { setError('An account threshold needs an account.'); return }
    if (kind === 'farm' && !farmId) { setError('A farm threshold needs a farm.'); return }
    const thresholdCents = parseMoneyToCents(amount)
    if (thresholdCents === null || thresholdCents < 0) { setError('Enter the amount this line starts at.'); return }
    if (!effect) { setError('Choose what happens above the line.'); return }
    setBusy(true)
    const res = await apiClient.post('/api/posting-policies', {
      tenantId,
      kind,
      effect,
      thresholdCents,
      ...(kind === 'account' ? { accountCode } : {}),
      ...(kind === 'farm' ? { farmId } : {}),
    })
    setBusy(false)
    if (!res.success) { setError(res.error || 'Could not add that line.'); return }
    setAmount('')
    load()
  }

  async function remove(id: string) {
    setBusy(true)
    setError('')
    const res = await apiClient.delete(`/api/posting-policies/${id}?tenantId=${tenantId}`)
    setBusy(false)
    if (!res.success) { setError(res.error || 'Could not remove that line.'); return }
    load()
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-sm font-medium">Posting lines</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">A sale, purchase or expense above a line waits, or is refused, before it enters the books. A stock-count line is separate from the box above.</p>
      {rows === null && !loadError && <p className="mt-3 text-xs text-muted">Loading posting lines…</p>}
      {loadError && <p className="mt-3 text-xs text-danger">{loadError}</p>}
      {rows !== null && rows.length === 0 && !loadError && (
        <p className="mt-3 text-xs leading-relaxed text-muted">No threshold is set. A sale, purchase or expense posts immediately.</p>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm">{describe(row)}</p>
              <Button type="button" size="lg" variant="outline" className="shrink-0" disabled={!canEdit || busy} onClick={() => remove(row.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-3">
        <Field label="Applies to">
          <Select value={kind} onChange={(value) => setKind(value)} disabled={!canEdit} placeholder="Choose what this line applies to" aria-label="What this line applies to">
            <option value="">Choose what this line applies to</option>
            <option value="amount">Any posting</option>
            <option value="account">One account</option>
            <option value="farm">One farm</option>
            <option value="variance">A stock count</option>
          </Select>
        </Field>
        {kind === 'account' && (
          <Field label="Account">
            {accounts === null && !accountsError && <p className="text-xs text-muted">Loading the chart of accounts…</p>}
            {accountsError && <p className="text-xs text-danger">{accountsError}</p>}
            {accounts !== null && accounts.length === 0 && !accountsError && (
              <p className="text-xs text-muted">No account is on the chart.</p>
            )}
            {accounts !== null && accounts.length > 0 && (
              <Select value={accountCode} onChange={setAccountCode} disabled={!canEdit} placeholder="Choose an account" aria-label="Account">
                <option value="">Choose an account</option>
                {accounts.map((account) => <option key={account.code} value={account.code}>{account.code} {account.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        {kind === 'farm' && (
          <Field label="Farm">
            {farms.length === 0 ? (
              <p className="text-xs text-muted">This business has no farm yet.</p>
            ) : (
              <Select value={farmId} onChange={setFarmId} disabled={!canEdit} placeholder="Choose a farm" aria-label="Farm">
                <option value="">Choose a farm</option>
                {farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Above">
          <Input inputMode="decimal" className="min-h-11 h-11" value={amount} disabled={!canEdit} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-label="Threshold amount" />
        </Field>
        <Field label="Then">
          <Select value={effect} onChange={(value) => setEffect(value)} disabled={!canEdit} placeholder="Choose what happens" aria-label="What happens above the line">
            <option value="">Choose what happens</option>
            <option value="pending">Wait for approval</option>
            <option value="block">Block the posting</option>
          </Select>
        </Field>
        {error && <p className="text-xs text-danger">{error}</p>}
        {!canEdit && <p className="text-xs text-subtle">Only the farm owner can change this.</p>}
        <Button type="button" size="lg" className="w-full justify-center" disabled={!canEdit || busy} onClick={add}>{busy ? 'Saving…' : 'Add line'}</Button>
      </div>
    </div>
  )
}
