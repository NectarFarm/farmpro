// ── Client-side report export (issue #263 tasks 5-6) ────────────────────────
// Builds CSV and PDF exports from any report endpoint's `{ title, columns,
// rows, meta }` JSON shape (see lib/report-types.ts / lib/reports.ts) — no
// backend change needed for the export format itself; every /api/reports/*
// route already returns this shape. Same "create an <a> with a Blob URL and
// click it" convention components/farm/finance.tsx's exportGLCsv and
// components/farm/tasks.tsx's exportTaskCSV already use for CSV.
'use client';
import type { ReportPayload } from './report-types'

function csvCell(value: string | number): string {
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function reportToCsv(report: ReportPayload): string {
  const lines = [report.columns.map(csvCell).join(',')]
  for (const row of report.rows) {
    lines.push(row.map(csvCell).join(','))
  }
  return lines.join('\n')
}

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function downloadReportCsv(report: ReportPayload, filename: string) {
  triggerDownload(new Blob([reportToCsv(report)], { type: 'text/csv' }), filename)
}

// PDF export via jspdf + jspdf-autotable (issue #263 task 6 — added as real
// dependencies, not currently installed). Dynamically imported so the ~350KB
// jspdf bundle only loads when a user actually exports a PDF, not on every
// page that renders the Reports screen.
export async function downloadReportPdf(report: ReportPayload, filename: string) {
  const { default: jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF()
  doc.setFontSize(14)
  doc.text(report.title, 14, 16)

  const metaLines = Object.entries(report.meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
  doc.setFontSize(9)
  let y = 24
  for (const line of metaLines) {
    doc.text(line, 14, y)
    y += 5
  }

  autoTable(doc, {
    startY: y + 2,
    head: [report.columns],
    body: report.rows.map((r) => r.map(String)),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [74, 124, 89] },
  })

  doc.save(filename)
}
