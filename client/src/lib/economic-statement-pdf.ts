/**
 * PDF del Estado de Resultado Económico.
 *
 * Se dibuja a mano con jsPDF siguiendo el estilo de los otros PDF del sistema (banda de
 * encabezado, tablas con cabecera oscura y filas alternadas), pero en verde, que es el color del
 * módulo.
 *
 * Recibe las filas YA APLANADAS por la pantalla, no el árbol completo: así el PDF sale con
 * exactamente las secciones y los grupos que el usuario dejó desplegados, sin tener que duplicar
 * acá la lógica de plegado.
 */
import { jsPDF } from "jspdf";

export interface StatementPdfRow {
  label: string;
  amount: number;
  /** null en las filas donde el % no aplica (el objetivo del mes, por ejemplo). */
  pct: number | null;
  level: 0 | 1 | 2 | 3;
  kind: "section" | "row" | "subtotal" | "grand";
  meta?: string;
}

export interface StatementPdfInput {
  monthLabel: string;
  localsLabel: string;
  sourcesLabel: string;
  cmvLabel: string;
  rows: StatementPdfRow[];
  indicadores: Array<{ label: string; value: number }>;
  puntoEquilibrio?: { ventasNecesarias: number; costosFijos: number; margenPct: number; excedente: number } | null;
  ventasNoFacturadas?: { noFacturada: number; pct: number; total: number } | null;
  /** Explicación de por qué a las ventas facturadas se les quita el IVA. */
  notaIva?: string;
  comparativo?: {
    mesAnterior: string;
    lineas: Array<{ label: string; hoy: number; antes: number }>;
  } | null;
  topProductos?: {
    source: string;
    coberturaPct: number | null;
    items: Array<{ rank: number; producto: string; cantidad: number; participacionPct: number; cmvPct: number | null; margenPct: number | null }>;
  } | null;
}

const money = (n: number) =>
  `$ ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const num = (n: number, d = 0) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const pctTxt = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${num(n, d)}%`);

const INK = { r: 38, g: 38, b: 44 };
const MUTED = { r: 120, g: 120, b: 132 };
const GREEN = { r: 4, g: 120, b: 87 };
const GREEN_BG = { r: 236, g: 253, b: 245 };
const DANGER = { r: 190, g: 45, b: 45 };
const LINE = { r: 222, g: 222, b: 228 };

export function buildEconomicStatementPdf(input: StatementPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40;
  const W = pageW - M * 2;
  const COL_IMP = 106;
  const COL_PCT = 52;
  let y = 0;

  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text("DataFlow · Estado de Resultado Económico · ventas netas de IVA en lo facturado, compras con IVA", M, pageH - 20);
    doc.text(
      new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" }),
      pageW - M,
      pageH - 20,
      { align: "right" },
    );
  };

  const ensure = (needed: number) => {
    if (y + needed <= pageH - 46) return;
    footer();
    doc.addPage();
    y = M;
  };

  const sectionTitle = (text: string) => {
    ensure(34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(text.toUpperCase(), M, y);
    y += 5;
    doc.setDrawColor(LINE.r, LINE.g, LINE.b);
    doc.setLineWidth(0.8);
    doc.line(M, y, M + W, y);
    y += 12;
  };

  const paragraph = (text: string, size = 8) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    const lines = doc.splitTextToSize(text, W) as string[];
    ensure(lines.length * 11 + 4);
    doc.text(lines, M, y);
    y += lines.length * 11 + 8;
  };

  // ---------- Encabezado ----------
  doc.setFillColor(GREEN.r, GREEN.g, GREEN.b);
  doc.rect(0, 0, pageW, 84, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text("Estado de Resultado Económico", M, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(215, 245, 232);
  doc.text(input.monthLabel, M, 53);
  doc.setFontSize(8.5);
  doc.text(input.localsLabel, M, 68);
  doc.setFontSize(8.5);
  doc.setTextColor(190, 235, 218);
  doc.text(`Ventas de: ${input.sourcesLabel}`, pageW - M, 53, { align: "right" });
  doc.text(`Costo: ${input.cmvLabel}`, pageW - M, 68, { align: "right" });
  y = 108;

  // ---------- El estado de resultado ----------
  const headerRow = () => {
    doc.setFillColor(45, 45, 45);
    doc.rect(M, y, W, 17, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text("CONCEPTO", M + 7, y + 11.5);
    doc.text("IMPORTE", M + W - COL_PCT - 7, y + 11.5, { align: "right" });
    doc.text("% S/VTAS", M + W - 7, y + 11.5, { align: "right" });
    y += 17;
  };

  ensure(40);
  headerRow();

  let zebra = 0;
  for (const row of input.rows) {
    const h = row.kind === "grand" ? 22 : 16;
    if (y + h > pageH - 46) {
      footer();
      doc.addPage();
      y = M;
      headerRow();
      zebra = 0;
    }

    if (row.kind === "section" || row.kind === "grand") {
      doc.setFillColor(GREEN_BG.r, GREEN_BG.g, GREEN_BG.b);
      doc.rect(M, y, W, h, "F");
    } else if (zebra % 2 === 1) {
      doc.setFillColor(248, 248, 250);
      doc.rect(M, y, W, h, "F");
    }
    zebra++;

    const bold = row.kind !== "row";
    const color =
      row.kind === "grand"
        ? row.amount >= 0
          ? GREEN
          : DANGER
        : row.kind === "section" || row.kind === "subtotal"
          ? GREEN
          : row.level >= 2
            ? MUTED
            : INK;

    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(row.kind === "grand" ? 10 : row.kind === "section" ? 8 : 8);
    doc.setTextColor(color.r, color.g, color.b);

    const indent = [0, 14, 28, 42][row.level];
    const labelX = M + 7 + indent;
    const maxLabelW = W - COL_IMP - COL_PCT - 16 - indent;
    let label = row.kind === "section" || row.kind === "grand" ? row.label.toUpperCase() : row.label;
    while (label.length > 3 && doc.getTextWidth(label) > maxLabelW) label = label.slice(0, -2) + "…";
    doc.text(label, labelX, y + h / 2 + 3);

    if (row.meta) {
      const wLabel = doc.getTextWidth(label);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      let meta = row.meta;
      const metaMax = maxLabelW - wLabel - 6;
      while (meta.length > 3 && doc.getTextWidth(meta) > metaMax) meta = meta.slice(0, -2) + "…";
      if (metaMax > 20) doc.text(meta, labelX + wLabel + 6, y + h / 2 + 3);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(row.kind === "grand" ? 10 : 8);
      doc.setTextColor(color.r, color.g, color.b);
    }

    doc.text(money(row.amount), M + W - COL_PCT - 7, y + h / 2 + 3, { align: "right" });
    doc.setFontSize(7);
    doc.text(pctTxt(row.pct), M + W - 7, y + h / 2 + 3, { align: "right" });

    doc.setDrawColor(LINE.r, LINE.g, LINE.b);
    doc.setLineWidth(0.4);
    doc.line(M, y + h, M + W, y + h);
    y += h;
  }
  y += 10;
  if (input.notaIva) paragraph(input.notaIva, 7);
  y += 8;

  // ---------- Indicadores ----------
  if (input.indicadores.length > 0) {
    sectionTitle("Indicadores");
    const gap = 8;
    const boxW = (W - gap * (input.indicadores.length - 1)) / input.indicadores.length;
    ensure(52);
    input.indicadores.forEach((k, i) => {
      const bx = M + i * (boxW + gap);
      doc.setDrawColor(LINE.r, LINE.g, LINE.b);
      doc.setLineWidth(1);
      doc.roundedRect(bx, y, boxW, 46, 4, 4, "S");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
      const lbl = doc.splitTextToSize(k.label, boxW - 14) as string[];
      doc.text(lbl.slice(0, 2), bx + 7, y + 13);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      const c = k.value >= 0 ? GREEN : DANGER;
      doc.setTextColor(c.r, c.g, c.b);
      doc.text(pctTxt(k.value), bx + 7, y + 38);
    });
    y += 46 + 20;
  }

  // ---------- Punto de equilibrio y ventas no facturadas ----------
  if (input.puntoEquilibrio || input.ventasNoFacturadas) {
    sectionTitle("Punto de equilibrio y facturación");
    if (input.puntoEquilibrio) {
      const pe = input.puntoEquilibrio;
      paragraph(
        `Para no ganar ni perder había que vender ${money(pe.ventasNecesarias)}: costos fijos ${money(pe.costosFijos)} ` +
          `dividido el margen de contribución de ${pctTxt(pe.margenPct)}. ` +
          (pe.excedente >= 0
            ? `Se vendió ${money(pe.excedente)} por encima del equilibrio.`
            : `Faltaron ${money(Math.abs(pe.excedente))} para llegar al equilibrio.`),
      );
    }
    if (input.ventasNoFacturadas) {
      const v = input.ventasNoFacturadas;
      paragraph(
        `Ventas con medio de pago no facturadas: ${money(v.noFacturada)}, el ${pctTxt(v.pct)} de los ${money(v.total)} ` +
          `cobrados por tarjeta, QR, transferencia y cuenta corriente (estimado por diferencia contra lo facturado).`,
      );
    }
  }

  // ---------- Comparativo ----------
  if (input.comparativo && input.comparativo.lineas.length > 0) {
    sectionTitle(`Contra el mes anterior (${input.comparativo.mesAnterior})`);
    const cols = [
      { label: "Concepto", w: W - 106 - 106 - 96 - 54 },
      { label: "Este mes", w: 106 },
      { label: "Mes anterior", w: 106 },
      { label: "Diferencia", w: 96 },
      { label: "Var. %", w: 54 },
    ];
    ensure(34);
    doc.setFillColor(45, 45, 45);
    doc.rect(M, y, W, 17, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    let hx = M;
    cols.forEach((c, i) => {
      doc.text(c.label, i === 0 ? hx + 7 : hx + c.w - 7, y + 11.5, { align: i === 0 ? "left" : "right" });
      hx += c.w;
    });
    y += 17;

    input.comparativo.lineas.forEach((l, i) => {
      ensure(16);
      if (i % 2 === 1) {
        doc.setFillColor(248, 248, 250);
        doc.rect(M, y, W, 16, "F");
      }
      const dif = l.hoy - l.antes;
      const varPct = l.antes !== 0 ? (dif / Math.abs(l.antes)) * 100 : null;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      let cx = M;
      const cells = [
        l.label,
        money(l.hoy),
        money(l.antes),
        `${dif >= 0 ? "+" : ""}${money(dif)}`,
        varPct == null ? "—" : `${varPct >= 0 ? "+" : ""}${num(varPct, 1)}%`,
      ];
      cells.forEach((cell, ci) => {
        doc.setTextColor(INK.r, INK.g, INK.b);
        doc.text(cell, ci === 0 ? cx + 7 : cx + cols[ci].w - 7, y + 11, { align: ci === 0 ? "left" : "right" });
        cx += cols[ci].w;
      });
      doc.setDrawColor(LINE.r, LINE.g, LINE.b);
      doc.setLineWidth(0.4);
      doc.line(M, y + 16, M + W, y + 16);
      y += 16;
    });
    y += 18;
  }

  // ---------- Top productos ----------
  if (input.topProductos && input.topProductos.items.length > 0) {
    sectionTitle("Los 10 productos más vendidos del mes");
    const cols = [
      { label: "#", w: 24 },
      { label: "Producto", w: W - 24 - 76 - 66 - 60 - 66 },
      { label: "Unidades", w: 76 },
      { label: "% del total", w: 66 },
      { label: "CMV %", w: 60 },
      { label: "Margen %", w: 66 },
    ];
    ensure(34);
    doc.setFillColor(45, 45, 45);
    doc.rect(M, y, W, 17, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    let hx = M;
    cols.forEach((c, i) => {
      doc.text(c.label, i <= 1 ? hx + 7 : hx + c.w - 7, y + 11.5, { align: i <= 1 ? "left" : "right" });
      hx += c.w;
    });
    y += 17;

    input.topProductos.items.forEach((it, i) => {
      ensure(16);
      if (i % 2 === 1) {
        doc.setFillColor(248, 248, 250);
        doc.rect(M, y, W, 16, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(INK.r, INK.g, INK.b);
      let cx = M;
      const cells = [
        String(it.rank),
        it.producto,
        num(it.cantidad),
        pctTxt(it.participacionPct),
        pctTxt(it.cmvPct),
        pctTxt(it.margenPct),
      ];
      cells.forEach((cell, ci) => {
        let txt = cell;
        const maxW = cols[ci].w - 14;
        while (txt.length > 3 && doc.getTextWidth(txt) > maxW) txt = txt.slice(0, -2) + "…";
        doc.text(txt, ci <= 1 ? cx + 7 : cx + cols[ci].w - 7, y + 11, { align: ci <= 1 ? "left" : "right" });
        cx += cols[ci].w;
      });
      doc.setDrawColor(LINE.r, LINE.g, LINE.b);
      doc.setLineWidth(0.4);
      doc.line(M, y + 16, M + W, y + 16);
      y += 16;
    });
    if (input.topProductos.coberturaPct != null && input.topProductos.coberturaPct < 95) {
      y += 6;
      paragraph(
        `Los productos con "—" todavía no tienen costo cargado. La cobertura de costeo del mes es de ` +
          `${pctTxt(input.topProductos.coberturaPct)}.`,
        7,
      );
    }
  }

  footer();
  return doc;
}
