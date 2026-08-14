/**
 * PDF del Punto de Equilibrio.
 *
 * Se dibuja a mano con jsPDF (el proyecto no usa autotable) siguiendo el estilo del PDF de la
 * Carta: banda de encabezado, tablas con cabecera oscura y filas alternadas.
 */
import { jsPDF } from "jspdf";
import { VARIABLE_COST_BASE_LABELS, type VariableCostBase } from "@shared/breakeven";

/** Una línea de la mezcla en un escenario concreto (punto de equilibrio o simulación). */
export interface BreakevenPdfMixLine {
  name: string;
  /** Unidades por cada `leaderQty` del líder — la relación que cargó el usuario. */
  qty: number;
  priceNoIva: number;
  /** Costo variable unitario: costo del producto + costos variables en %. */
  unitCost: number;
  units: number;
  revenue: number;
  variableCost: number;
}

export interface BreakevenPdfMixScenario {
  title: string;
  leaderUnits: number;
  lines: BreakevenPdfMixLine[];
  totalRevenue: number;
  totalCost: number;
}

export interface BreakevenPdfInput {
  name: string;
  localName: string;
  productName: string | null;
  /** Qué es "una unidad" en este análisis: el producto, o el producto líder de la mezcla. */
  unitLabel?: string | null;
  /** Mezcla de productos con uno líder. null en los análisis de un solo producto. */
  mix?: {
    leaderName: string;
    leaderQty: number;
    scenarios: BreakevenPdfMixScenario[];
  } | null;
  priceNoIva: number;
  costNoIva: number;
  variableCosts: Array<{
    label: string;
    pct: number;
    base: VariableCostBase;
    ivaRate?: number | null;
    amountPerUnit: number;
  }>;
  variablePerUnit: number;
  contributionMargin: number;
  contributionPct: number;
  fixedCosts: Array<{ imputation: string; label: string; amount: number }>;
  totalFixed: number;
  units: number;
  revenue: number;
  scenarios: Array<{ label: string; units: number; revenue: number; profit: number; profitPct: number }>;
  simulation: { units: number; overBreakeven: number; revenue: number; variableTotal: number; profit: number; profitPct: number } | null;
}

const money = (n: number) =>
  `$ ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const num = (n: number, d = 0) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

const INK = { r: 38, g: 38, b: 44 };
const MUTED = { r: 120, g: 120, b: 132 };
const ACCENT = { r: 16, g: 122, b: 96 };
const DANGER = { r: 190, g: 45, b: 45 };
const LINE = { r: 222, g: 222, b: 228 };

export function buildBreakevenPdf(input: BreakevenPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 42;
  const W = pageW - M * 2;
  let y = 0;

  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text("DataFlow · Punto de Equilibrio", M, pageH - 20);
    doc.text(
      new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" }),
      pageW - M,
      pageH - 20,
      { align: "right" },
    );
  };

  /** Salta de página cuando lo que viene no entra. */
  const ensure = (needed: number) => {
    if (y + needed <= pageH - 46) return;
    footer();
    doc.addPage();
    y = M;
  };

  const sectionTitle = (text: string) => {
    ensure(34);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(text.toUpperCase(), M, y);
    y += 6;
    doc.setDrawColor(LINE.r, LINE.g, LINE.b);
    doc.setLineWidth(0.8);
    doc.line(M, y, M + W, y);
    y += 12;
  };

  interface Col { label: string; w: number; align?: "left" | "right" }

  const table = (
    cols: Col[],
    rows: Array<{ cells: string[]; bold?: boolean; color?: { r: number; g: number; b: number } }>,
  ) => {
    const rowH = 17;
    ensure(rowH * 2);
    // Cabecera
    doc.setFillColor(45, 45, 45);
    doc.rect(M, y, W, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    let x = M;
    for (const c of cols) {
      doc.text(c.label, c.align === "right" ? x + c.w - 7 : x + 7, y + 11.5, {
        align: c.align === "right" ? "right" : "left",
      });
      x += c.w;
    }
    y += rowH;

    rows.forEach((row, i) => {
      ensure(rowH);
      if (i % 2 === 1) {
        doc.setFillColor(247, 247, 249);
        doc.rect(M, y, W, rowH, "F");
      }
      doc.setFont("helvetica", row.bold ? "bold" : "normal");
      doc.setFontSize(8);
      let cx = M;
      row.cells.forEach((cell, ci) => {
        const c = cols[ci];
        const col = row.color ?? INK;
        doc.setTextColor(col.r, col.g, col.b);
        // El texto largo se recorta para no pisar la columna de al lado.
        const maxW = c.w - 14;
        let txt = cell;
        while (txt.length > 3 && doc.getTextWidth(txt) > maxW) txt = txt.slice(0, -2) + "…";
        doc.text(txt, c.align === "right" ? cx + c.w - 7 : cx + 7, y + 11.5, {
          align: c.align === "right" ? "right" : "left",
        });
        cx += c.w;
      });
      doc.setDrawColor(LINE.r, LINE.g, LINE.b);
      doc.setLineWidth(0.4);
      doc.line(M, y + rowH, M + W, y + rowH);
      y += rowH;
    });
    y += 16;
  };

  // ---------- Encabezado ----------
  doc.setFillColor(45, 45, 45);
  doc.rect(0, 0, pageW, 82, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("Punto de Equilibrio", M, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(205, 205, 212);
  doc.text(input.name, M, 57);
  doc.setFontSize(8.5);
  const meta = [input.localName, input.productName].filter(Boolean).join("  ·  ");
  doc.text(meta, M, 71);
  y = 112;

  // ---------- Resultado destacado ----------
  const boxW = (W - 14) / 2;
  const boxH = 62;
  const drawBox = (bx: number, title: string, value: string, hint: string) => {
    doc.setDrawColor(LINE.r, LINE.g, LINE.b);
    doc.setLineWidth(1);
    doc.roundedRect(bx, y, boxW, boxH, 5, 5, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(title, bx + 12, y + 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(ACCENT.r, ACCENT.g, ACCENT.b);
    doc.text(value, bx + 12, y + 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(hint, bx + 12, y + 55);
  };
  drawBox(
    M,
    "NECESITÁS VENDER",
    `${num(Math.ceil(input.units))} unidades`,
    input.mix ? `de ${input.mix.leaderName} — el resto acompaña` : "para no ganar ni perder",
  );
  drawBox(M + boxW + 14, "EQUIVALE A FACTURAR", money(input.revenue), "en el período de los costos fijos");
  y += boxH + 26;

  // ---------- Mezcla de productos ----------
  // Con producto líder todo se calcula sobre una unidad del líder, así que hace falta abrir qué se
  // vende de cada acompañante, cuánto factura y cuánto cuesta.
  if (input.mix && input.mix.scenarios.length > 0) {
    const mix = input.mix;
    const first = mix.scenarios[0];
    sectionTitle("Mezcla de productos");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    const composition =
      `${first.lines.length} producto${first.lines.length === 1 ? "" : "s"} · Líder: ${mix.leaderName} ` +
      `(${num(mix.leaderQty)} u.)` +
      first.lines
        .slice(1)
        .map((l) => ` · ${l.name}: ${num(l.qty, 2)} cada ${num(mix.leaderQty)} de ${mix.leaderName}`)
        .join("");
    const lines = doc.splitTextToSize(composition, W) as string[];
    ensure(lines.length * 11 + 6);
    doc.text(lines, M, y);
    y += lines.length * 11 + 10;

    const mixCols: Col[] = [
      { label: "Producto", w: W - 70 - 70 - 60 - 82 - 82 },
      { label: "Precio u.", w: 70, align: "right" },
      { label: "Costo u.", w: 70, align: "right" },
      { label: "Unidades", w: 60, align: "right" },
      { label: "Facturación", w: 82, align: "right" },
      { label: "Costo var.", w: 82, align: "right" },
    ];
    for (const sc of mix.scenarios) {
      ensure(24);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(INK.r, INK.g, INK.b);
      doc.text(`${sc.title} — ${num(Math.ceil(sc.leaderUnits))} u. de ${mix.leaderName}`, M, y);
      y += 11;
      table(mixCols, [
        ...sc.lines.map((l) => ({
          cells: [
            l.name,
            money(l.priceNoIva),
            money(l.unitCost),
            num(l.units, 1),
            money(l.revenue),
            money(l.variableCost),
          ],
        })),
        {
          cells: ["TOTAL", "", "", "", money(sc.totalRevenue), money(sc.totalCost)],
          bold: true,
        },
      ]);
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    const noteLines = doc.splitTextToSize(
      "El costo unitario incluye el costo del producto más los costos variables en % que le aplican. La suma de la " +
        "facturación es la facturación total del escenario y la suma de los costos es el costo variable total.",
      W,
    ) as string[];
    ensure(noteLines.length * 10 + 6);
    doc.text(noteLines, M, y);
    y += noteLines.length * 10 + 18;
  }

  // ---------- Estructura por unidad ----------
  sectionTitle(
    input.unitLabel ? `Estructura por unidad de ${input.unitLabel} (sin IVA)` : "Estructura por unidad (sin IVA)",
  );
  const unitCols: Col[] = [
    { label: "Concepto", w: W - 90 - 90 },
    { label: "Base", w: 90, align: "right" },
    { label: "Importe", w: 90, align: "right" },
  ];
  const unitRows: Array<{ cells: string[]; bold?: boolean; color?: { r: number; g: number; b: number } }> = [
    { cells: [input.mix ? "Facturación (líder + acompañantes)" : "Precio de venta", "", money(input.priceNoIva)], bold: true },
    { cells: [input.mix ? "Costo de los productos" : "Costo del producto", "", `- ${money(input.costNoIva)}`], color: DANGER },
  ];
  for (const v of input.variableCosts) {
    const baseTxt =
      v.base === "costo" ? "costo" : v.base === "con_iva" ? `precio c/IVA ${v.ivaRate ?? 21}%` : "precio s/IVA";
    unitRows.push({
      cells: [`${v.label} (${num(v.pct, 2)}%)`, baseTxt, `- ${money(v.amountPerUnit)}`],
      color: DANGER,
    });
  }
  if (input.variableCosts.length > 1) {
    unitRows.push({ cells: ["Total costos variables", "", `- ${money(input.variablePerUnit)}`], color: DANGER });
  }
  unitRows.push({
    cells: [`Margen de contribución  (${num(input.contributionPct, 2)}%)`, "", money(input.contributionMargin)],
    bold: true,
    color: ACCENT,
  });
  table(unitCols, unitRows);

  // ---------- Costos fijos ----------
  sectionTitle("Costos fijos del período");
  const fixedCols: Col[] = [
    { label: "Imputación", w: W - 220 - 110 },
    { label: "Detalle", w: 220 },
    { label: "Importe", w: 110, align: "right" },
  ];
  const fixedRows = input.fixedCosts.map((f) => ({ cells: [f.imputation, f.label, money(f.amount)] }));
  fixedRows.push({ cells: ["TOTAL", "", money(input.totalFixed)], bold: true } as any);
  table(fixedCols, fixedRows.length > 1 ? fixedRows : [{ cells: ["Sin costos fijos cargados", "", money(0)] }]);

  // ---------- Cómo se calcula ----------
  ensure(58);
  doc.setFillColor(247, 247, 249);
  doc.roundedRect(M, y, W, 46, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text("Cómo se calcula", M + 12, y + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(
    `Punto de equilibrio = costos fijos / margen de contribución = ${money(input.totalFixed)} / ${money(input.contributionMargin)} = ${num(input.units, 2)}` +
      (input.mix ? ` u. de ${input.mix.leaderName}` : " unidades"),
    M + 12,
    y + 31,
  );
  doc.text(
    "Superado ese punto los costos fijos ya están cubiertos: cada unidad extra deja el margen de contribución entero.",
    M + 12,
    y + 42,
  );
  y += 46 + 24;

  // ---------- Escenarios ----------
  sectionTitle("Qué pasa si vendo más");
  const scCols: Col[] = [
    { label: "Escenario", w: W - 85 - 120 - 110 - 70 },
    { label: "Unidades", w: 85, align: "right" },
    { label: "Facturación", w: 120, align: "right" },
    { label: "Ganancia", w: 110, align: "right" },
    { label: "% s/ventas", w: 70, align: "right" },
  ];
  table(
    scCols,
    input.scenarios.map((s) => ({
      cells: [s.label, num(s.units), money(s.revenue), money(s.profit), `${num(s.profitPct, 1)}%`],
      color: s.profit > 0 ? ACCENT : INK,
    })),
  );

  // ---------- Simulación puntual ----------
  if (input.simulation && input.simulation.units > 0) {
    const s = input.simulation;
    sectionTitle("Tu simulación");
    table(
      [
        { label: "Concepto", w: W - 150 },
        { label: "Importe", w: 150, align: "right" },
      ],
      [
        { cells: ["Unidades vendidas", num(s.units)] },
        {
          cells: [
            "Sobre el punto de equilibrio",
            `${s.overBreakeven >= 0 ? "+" : ""}${num(s.overBreakeven, 0)} unidades`,
          ],
        },
        { cells: ["Facturación", money(s.revenue)] },
        { cells: ["Costos fijos", `- ${money(input.totalFixed)}`], color: DANGER },
        { cells: ["Costos variables totales", `- ${money(s.variableTotal)}`], color: DANGER },
        {
          cells: [s.profit >= 0 ? "GANANCIA" : "PÉRDIDA", `${money(s.profit)}  (${num(s.profitPct, 1)}%)`],
          bold: true,
          color: s.profit >= 0 ? ACCENT : DANGER,
        },
      ],
    );
  }

  footer();
  return doc;
}
