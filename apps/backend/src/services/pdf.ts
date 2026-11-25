import PDFDocument from "pdfkit";
import type { Response } from "express";

const BLUE = "#0a5bd3";
const INK = "#0b1b33";
const MUTED = "#5b6b82";

export interface Letterhead { name: string; tagline: string; address: string; phone: string; email: string; gstin?: string | null }

/** Streams a branded A4 PDF to the response. `draw` writes the body. */
export function sendPdf(res: Response, filename: string, head: Letterhead, title: string, draw: (doc: PDFKit.PDFDocument) => void, inline = true) {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: title, Author: head.name } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.-]/g, "_")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 6).fill(BLUE);
  doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(20).text(head.name, 48, 30);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(head.tagline);
  doc.fontSize(8.5).text(head.address, 300, 32, { width: 247, align: "right" }).text(`${head.phone} · ${head.email}`, { width: 247, align: "right" });
  if (head.gstin) doc.text(`GSTIN: ${head.gstin}`, { width: 247, align: "right" });
  doc.moveTo(48, 92).lineTo(doc.page.width - 48, 92).strokeColor("#e4eaf3").stroke();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(title, 48, 106);
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(10).fillColor(INK);
  draw(doc);

  doc.fontSize(7.5).fillColor(MUTED).text(`Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · ${head.name}`, 48, doc.page.height - 40, { align: "center", width: doc.page.width - 96, lineBreak: false });
  doc.end();
}

/** Two-column key/value block. */
export function kv(doc: PDFKit.PDFDocument, rows: [string, string | null | undefined][]) {
  const y0 = doc.y;
  const half = Math.ceil(rows.length / 2);
  rows.forEach(([k, v], i) => {
    const col = i < half ? 0 : 1;
    const y = y0 + (i % half) * 16;
    doc.fillColor(MUTED).fontSize(8.5).text(k, 48 + col * 250, y, { width: 90 });
    doc.fillColor(INK).fontSize(9.5).text(v || "—", 140 + col * 250, y, { width: 150 });
  });
  doc.x = 48;
  doc.y = y0 + half * 16 + 8;
}

/** Simple table with header row; returns nothing, advances doc.y. */
export function table(doc: PDFKit.PDFDocument, cols: { label: string; width: number; align?: "left" | "right" }[], rows: string[][]) {
  const x0 = 48;
  let y = doc.y;
  doc.rect(x0, y, doc.page.width - 96, 20).fill("#eef4ff");
  let x = x0 + 6;
  doc.fillColor(BLUE).font("Helvetica-Bold").fontSize(8.5);
  for (const c of cols) { doc.text(c.label, x, y + 6, { width: c.width - 8, align: c.align ?? "left" }); x += c.width; }
  y += 24;
  doc.font("Helvetica").fillColor(INK).fontSize(9.5);
  for (const r of rows) {
    const h = Math.max(...r.map((cell, i) => doc.heightOfString(cell, { width: cols[i].width - 8 }))) + 8;
    if (y + h > doc.page.height - 70) { doc.addPage(); y = 48; }
    x = x0 + 6;
    r.forEach((cell, i) => { doc.text(cell, x, y, { width: cols[i].width - 8, align: cols[i].align ?? "left" }); x += cols[i].width; });
    y += h;
    doc.moveTo(x0, y - 3).lineTo(doc.page.width - 48, y - 3).strokeColor("#e4eaf3").stroke();
  }
  doc.x = x0;
  doc.y = y + 6;
}

export const rupees = (paise: number) => `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
