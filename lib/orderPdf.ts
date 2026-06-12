"use client";
import type { OrderRequest, Customer } from "./types";
import { formatDate, formatCurrency } from "./utils";

export async function generateOrderPdf(
  orders: OrderRequest[],
  customers: Customer[],
  farmName = "FarmPro"
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const PRIMARY: [number, number, number] = [46, 125, 50];
  const MUTED:   [number, number, number] = [100, 120, 100];

  // ── Cover banner ───────────────────────────────────────────────────────────
  doc.setFillColor(...PRIMARY); doc.rect(0, 0, W, 38, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20); doc.setFont("helvetica", "bold"); doc.text(farmName, 14, 16);
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("Customer Order History", 14, 25);
  doc.setFontSize(8); doc.text(`Generated: ${new Date().toLocaleDateString("en-KE")}  ·  Total orders: ${orders.length}`, 14, 33);

  let y = 46;

  // ── Summary row ────────────────────────────────────────────────────────────
  const totalRev = orders.filter(r => r.status === "paid").reduce((s, r) => s + r.totalAmount, 0);
  const pending  = orders.filter(r => r.status === "pending").length;
  const paid     = orders.filter(r => r.status === "paid").length;

  doc.setFontSize(9); doc.setTextColor(30, 30, 30);
  doc.text(`Paid orders: ${paid}   Pending: ${pending}   Total Revenue: ${formatCurrency(totalRev)}`, 14, y);
  y += 8;

  // ── Per-customer sections ──────────────────────────────────────────────────
  const byCustomer: Record<string, OrderRequest[]> = {};
  orders.forEach(o => { byCustomer[o.customerId] = [...(byCustomer[o.customerId] ?? []), o]; });

  for (const [custId, custOrders] of Object.entries(byCustomer)) {
    const cust = customers.find(c => c.id === custId);
    const custTotal = custOrders.filter(r => r.status === "paid").reduce((s, r) => s + r.totalAmount, 0);

    if (y > 260) { doc.addPage(); y = 20; }

    // section header
    doc.setFillColor(232, 245, 233); doc.roundedRect(14, y - 3, W - 28, 10, 2, 2, "F");
    doc.setDrawColor(...PRIMARY); doc.setLineWidth(0.5); doc.line(14, y - 3, 14, y + 7);
    doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(...PRIMARY);
    doc.text(`${cust?.name ?? "Unknown"} · ${cust?.phone ?? ""}  —  paid: ${formatCurrency(custTotal)}`, 18, y + 3.5);
    doc.setFont("helvetica", "normal"); doc.setTextColor(30, 30, 30);
    y += 12;

    const rows = custOrders
      .sort((a, b) => new Date(b.requestedDate).getTime() - new Date(a.requestedDate).getTime())
      .map(o => [
        formatDate(o.requestedDate),
        `${o.quantity} ${o.product}`,
        formatCurrency(o.pricePerUnit),
        formatCurrency(o.totalAmount),
        o.status.toUpperCase(),
        o.deliveryLocation,
      ]);

    autoTable(doc, {
      startY: y,
      head: [["Date", "Product", "Unit Price", "Total", "Status", "Location"]],
      body: rows,
      theme: "striped",
      headStyles: { fillColor: PRIMARY, textColor: [255,255,255], fontSize: 7, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      columnStyles: { 3: { halign: "right", fontStyle: "bold" }, 4: { halign: "center" } },
      margin: { left: 14, right: 14 },
      didParseCell: (d) => {
        if (d.column.index === 4 && d.section === "body") {
          if (d.cell.text[0] === "PAID")     d.cell.styles.textColor = [27,94,32];
          if (d.cell.text[0] === "PENDING")  d.cell.styles.textColor = [120, 80, 0];
          if (d.cell.text[0] === "CANCELLED") d.cell.styles.textColor = [150,0,0];
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // footer
  const pages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(`FarmPro Order History · ${farmName} · Page ${i}/${pages}`, W / 2, 290, { align: "center" });
  }

  doc.save(`FarmPro_Orders_${new Date().toISOString().slice(0,10)}.pdf`);
}
