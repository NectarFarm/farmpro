'use client';
// Real file exports — CSV (native), PDF (jsPDF, lazy-loaded), Excel (.xls HTML).
export interface ReportData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  meta: Record<string, string | number>;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function downloadCSV(data: ReportData) {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const metaLines = Object.entries(data.meta).map(([k, v]) => `${esc(k)},${esc(v)}`);
  const lines = [esc(data.title), ...metaLines, '', data.columns.map(esc).join(','), ...data.rows.map((r) => r.map(esc).join(','))];
  triggerDownload(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }), `${slug(data.title)}.csv`);
}

export function downloadExcel(data: ReportData) {
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = `<tr>${data.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = data.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  const html = `<html><head><meta charset="utf-8"></head><body><h3>${esc(data.title)}</h3><table border="1">${head}${body}</table></body></html>`;
  triggerDownload(new Blob([html], { type: 'application/vnd.ms-excel' }), `${slug(data.title)}.xls`);
}

export async function downloadPDF(data: ReportData) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.setTextColor(22, 101, 52);
  doc.text(data.title, 14, 18);
  doc.setFontSize(9);
  doc.setTextColor(120);
  let y = 25;
  for (const [k, v] of Object.entries(data.meta)) { doc.text(`${k}: ${v}`, 14, y); y += 5; }
  autoTable(doc, {
    startY: y + 2,
    head: [data.columns],
    body: data.rows.map((r) => r.map((c) => String(c))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [22, 101, 52] },
  });
  doc.save(`${slug(data.title)}.pdf`);
}

export function exportReport(data: ReportData, fmt: 'PDF' | 'Excel' | 'CSV') {
  if (fmt === 'PDF') return downloadPDF(data);
  if (fmt === 'Excel') return downloadExcel(data);
  return downloadCSV(data);
}
