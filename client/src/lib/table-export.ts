/**
 * Exportar una tabla YA FILTRADA a Excel o PDF (Mis Comprobantes, oct-2026).
 *
 * Recibe las filas tal como se ven en pantalla, así lo exportado respeta los filtros sin
 * duplicar acá la lógica de filtrado. El encabezado del archivo dice qué filtros estaban puestos.
 */
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Importe: en Excel queda como número; en el PDF, con formato $ y alineado a la derecha. */
  money?: boolean;
  /** Ancho relativo en el PDF (por defecto 1). */
  width?: number;
}

export interface ExportSheet<T> {
  name: string;
  columns: ExportColumn<T>[];
  rows: T[];
}

export interface ExportInput {
  title: string;
  /** Filtros aplicados, uno por línea ("Período: 01/01/2026 al 16/10/2026"). */
  filtros: string[];
  /** Totales para el pie ("Comprobantes: 282", "Total AFIP: $ ..."). */
  resumen?: string[];
  sheets: ExportSheet<any>[];
  fileBase: string;
}

const money = (n: number) =>
  `$ ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportToExcel(input: ExportInput) {
  const wb = XLSX.utils.book_new();
  input.sheets.forEach((sheet, i) => {
    const header: (string | number)[][] =
      i === 0
        ? [[input.title], ...input.filtros.map((f) => [f]), ...(input.resumen ?? []).map((r) => [r]), []]
        : [[sheet.name], []];
    const body = sheet.rows.map((r) =>
      sheet.columns.map((c) => {
        const v = c.value(r);
        return v == null ? "" : v;
      }),
    );
    const ws = XLSX.utils.aoa_to_sheet([...header, sheet.columns.map((c) => c.header), ...body]);
    ws["!cols"] = sheet.columns.map((c) => ({ wch: Math.max(10, Math.round((c.width ?? 1) * 14)) }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  });
  XLSX.writeFile(wb, `${input.fileBase}_${stamp()}.xlsx`);
}

export function exportToPdf(input: ExportInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 32;
  const W = pageW - M * 2;
  let y = M;

  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 132);
    doc.text(`DataFlow · ${input.title}`, M, pageH - 16);
    doc.text(`Página ${doc.getNumberOfPages()}`, pageW - M, pageH - 16, { align: "right" });
  };

  // Encabezado
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(38, 38, 44);
  doc.text(input.title, M, y + 10);
  y += 24;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 112);
  for (const f of input.filtros) {
    doc.text(f, M, y);
    y += 11;
  }
  if (input.resumen?.length) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(38, 38, 44);
    doc.text(input.resumen.join("   ·   "), M, y + 2);
    y += 14;
  }
  y += 6;

  for (const sheet of input.sheets) {
    if (sheet.rows.length === 0) continue;
    const totalW = sheet.columns.reduce((a, c) => a + (c.width ?? 1), 0);
    const widths = sheet.columns.map((c) => ((c.width ?? 1) / totalW) * W);

    const headerRow = () => {
      doc.setFillColor(45, 45, 45);
      doc.rect(M, y, W, 16, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      let x = M;
      sheet.columns.forEach((c, i) => {
        if (c.money) doc.text(c.header, x + widths[i] - 4, y + 11, { align: "right" });
        else doc.text(c.header, x + 4, y + 11);
        x += widths[i];
      });
      y += 16;
    };

    if (input.sheets.length > 1) {
      if (y + 40 > pageH - 30) {
        footer();
        doc.addPage();
        y = M;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(38, 38, 44);
      doc.text(sheet.name, M, y + 8);
      y += 14;
    }
    headerRow();

    sheet.rows.forEach((r, ri) => {
      if (y + 14 > pageH - 30) {
        footer();
        doc.addPage();
        y = M;
        headerRow();
      }
      if (ri % 2 === 1) {
        doc.setFillColor(248, 248, 250);
        doc.rect(M, y, W, 14, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(38, 38, 44);
      let x = M;
      sheet.columns.forEach((c, i) => {
        const v = c.value(r);
        let txt = v == null ? "" : c.money && typeof v === "number" ? money(v) : String(v);
        const max = widths[i] - 8;
        while (txt.length > 2 && doc.getTextWidth(txt) > max) txt = txt.slice(0, -2) + "…";
        if (c.money) doc.text(txt, x + widths[i] - 4, y + 10, { align: "right" });
        else doc.text(txt, x + 4, y + 10);
        x += widths[i];
      });
      y += 14;
    });
    y += 14;
  }

  footer();
  doc.save(`${input.fileBase}_${stamp()}.pdf`);
}
