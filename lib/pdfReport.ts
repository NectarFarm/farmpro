"use client";
import type {
  Flock, Sale, Expense, FeedRecord, VaccinationRecord,
  EggCollection, MortalityRecord, Customer, EmployeeSalary,
} from "./types";
import { formatDate, formatCurrency, calcMortalityRate } from "./utils";

export interface ReportData {
  flocks: Flock[];
  sales: Sale[];
  expenses: Expense[];
  feedRecords: FeedRecord[];
  vaccinationRecords: VaccinationRecord[];
  eggCollections: EggCollection[];
  mortalityRecords: MortalityRecord[];
  customers: Customer[];
  employeeSalaries: EmployeeSalary[];
  periodLabel: string;
  startDate: string;
  endDate: string;
  farmName?: string;
  enabledSections?: string[];
}

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  primary:  [46, 125, 50]   as [number,number,number],
  ltGreen:  [232, 245, 233] as [number,number,number],
  dark:     [27,  42,  27]  as [number,number,number],
  muted:    [100, 120, 100] as [number,number,number],
  red:      [183, 28,  28]  as [number,number,number],
  redBg:    [255, 205, 210] as [number,number,number],
  greenFg:  [27,  94,  32]  as [number,number,number],
  greenBg:  [200, 230, 201] as [number,number,number],
};

// ── Canvas chart helpers ───────────────────────────────────────────────────────
// SCALE: 1 canvas pixel = 1 point in jsPDF mm-space at 96 dpi
// pdfW × pdfH are the mm dimensions used in doc.addImage(...)
// canvas renders at 2× for sharpness

function makeCanvas(pdfW: number, pdfH: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cvs = document.createElement("canvas");
  const PX = 4; // pixels per mm (retina-ish)
  cvs.width  = Math.round(pdfW  * PX);
  cvs.height = Math.round(pdfH * PX);
  const ctx = cvs.getContext("2d")!;
  ctx.scale(PX, PX);
  return [cvs, ctx];
}

/** Full-width bar chart. pdfW/pdfH are the mm size in the PDF. */
function drawBarChart(
  labels: string[], values: number[],
  pdfW: number, pdfH: number,
  colors?: string[]
): HTMLCanvasElement {
  const [cvs, ctx] = makeCanvas(pdfW, pdfH);
  const n = labels.length;
  const PAD_L = 10, PAD_R = 8, PAD_TOP = 14, PAD_BOT = 14;
  const chartW = pdfW  - PAD_L - PAD_R;
  const chartH = pdfH  - PAD_TOP - PAD_BOT;
  const max = Math.max(...values, 1);

  // Background
  ctx.fillStyle = "#f9fbe7";
  ctx.fillRect(0, 0, pdfW, pdfH);

  // Grid lines
  ctx.strokeStyle = "#c8e6c9";
  ctx.lineWidth = 0.3;
  for (let i = 0; i <= 4; i++) {
    const gy = PAD_TOP + (i / 4) * chartH;
    ctx.beginPath(); ctx.moveTo(PAD_L, gy); ctx.lineTo(pdfW - PAD_R, gy); ctx.stroke();
  }

  const barW = (chartW / n) * 0.65;
  const gap   = (chartW / n) * 0.35;

  values.forEach((v, i) => {
    const bh  = (v / max) * chartH;
    const bx  = PAD_L + i * (chartW / n) + gap / 2;
    const by  = PAD_TOP + chartH - bh;
    const col = colors?.[i] ?? (i % 2 === 0 ? "#2e7d32" : "#558b2f");

    // Bar
    ctx.fillStyle = col;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, barW, bh, 1.5);
    else ctx.rect(bx, by, barW, bh);
    ctx.fill();

    // Value label ABOVE bar — inside canvas top padding
    if (v > 0) {
      ctx.fillStyle = "#1b5e20";
      ctx.font = "bold 6px sans-serif";
      ctx.textAlign = "center";
      const label = v >= 100000
        ? `${(v/1000).toFixed(0)}k`
        : v >= 1000 ? `${(v/1000).toFixed(1)}k` : String(Math.round(v));
      ctx.fillText(label, bx + barW / 2, Math.max(PAD_TOP - 2, by - 1));
    }

    // X axis label
    ctx.fillStyle = "#555";
    ctx.font = "5px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], bx + barW / 2, pdfH - 3);
  });

  return cvs;
}

/** Full-width line chart */
function drawLineChart(
  labels: string[],
  datasets: { values: number[]; color: string; label?: string }[],
  pdfW: number, pdfH: number
): HTMLCanvasElement {
  const [cvs, ctx] = makeCanvas(pdfW, pdfH);
  const PAD_L = 10, PAD_R = 8, PAD_TOP = 10, PAD_BOT = 14;
  const chartW = pdfW  - PAD_L - PAD_R;
  const chartH = pdfH  - PAD_TOP - PAD_BOT;
  const allVals = datasets.flatMap(d => d.values);
  const max = Math.max(...allVals, 1);

  ctx.fillStyle = "#f9fbe7"; ctx.fillRect(0, 0, pdfW, pdfH);

  // Grid
  ctx.strokeStyle = "#c8e6c9"; ctx.lineWidth = 0.3;
  for (let i = 0; i <= 4; i++) {
    const gy = PAD_TOP + (i / 4) * chartH;
    ctx.beginPath(); ctx.moveTo(PAD_L, gy); ctx.lineTo(pdfW - PAD_R, gy); ctx.stroke();
  }

  // Lines
  datasets.forEach(ds => {
    if (!ds.values.length) return;
    const step = chartW / Math.max(ds.values.length - 1, 1);
    ctx.strokeStyle = ds.color; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ds.values.forEach((v, i) => {
      const x = PAD_L + i * step;
      const y = PAD_TOP + (1 - v / max) * chartH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Dots at each point
    ctx.fillStyle = ds.color;
    ds.values.forEach((v, i) => {
      if (ds.values.length > 30 && i % 5 !== 0) return; // skip dense points
      const x = PAD_L + i * step;
      const y = PAD_TOP + (1 - v / max) * chartH;
      ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
    });
  });

  // X labels — only show a few to avoid overlap
  const step = chartW / Math.max(labels.length - 1, 1);
  const showEvery = Math.ceil(labels.length / 8);
  ctx.fillStyle = "#666"; ctx.font = "5px sans-serif"; ctx.textAlign = "center";
  labels.forEach((l, i) => {
    if (i % showEvery !== 0 && i !== labels.length - 1) return;
    ctx.fillText(l, PAD_L + i * step, pdfH - 3);
  });

  return cvs;
}

// ── Section header ─────────────────────────────────────────────────────────────
function sectionHeader(doc: import("jspdf").jsPDF, title: string, y: number, W: number) {
  doc.setFillColor(...C.ltGreen);
  doc.roundedRect(14, y - 4, W - 28, 11, 2, 2, "F");
  doc.setDrawColor(...C.primary); doc.setLineWidth(0.6);
  doc.line(14, y - 4, 14, y + 7);
  doc.setFontSize(10); doc.setFont("helvetica", "bold"); doc.setTextColor(...C.primary);
  doc.text(title, 18, y + 3.5);
  doc.setFont("helvetica", "normal"); doc.setTextColor(...C.dark);
}

// ── Chart embed helper ─────────────────────────────────────────────────────────
// pdfW, pdfH: size in mm inside the PDF
function embedChart(
  doc: import("jspdf").jsPDF,
  canvas: HTMLCanvasElement,
  x: number, y: number,
  pdfW: number, pdfH: number
) {
  // Thin border box
  doc.setDrawColor(...C.ltGreen); doc.setLineWidth(0.3);
  doc.roundedRect(x - 1, y - 1, pdfW + 2, pdfH + 2, 1, 1, "S");
  doc.addImage(canvas.toDataURL("image/png"), "PNG", x, y, pdfW, pdfH);
}

// ── Main export ────────────────────────────────────────────────────────────────
export async function generateFarmReport(data: ReportData): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc  = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W    = doc.internal.pageSize.getWidth();   // 210 mm
  const CNTW = W - 28;                             // 182 mm content width
  const CHRT_H = 50;                               // standard chart height mm

  const enabled = new Set(
    data.enabledSections ?? ["pnl","opsCost","salaries","flocks","eggs","vaccination","customers","expenses","sales"]
  );

  let y = 0;
  const inRange = (d: string) => {
    const dt = new Date(d);
    return dt >= new Date(data.startDate) && dt <= new Date(data.endDate);
  };

  function newPage()    { doc.addPage(); y = 20; pageFooter(); }
  function checkY(n=20) { if (y + n > 272) newPage(); }
  function pageFooter() {
    const pg = (doc.internal as any).getNumberOfPages();
    doc.setFontSize(7.5); doc.setTextColor(...C.muted);
    doc.text(`FarmPro · ${data.farmName ?? "Poultry Farm"} · Page ${pg}`, W / 2, 291, { align: "center" });
  }

  // ── Cover ──────────────────────────────────────────────────────────────────
  doc.setFillColor(...C.primary); doc.rect(0, 0, W, 44, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22); doc.setFont("helvetica", "bold");
  doc.text(data.farmName ?? "FarmPro", 14, 18);
  doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text("Poultry Farm Management Report", 14, 28);
  doc.setFontSize(9);
  doc.text(`Period: ${data.periodLabel}  ·  Generated: ${new Date().toLocaleDateString("en-KE")}`, 14, 37);
  y = 54;

  // ── P&L ───────────────────────────────────────────────────────────────────
  if (enabled.has("pnl")) {
    checkY(30); sectionHeader(doc, "Profit & Loss Statement", y, W); y += 12;

    const revenue  = data.sales.filter(s => inRange(s.date)).reduce((a,s) => a + s.totalAmount, 0);
    const expCost  = data.expenses.filter(e => inRange(e.date)).reduce((a,e) => a + e.amount, 0);
    const feedCost = data.feedRecords.filter(r => inRange(r.date)).reduce((a,r) => a + r.totalCost, 0);
    const vacCost  = data.vaccinationRecords.filter(r => inRange(r.scheduledDate) && !!r.completedDate).reduce((a,r) => a + r.cost, 0);
    const totalExp = expCost + feedCost + vacCost;
    const net      = revenue - totalExp;

    const rows = [
      ["Total Revenue",      formatCurrency(revenue), ""],
      ["Feed Costs",         formatCurrency(feedCost), totalExp > 0 ? `${((feedCost/totalExp)*100).toFixed(1)}%` : "—"],
      ["Vaccination Costs",  formatCurrency(vacCost),  totalExp > 0 ? `${((vacCost/totalExp)*100).toFixed(1)}%`  : "—"],
      ["Other Expenses",     formatCurrency(expCost),  totalExp > 0 ? `${((expCost/totalExp)*100).toFixed(1)}%`  : "—"],
      ["Total Expenses",     formatCurrency(totalExp), "100%"],
      [net >= 0 ? "NET PROFIT" : "NET LOSS", formatCurrency(Math.abs(net)), ""],
    ];

    autoTable(doc, {
      startY: y,
      head: [["Item", "Amount", "% of Expenses"]],
      body: rows,
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255,255,255], fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
      didParseCell: d => {
        if (d.row.index === rows.length - 1) {
          d.cell.styles.fontStyle    = "bold";
          d.cell.styles.textColor    = net >= 0 ? C.greenFg : C.red;
          d.cell.styles.fillColor    = net >= 0 ? C.greenBg : C.redBg;
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Full-width P&L bar chart
    try {
      checkY(CHRT_H + 8);
      const canvas = drawBarChart(
        ["Revenue", "Expenses", net >= 0 ? "Profit" : "Loss"],
        [Math.round(revenue), Math.round(totalExp), Math.round(Math.abs(net))],
        CNTW, CHRT_H,
        ["#2e7d32", "#c62828", net >= 0 ? "#388e3c" : "#d32f2f"]
      );
      embedChart(doc, canvas, 14, y, CNTW, CHRT_H);
      y += CHRT_H + 6;
    } catch (_) { /* canvas not available */ }
  }

  // ── Cost of Operations ─────────────────────────────────────────────────────
  if (enabled.has("opsCost")) {
    checkY(30); sectionHeader(doc, "Cost of Operations", y, W); y += 12;

    const catMap: Record<string, number> = {};
    data.expenses.filter(e => inRange(e.date)).forEach(e => { catMap[e.category] = (catMap[e.category] ?? 0) + e.amount; });
    data.feedRecords.filter(r => inRange(r.date)).forEach(r => { catMap["feed"] = (catMap["feed"] ?? 0) + r.totalCost; });
    data.employeeSalaries.forEach(sal => { catMap["labour"] = (catMap["labour"] ?? 0) + sal.amount; });
    const totalOps = Object.values(catMap).reduce((a,v) => a+v, 0);

    const opsRows = Object.entries(catMap).map(([k,v]) => [
      k.charAt(0).toUpperCase() + k.slice(1),
      formatCurrency(v),
      totalOps > 0 ? `${((v/totalOps)*100).toFixed(1)}%` : "—",
    ]);

    autoTable(doc, {
      startY: y,
      head: [["Category", "Amount", "% Share"]],
      body: opsRows.length ? opsRows : [["No data","—","—"]],
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255,255,255], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Full-width ops bar chart
    try {
      if (opsRows.length > 0) {
        checkY(CHRT_H + 8);
        const cats   = Object.keys(catMap);
        const vals   = Object.values(catMap).map(Math.round);
        const cols   = ["#2e7d32","#558b2f","#33691e","#1b5e20","#c62828","#ef6c00","#795548"];
        const canvas = drawBarChart(cats.map(k => k.slice(0,7)), vals, CNTW, CHRT_H, cols);
        embedChart(doc, canvas, 14, y, CNTW, CHRT_H);
        y += CHRT_H + 6;
      }
    } catch (_) {}
  }

  // ── Salary Expenses ────────────────────────────────────────────────────────
  if (enabled.has("salaries") && data.employeeSalaries.length > 0) {
    checkY(30); sectionHeader(doc, "Employee Salary Schedule", y, W); y += 12;

    const salRows = data.employeeSalaries.map(s => [
      s.employeeName, formatCurrency(s.amount), `${s.payDayOfMonth}th`, s.notes ?? "—",
    ]);
    const total = data.employeeSalaries.reduce((a,s) => a+s.amount, 0);
    salRows.push(["TOTAL", formatCurrency(total), "", ""]);

    autoTable(doc, {
      startY: y,
      head: [["Employee", "Monthly Salary", "Pay Day", "Notes"]],
      body: salRows,
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255,255,255], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
      didParseCell: d => {
        if (d.row.index === salRows.length - 1) {
          d.cell.styles.fontStyle = "bold"; d.cell.styles.fillColor = C.ltGreen;
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── Flock Performance ──────────────────────────────────────────────────────
  if (enabled.has("flocks")) {
    checkY(30); sectionHeader(doc, "Flock Performance", y, W); y += 12;

    const flockRows = data.flocks.map(f => {
      const deaths  = data.mortalityRecords.filter(m => m.flockId === f.id).reduce((a,m) => a+m.count, 0);
      const eggs    = data.eggCollections.filter(e => e.flockId === f.id).reduce((a,e) => a+e.count, 0);
      const feedKg  = data.feedRecords.filter(r => r.flockId === f.id).reduce((a,r) => a+r.quantityKg, 0);
      return [
        f.name, f.stage.toUpperCase(),
        `${f.currentCount}/${f.initialCount}`,
        `${calcMortalityRate(f.initialCount, deaths).toFixed(1)}%`,
        eggs.toLocaleString(),
        `${feedKg.toFixed(0)} kg`,
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [["Flock","Stage","Birds","Mortality%","Total Eggs","Feed Used"]],
      body: flockRows.length ? flockRows : [["No flocks","","","","",""]],
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255,255,255], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      didParseCell: d => {
        if (d.column.index === 3 && d.section === "body" && parseFloat(d.cell.text[0]) > 5)
          d.cell.styles.textColor = C.red;
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── Egg Production ─────────────────────────────────────────────────────────
  if (enabled.has("eggs")) {
    checkY(30); sectionHeader(doc, "Egg Production Summary", y, W); y += 12;

    const periodEggs = data.eggCollections.filter(e => inRange(e.date));
    const total  = periodEggs.reduce((a,e) => a+e.count, 0);
    const days   = new Set(periodEggs.map(e => e.date)).size;
    const avg    = days > 0 ? (total / days).toFixed(0) : "0";
    const eggRev = data.sales.filter(s => inRange(s.date) && s.product === "eggs").reduce((a,s) => a+s.totalAmount, 0);

    doc.setFontSize(9); doc.setTextColor(...C.dark);
    const bullets = [
      `Total Eggs Collected: ${total.toLocaleString()}`,
      `Average Daily Production: ${avg} eggs/day`,
      `Egg Revenue (period): ${formatCurrency(eggRev)}`,
      `Active Collection Days: ${days}`,
    ];
    bullets.forEach(b => { doc.text("• " + b, 16, y); y += 6; });
    y += 2;

    // Build 30-day daily data correctly
    try {
      const dayMap: Record<string, number> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        dayMap[d.toISOString().split("T")[0]] = 0;
      }
      periodEggs.forEach(e => { if (dayMap[e.date] !== undefined) dayMap[e.date] += e.count; });

      const allKeys  = Object.keys(dayMap);
      const allVals  = allKeys.map(k => dayMap[k]);
      // Show every 5th label on x-axis
      const xLabels  = allKeys.map((k,i) => i % 5 === 0 ? k.slice(5) : "");

      checkY(CHRT_H + 8);
      const canvas = drawLineChart(
        xLabels, [{ values: allVals, color: "#2e7d32", label: "Eggs" }],
        CNTW, CHRT_H
      );
      embedChart(doc, canvas, 14, y, CNTW, CHRT_H);
      y += CHRT_H + 6;
    } catch (_) {}
  }

  // ── Vaccination Schedule ───────────────────────────────────────────────────
  if (enabled.has("vaccination")) {
    checkY(30); sectionHeader(doc, "Vaccination Schedule", y, W); y += 12;

    const allVacc = data.vaccinationRecords.map(v => {
      const flock   = data.flocks.find(f => f.id === v.flockId);
      const overdue = !v.completedDate && new Date(v.scheduledDate) < new Date();
      const status  = v.completedDate ? "Done ✓" : overdue ? "OVERDUE" : "Scheduled";
      return [
        flock?.name ?? "Unknown", v.vaccineName,
        formatDate(v.scheduledDate),
        v.completedDate ? formatDate(v.completedDate) : "—",
        status,
        formatCurrency(v.cost),
      ];
    }).sort((a,b) => a[4] === "OVERDUE" ? -1 : 1);

    autoTable(doc, {
      startY: y,
      head: [["Flock","Vaccine","Scheduled","Completed","Status","Cost"]],
      body: allVacc.length ? allVacc : [["No records","","","","",""]],
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255,255,255], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
      didParseCell: d => {
        if (d.column.index === 4 && d.section === "body") {
          if (d.cell.text[0] === "OVERDUE")      { d.cell.styles.textColor = C.red;     d.cell.styles.fontStyle = "bold"; }
          else if (d.cell.text[0].startsWith("Done")) d.cell.styles.textColor = C.greenFg;
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── Top Customers ──────────────────────────────────────────────────────────
  if (enabled.has("customers")) {
    checkY(30); sectionHeader(doc, "Top Customers by Revenue", y, W); y += 12;

    const revMap: Record<string,number> = {};
    data.sales.filter(s => inRange(s.date)).forEach(s => {
      revMap[s.customerId] = (revMap[s.customerId] ?? 0) + s.totalAmount;
    });
    const topRows = Object.entries(revMap)
      .sort((a,b) => b[1]-a[1]).slice(0,10)
      .map(([id,rev],i) => {
        const c = data.customers.find(cu => cu.id === id);
        const orders = data.sales.filter(s => s.customerId === id && inRange(s.date)).length;
        return [`${i+1}`, c?.name ?? "?", c?.type ?? "—", orders.toString(), formatCurrency(rev)];
      });

    autoTable(doc, {
      startY: y,
      head: [["#","Customer","Type","Orders","Revenue"]],
      body: topRows.length ? topRows : [["—","No data","","",""]],
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255,255,255], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 4: { halign: "right", fontStyle: "bold" } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;

    // Customer revenue bar chart
    try {
      if (topRows.length > 0) {
        checkY(CHRT_H + 8);
        const cLabels = topRows.map(r => r[1].slice(0,8));
        const cVals   = Object.values(revMap).sort((a,b) => b-a).slice(0,topRows.length).map(Math.round);
        const canvas  = drawBarChart(cLabels, cVals, CNTW, CHRT_H);
        embedChart(doc, canvas, 14, y, CNTW, CHRT_H);
        y += CHRT_H + 6;
      }
    } catch (_) {}
  }

  // ── Expense Breakdown ──────────────────────────────────────────────────────
  if (enabled.has("expenses")) {
    checkY(30); sectionHeader(doc, "Expense Breakdown", y, W); y += 12;

    const catMap2: Record<string,number> = {};
    data.expenses.filter(e => inRange(e.date)).forEach(e => { catMap2[e.category] = (catMap2[e.category] ?? 0) + e.amount; });
    data.feedRecords.filter(r => inRange(r.date)).forEach(r => { catMap2["feed"] = (catMap2["feed"] ?? 0) + r.totalCost; });
    const tot2 = Object.values(catMap2).reduce((a,v) => a+v, 0);

    const expRows = Object.entries(catMap2).map(([k,v]) => [
      k.charAt(0).toUpperCase()+k.slice(1),
      formatCurrency(v),
      tot2 > 0 ? `${((v/tot2)*100).toFixed(1)}%` : "—",
    ]);

    autoTable(doc, {
      startY: y,
      head: [["Category","Amount","% Total"]],
      body: expRows.length ? expRows : [["No expenses","—","—"]],
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255,255,255], fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── Sales Records ──────────────────────────────────────────────────────────
  if (enabled.has("sales")) {
    checkY(30); sectionHeader(doc, "Sales Records (last 30)", y, W); y += 12;

    const sRows = data.sales
      .filter(s => inRange(s.date))
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 30)
      .map(s => {
        const c = data.customers.find(cu => cu.id === s.customerId);
        return [
          formatDate(s.date), c?.name ?? "—",
          s.product.toUpperCase(),
          s.quantity.toLocaleString(),
          formatCurrency(s.pricePerUnit),
          formatCurrency(s.totalAmount),
        ];
      });

    autoTable(doc, {
      startY: y,
      head: [["Date","Customer","Product","Qty","Price/Unit","Total"]],
      body: sRows.length ? sRows : [["No sales","","","","",""]],
      theme: "striped",
      headStyles: { fillColor: C.primary, textColor: [255,255,255], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 5: { halign: "right", fontStyle: "bold" } },
      margin: { left: 14, right: 14 },
    });
  }

  pageFooter();
  const fname = `FarmPro_${data.periodLabel.replace(/\s+/g,"_")}_${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(fname);
}
