'use client'
// The sentence on a money form. The server recomputes the same decision.
import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/request'
import { isPolicyEffect, isPolicyKind, type MoneyDecision, type PostingPolicy } from '@/lib/posting-policy'

export function usePostingPolicies(tenantId: string) {
  const [state, setState] = useState<{ status: 'loading' | 'failed' | 'ready'; policies: PostingPolicy[] }>({
    status: 'loading',
    policies: [],
  })
  useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, status: 'loading' }))
    apiClient.get<PostingPolicy[]>(`/api/posting-policies?tenantId=${tenantId}`).then((res) => {
      if (cancelled) return
      if (!res.success || !Array.isArray(res.data)) {
        setState({ status: 'failed', policies: [] })
        return
      }
      const policies = res.data.flatMap((row) => {
        if (!row || !isPolicyKind(row.kind) || !isPolicyEffect(row.effect) || typeof row.thresholdCents !== 'number') return []
        return [{
          kind: row.kind,
          accountCode: typeof row.accountCode === 'string' ? row.accountCode : null,
          farmId: typeof row.farmId === 'string' ? row.farmId : null,
          thresholdCents: row.thresholdCents,
          effect: row.effect,
        }]
      })
      setState({ status: 'ready', policies })
    })
    return () => { cancelled = true }
  }, [tenantId])
  return state
}

export function PostingLine({ status, decision }: { status: 'loading' | 'failed' | 'ready'; decision: MoneyDecision | null }) {
  if (status === 'loading') {
    return <p className="mb-2 text-xs leading-relaxed text-muted">Checking approval thresholds…</p>
  }
  if (status === 'failed') {
    return <p className="mb-2 text-xs leading-relaxed text-muted">The approval thresholds could not be loaded. The server decides whether this posts when you save.</p>
  }
  if (!decision) return null
  return <p className="mb-2 text-xs leading-relaxed text-fg">{decision.message}</p>
}
