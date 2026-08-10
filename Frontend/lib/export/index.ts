'use client';
// Real file exports — CSV (native), PDF (jsPDF, lazy-loaded), Excel (.xls HTML).
export interface ReportData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  meta: Record<string, string | number>;
  // Optional images appended after the table in the PDF (e.g. test screenshots).
  images?: { caption?: string; dataUrl: string }[];
  // Optional PDF-only presentation extras — all optional so existing callers are unaffected.
  subtitle?: string;
  farmName?: string;
  // True when the LAST row of `rows` is a totals/summary row that should be
  // rendered as a visually distinct footer row in the PDF table.
  hasTotalsRow?: boolean;
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

// Number → "84,200" style thousands-separator string. Never applied to values
// that are already strings (e.g. "3%", "—") — only to genuine JS numbers, since
// this module has no idea whether a number is money, kg, or a count.
const fmtNum = (n: number) => n.toLocaleString('en-US');
const fmtCell = (v: string | number) => (typeof v === 'number' ? fmtNum(v) : v);

export async function downloadPDF(data: ReportData) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();

  // ── Letterhead band ──────────────────────────────────────────────────────
  doc.setFillColor(22, 101, 52);
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setFillColor(15, 71, 37);
  doc.rect(0, 28, pageW, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(data.farmName ?? 'IFMS', 14, 14);
  if (data.farmName) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(220, 236, 226);
    doc.text('Integrated Farm Management System', 14, 20);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(data.title.toUpperCase(), pageW - 14, 12, { align: 'right' });
  if (data.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(220, 236, 226);
    doc.text(data.subtitle, pageW - 14, 18, { align: 'right' });
  }

  // ── Meta strip: horizontal grid of key/value columns ────────────────────
  const metaEntries = Object.entries(data.meta);
  const metaTop = 38;
  const metaKeyY = metaTop, metaValY = metaTop + 6;
  if (metaEntries.length > 0) {
    const left = 14, right = pageW - 14;
    const colW = (right - left) / metaEntries.length;
    metaEntries.forEach(([k, v], i) => {
      const x = left + i * colW;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(107, 114, 128);
      doc.text(k.toUpperCase(), x, metaKeyY);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 24, 39);
      doc.text(String(v), x, metaValY);
    });
  }
  const ruleY = metaTop + 12;
  doc.setDrawColor(224, 224, 224);
  doc.line(14, ruleY, pageW - 14, ruleY);

  // ── Table ─────────────────────────────────────────────────────────────
  // A column is "numeric" when every cell in it (across all data rows,
  // including a totals row if present) is a JS number — detected from the
  // ORIGINAL rows, before formatting turns numbers into display strings.
  const numCols = new Set<number>();
  data.columns.forEach((_, c) => {
    if (data.rows.length > 0 && data.rows.every((r) => typeof r[c] === 'number')) numCols.add(c);
  });
  const columnStyles: Record<number, { halign: 'left' | 'right' }> = {};
  data.columns.forEach((_, i) => { columnStyles[i] = { halign: numCols.has(i) ? 'right' : 'left' }; });

  let body = data.rows.map((r) => r.map(fmtCell));
  let foot: (string | number)[][] | undefined;
  if (data.hasTotalsRow && body.length > 0) {
    foot = [body[body.length - 1]];
    body = body.slice(0, -1);
  }

  autoTable(doc, {
    startY: ruleY + 6,
    head: [data.columns],
    body,
    foot,
    theme: 'plain',
    styles: { fontSize: 8, lineColor: [230, 230, 230], lineWidth: 0.1 },
    headStyles: { fillColor: [22, 101, 52], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles,
    ...(foot
      ? {
          footStyles: {
            fillColor: [243, 244, 246],
            textColor: [17, 24, 39],
            fontStyle: 'bold',
            // jspdf-autotable's LineWidths type supports per-side widths, so the
            // green rule can be drawn on the top edge only (no faux "border" on
            // the other three sides).
            lineWidth: { top: 0.6, bottom: 0, left: 0, right: 0 },
            lineColor: [15, 71, 37],
          },
        }
      : {}),
  });

  embedImages(doc, data.images);

  // ── Footer on every page (run LAST — embedImages can add pages) ─────────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const fw = doc.internal.pageSize.getWidth();
    const fh = doc.internal.pageSize.getHeight();
    doc.setDrawColor(224, 224, 224);
    doc.line(14, fh - 16, fw - 14, fh - 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 130, 130);
    doc.text('Generated by IFMS · Confidential — for internal and authorized use only', 14, fh - 10);
    doc.text(`Page ${p} of ${pageCount}`, fw - 14, fh - 10, { align: 'right' });
  }

  doc.save(`${slug(data.title)}.pdf`);
}

// Append each image on its own page, aspect-preserved. Uses jsPDF's own image
// reader (getImageProperties) so it needs no DOM — and can be verified in Node.
// Exported for testing. `doc` is a jsPDF instance.
export function embedImages(doc: JsPdfLike, images: ReportData['images']) {
  for (const im of images ?? []) {
    if (!im.dataUrl || !im.dataUrl.startsWith('data:image/')) continue;
    try {
      const props = doc.getImageProperties(im.dataUrl); // { width, height, fileType }
      const fmt = (props.fileType || (im.dataUrl.includes('image/png') ? 'PNG' : 'JPEG')).toUpperCase();
      doc.addPage();
      let top = 16;
      if (im.caption) { doc.setFontSize(10); doc.setTextColor(60); doc.text(im.caption, 14, top); top += 6; }
      const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
      const scale = Math.min((pageW - 28) / props.width, (pageH - top - 14) / props.height);
      doc.addImage(im.dataUrl, fmt, 14, top, props.width * scale, props.height * scale);
    } catch { /* skip an unreadable image rather than fail the whole PDF */ }
  }
}

interface JsPdfLike {
  getImageProperties(d: string): { width: number; height: number; fileType?: string };
  addPage(): void;
  setFontSize(n: number): void;
  setTextColor(n: number): void;
  text(s: string, x: number, y: number): void;
  addImage(d: string, fmt: string, x: number, y: number, w: number, h: number): void;
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
}

export function exportReport(data: ReportData, fmt: 'PDF' | 'Excel' | 'CSV') {
  if (fmt === 'PDF') return downloadPDF(data);
  if (fmt === 'Excel') return downloadExcel(data);
  return downloadCSV(data);
}
