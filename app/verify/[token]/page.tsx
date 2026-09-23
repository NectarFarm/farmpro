'use client'
import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/request'

type Verification = { title: string; period: string; status: string; purpose: string; createdAt: string; attestedBy: string | null; attestedRole: string | null; attestedAt: string | null; hash: string; hashMatches: boolean }

export default function VerifyReportPage({ params }: { params: Promise<{ token: string }> }) {
  const [data, setData] = useState<Verification | null>(null); const [error, setError] = useState('')
  useEffect(() => { void params.then(({ token }) => apiClient.get<Verification>(`/api/verify/${encodeURIComponent(token)}`).then((r) => r.success ? setData(r.data) : setError(r.error || 'Document not found.'))) }, [params])
  return <main style={{ maxWidth: 680, margin: '0 auto', padding: '48px 20px', fontFamily: 'sans-serif' }}>
    <div style={{ fontSize: 12, letterSpacing: '.12em', color: '#4a7c59', fontWeight: 700 }}>IFMS DOCUMENT VERIFICATION</div>
    {error && <h1>Document cannot be verified</h1>}
    {data && <><h1 style={{ marginBottom: 4 }}>{data.hashMatches ? 'Verified document' : 'Verification failed'}</h1><p>{data.title}</p><dl>{[['Period', data.period], ['Status', data.status], ['Prepared for', data.purpose], ['Generated', new Date(data.createdAt).toLocaleString()], ['Attested by', data.attestedBy ? `${data.attestedBy}${data.attestedRole ? ` (${data.attestedRole})` : ''}` : 'Not attested'], ['Integrity', data.hashMatches ? 'Payload hash matches' : 'Payload hash mismatch']].map(([label, value]) => <div key={label} style={{ borderTop: '1px solid #ddd', padding: '12px 0' }}><dt style={{ color: '#666', fontSize: 12 }}>{label}</dt><dd style={{ margin: '4px 0 0', fontWeight: 600 }}>{value}</dd></div>)}</dl><p style={{ color: '#666', fontSize: 12, overflowWrap: 'anywhere' }}>SHA-256: {data.hash}</p></>}
  </main>
}
