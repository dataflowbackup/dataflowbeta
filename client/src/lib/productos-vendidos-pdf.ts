/**
 * PDF de Productos Vendidos.
 *
 * Se dibuja a mano con jsPDF siguiendo el estilo del PDF del Punto de Equilibrio (banda de
 * encabezado, tablas con cabecera oscura y filas alternadas).
 *
 * Sale en TRES niveles porque el público es distinto y el costo no se comparte con todos:
 *  - `empleados`    → ranking, unidades y variación. Sin un solo número de costo. Va en vertical,
 *                     pensado para imprimir y colgar.
 *  - `supervisores` → suma CMV%, margen%, semáforo, los movimientos y el desglose por local.
 *  - `socios`       → suma el margen en $ (unitario y total), el Pareto y la nota metodológica.
 */
import { jsPDF } from "jspdf";

export type ProductosVendidosPdfLevel = "empleados" | "supervisores" | "socios";

export const PDF_LEVEL_LABELS: Record<ProductosVendidosPdfLevel, string> = {
  empleados: "Para el equipo",
  supervisores: "Para supervisores",
  socios: "Para socios",
};

export interface ProductosVendidosPdfItem {
  rank: number;
  producto: string;
  categoria: string | null;
  cantidad: number;
  unidadesPorDia: number;
  participacionPct: number;
  acumuladoPct: number;
  cantidadPrev: number | null;
  variacionPct: number | null;
  esNuevo: boolean;
  cmvPct: number | null;
  margenPct: number | null;
  margenUnitario: number | null;
  margenTotal: number | null;
  porLocal: Array<{ localId: number; localName: string; cantidad: number }>;
}

export interface ProductosVendidosPdfInput {
  level: ProductosVendidosPdfLevel;
  sourceLabel: string;
  ivaIncluded: boolean;
  period: { from: string; to: string; days: number; diasConVenta: number };
  prevPeriod: { from: string; to: string; days: number };
  /** Locales que se están viendo, con nombre. Es un dato del reporte, no un detalle de la UI. */
  locals: Array<{ id: number; name: string }>;
  allLocalsCount: number;
  isAllLocals: boolean;
  totals: {
    unidades: number;
    unidadesPrev: number;
    variacionPct: number | null;
    productosDistintos: number;
    coberturaPct: number | null;
    cmvPonderadoPct: number | null;
    margenPonderadoPct: number | null;
    topParticipacionPct: number;
    productosHasta80: number;
  };
  items: ProductosVendidosPdfItem[];
  subidas: Array<{ producto: string; cantidad: number; cantidadPrev: number | null; variacionPct: number | null }>;
  bajas: Array<{ producto: string; cantidad: number; cantidadPrev: number | null; variacionPct: number | null }>;
  desaparecidos: Array<{ producto: string; cantidadPrev: number }>;
  /** Conceptos que se sacaron del ranking y de los totales (servicio de mesa, cubiertos…). */
  excluidos: string[];
  moversMinBase: number;
  /** Umbral del semáforo de CMV. Por encima se pinta en rojo. */
  cmvObjetivo: number;
}

const money = (n: number) =>
  `$ ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const num = (n: number, d = 0) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const pct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${num(n, d)}%`);
const signedPct = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${num(n, d)}%`;

/** "2026-09-21" → "21/09/2026", sin pasar por Date (no hay corrimiento de zona horaria). */
const fecha = (iso: string) => {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? "");
};

const INK = { r: 38, g: 38, b: 44 };
const MUTED = { r: 120, g: 120, b: 132 };
const ACCENT = { r: 16, g: 122, b: 96 };
const DANGER = { r: 190, g: 45, b: 45 };
const LINE = { r: 222, g: 222, b: 228 };

export function buildProductosVendidosPdf(input: ProductosVendidosPdfInput): jsPDF {
  const isEmpleados = input.level === "empleados";
  const showCosts = input.level !== "empleados";
  const showMoney = input.level === "socios";

  // Al equipo se le da una hoja vertical (se imprime y se cuelga); con columnas de costo hace
  // falta el ancho del apaisado.
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: isEmpleados ? "portrait" : "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 42;
  const W = pageW - M * 2;
  let y = 0;

  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(`DataFlow · Productos Vendidos · ${PDF_LEVEL_LABELS[input.level]}`, M, pageH - 20);
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
    doc.setFontSize(10.5);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(text.toUpperCase(), M, y);
    y += 6;
    doc.setDrawColor(LINE.r, LINE.g, LINE.b);
    doc.setLineWidth(0.8);
    doc.line(M, y, M + W, y);
    y += 12;
  };

  const paragraph = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    const lines = doc.splitTextToSize(text, W) as string[];
    ensure(lines.length * 11 + 6);
    doc.text(lines, M, y);
    y += lines.length * 11 + 10;
  };

  interface Col { label: string; w: number; align?: "left" | "right" }
  interface Row { cells: string[]; bold?: boolean; color?: { r: number; g: number; b: number }; cellColors?: Array<{ r: number; g: number; b: number } | null> }

  const table = (cols: Col[], rows: Row[]) => {
    const rowH = 17;
    const header = () => {
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
    };

    ensure(rowH * 2);
    header();

    rows.forEach((row, i) => {
      // Al saltar de página la cabecera se repite: una tabla sin encabezado no se lee.
      if (y + rowH > pageH - 46) {
        footer();
        doc.addPage();
        y = M;
        header();
      }
      if (i % 2 === 1) {
        doc.setFillColor(247, 247, 249);
        doc.rect(M, y, W, rowH, "F");
      }
      doc.setFont("helvetica", row.bold ? "bold" : "normal");
      doc.setFontSize(8);
      let cx = M;
      row.cells.forEach((cell, ci) => {
        const c = cols[ci];
        const col = row.cellColors?.[ci] ?? row.color ?? INK;
        doc.setTextColor(col.r, col.g, col.b);
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
  const localsLabel = input.isAllLocals
    ? `Todos los locales (${input.allLocalsCount})`
    : `${input.locals.map((l) => l.name).join("  ·  ")}  (${input.locals.length} de ${input.allLocalsCount})`;

  doc.setFillColor(45, 45, 45);
  doc.rect(0, 0, pageW, 86, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("Productos Vendidos", M, 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(205, 205, 212);
  doc.text(
    `Top ${input.items.length} por unidades  ·  ${fecha(input.period.from)} al ${fecha(input.period.to)}  ·  ${input.period.days} días`,
    M,
    55,
  );
  doc.setFontSize(8.5);
  doc.text(localsLabel, M, 70);
  doc.setFontSize(8.5);
  doc.setTextColor(150, 150, 162);
  doc.text(PDF_LEVEL_LABELS[input.level].toUpperCase(), pageW - M, 36, { align: "right" });
  doc.text(`Origen: ${input.sourceLabel}`, pageW - M, 55, { align: "right" });
  doc.text(
    `Comparado contra ${fecha(input.prevPeriod.from)} al ${fecha(input.prevPeriod.to)} (${input.prevPeriod.days} días)`,
    pageW - M,
    70,
    { align: "right" },
  );
  y = 116;

  // ---------- Indicadores ----------
  const boxes: Array<{ title: string; value: string; hint: string; tone?: "good" | "bad" }> = [
    {
      title: "UNIDADES VENDIDAS",
      value: num(input.totals.unidades),
      hint: `${input.totals.productosDistintos} productos distintos · ${input.period.diasConVenta} días con venta`,
    },
    {
      title: "VS PERÍODO ANTERIOR",
      value: signedPct(input.totals.variacionPct),
      hint: `${num(input.totals.unidadesPrev)} unidades en el período anterior`,
      tone: input.totals.variacionPct == null ? undefined : input.totals.variacionPct >= 0 ? "good" : "bad",
    },
    {
      title: `EL TOP ${input.items.length} EXPLICA`,
      value: pct(input.totals.topParticipacionPct),
      hint: "de todas las unidades vendidas del período",
    },
  ];
  if (showCosts) {
    boxes.push({
      title: "MARGEN PROMEDIO",
      value: pct(input.totals.margenPonderadoPct),
      hint: `CMV ${pct(input.totals.cmvPonderadoPct)} · cobertura de costeo ${pct(input.totals.coberturaPct)}`,
      tone:
        input.totals.cmvPonderadoPct == null
          ? undefined
          : input.totals.cmvPonderadoPct <= input.cmvObjetivo
            ? "good"
            : "bad",
    });
  }

  const gap = 12;
  const boxW = (W - gap * (boxes.length - 1)) / boxes.length;
  const boxH = 62;
  boxes.forEach((b, i) => {
    const bx = M + i * (boxW + gap);
    doc.setDrawColor(LINE.r, LINE.g, LINE.b);
    doc.setLineWidth(1);
    doc.roundedRect(bx, y, boxW, boxH, 5, 5, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    doc.text(b.title, bx + 12, y + 17);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    const tone = b.tone === "bad" ? DANGER : b.tone === "good" ? ACCENT : INK;
    doc.setTextColor(tone.r, tone.g, tone.b);
    doc.text(b.value, bx + 12, y + 41);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
    const hint = doc.splitTextToSize(b.hint, boxW - 20) as string[];
    doc.text(hint.slice(0, 2), bx + 12, y + 53);
  });
  y += boxH + 26;

  // ---------- Ranking ----------
  sectionTitle(`Los ${input.items.length} productos más vendidos`);

  const varColor = (it: ProductosVendidosPdfItem) =>
    it.variacionPct == null ? MUTED : it.variacionPct >= 0 ? ACCENT : DANGER;
  const cmvColor = (v: number | null) => (v == null ? MUTED : v <= input.cmvObjetivo ? ACCENT : DANGER);
  const varText = (it: ProductosVendidosPdfItem) => (it.esNuevo ? "nuevo" : signedPct(it.variacionPct));

  if (!showCosts) {
    const cols: Col[] = [
      { label: "#", w: 24 },
      { label: "Producto", w: W - 24 - 78 - 66 - 66 - 78 },
      { label: "Unidades", w: 78, align: "right" },
      { label: "Por día", w: 66, align: "right" },
      { label: "% del total", w: 66, align: "right" },
      { label: "vs anterior", w: 78, align: "right" },
    ];
    table(
      cols,
      input.items.map((it) => ({
        cells: [
          String(it.rank),
          it.producto,
          num(it.cantidad),
          num(it.unidadesPorDia, 1),
          pct(it.participacionPct),
          varText(it),
        ],
        cellColors: [null, null, null, null, null, varColor(it)],
      })),
    );
  } else {
    const fixed = 24 + 78 + 60 + 60 + 72 + 60 + 60 + (showMoney ? 84 + 96 : 0);
    const cols: Col[] = [
      { label: "#", w: 24 },
      { label: "Producto", w: W - fixed },
      { label: "Unidades", w: 78, align: "right" },
      { label: "Por día", w: 60, align: "right" },
      { label: "% del total", w: 60, align: "right" },
      { label: "vs anterior", w: 72, align: "right" },
      { label: "CMV %", w: 60, align: "right" },
      { label: "Margen %", w: 60, align: "right" },
      ...(showMoney
        ? ([
            { label: "Margen u.", w: 84, align: "right" },
            { label: "Margen total", w: 96, align: "right" },
          ] as Col[])
        : []),
    ];
    table(
      cols,
      input.items.map((it) => ({
        cells: [
          String(it.rank),
          it.producto,
          num(it.cantidad),
          num(it.unidadesPorDia, 1),
          pct(it.participacionPct),
          varText(it),
          pct(it.cmvPct),
          pct(it.margenPct),
          ...(showMoney
            ? [
                it.margenUnitario == null ? "—" : money(it.margenUnitario),
                it.margenTotal == null ? "—" : money(it.margenTotal),
              ]
            : []),
        ],
        cellColors: [
          null,
          null,
          null,
          null,
          null,
          varColor(it),
          cmvColor(it.cmvPct),
          it.margenPct == null ? MUTED : cmvColor(it.cmvPct),
          ...(showMoney ? [null, null] : []),
        ],
      })),
    );
    paragraph(
      `El semáforo compara el CMV de cada producto contra el objetivo de ${num(input.cmvObjetivo, 1)}%: ` +
        `en verde los que quedan en el objetivo o por debajo, en rojo los que lo superan. ` +
        `Un "—" significa que ese producto todavía no tiene costo o precio cargado, no que su margen sea cero.`,
    );
  }

  if (input.excluidos.length > 0) {
    paragraph(
      `Quedaron fuera del ranking y de los totales: ${input.excluidos.join(", ")}. ` +
        `Son conceptos que el sistema de ventas lista como producto pero no lo son.`,
    );
  }

  // ---------- Movimientos ----------
  if (showCosts && (input.subidas.length > 0 || input.bajas.length > 0 || input.desaparecidos.length > 0)) {
    sectionTitle("Qué se movió");
    const moverCols: Col[] = [
      { label: "Producto", w: W - 90 - 90 - 90 },
      { label: "Período anterior", w: 90, align: "right" },
      { label: "Este período", w: 90, align: "right" },
      { label: "Variación", w: 90, align: "right" },
    ];
    const moverRows = (list: typeof input.subidas, titulo: string): Row[] => [
      { cells: [titulo, "", "", ""], bold: true },
      ...list.map((m) => ({
        cells: [
          `   ${m.producto}`,
          m.cantidadPrev == null ? "—" : num(m.cantidadPrev),
          num(m.cantidad),
          signedPct(m.variacionPct),
        ],
        cellColors: [null, null, null, (m.variacionPct ?? 0) >= 0 ? ACCENT : DANGER],
      })),
    ];
    const rows: Row[] = [];
    if (input.subidas.length > 0) rows.push(...moverRows(input.subidas, "Los que más subieron"));
    if (input.bajas.length > 0) rows.push(...moverRows(input.bajas, "Los que más bajaron"));
    if (input.desaparecidos.length > 0) {
      rows.push({ cells: ["Dejaron de venderse", "", "", ""], bold: true });
      rows.push(
        ...input.desaparecidos.map((d) => ({
          cells: [`   ${d.producto}`, num(d.cantidadPrev), "0", "-100,0%"],
          cellColors: [null, null, null, DANGER] as Array<{ r: number; g: number; b: number } | null>,
        })),
      );
    }
    table(moverCols, rows);
    paragraph(
      `Solo entran productos que en el período anterior vendieron al menos ${num(input.moversMinBase)} unidades: ` +
        `sin ese piso, pasar de 2 a 6 unidades encabezaría el ranking con un +200%.`,
    );
  }

  // ---------- Desglose por local ----------
  const multiLocal = input.locals.length > 1;
  if (showCosts && multiLocal) {
    sectionTitle("El mismo producto, local por local");
    if (input.locals.length <= 8) {
      const nameW = 150;
      const colW = (W - nameW) / input.locals.length;
      const cols: Col[] = [
        { label: "Producto", w: nameW },
        ...input.locals.map((l) => ({ label: l.name, w: colW, align: "right" as const })),
      ];
      table(
        cols,
        input.items.map((it) => {
          const byLocal = new Map(it.porLocal.map((p) => [p.localId, p.cantidad]));
          return {
            cells: [it.producto, ...input.locals.map((l) => num(byLocal.get(l.id) ?? 0))],
          };
        }),
      );
    } else {
      // Con muchos locales la matriz no entra: se lista en texto los 3 que más venden cada producto.
      table(
        [
          { label: "Producto", w: 180 },
          { label: "Dónde más se vende", w: W - 180 },
        ],
        input.items.map((it) => ({
          cells: [
            it.producto,
            it.porLocal.slice(0, 3).map((p) => `${p.localName}: ${num(p.cantidad)}`).join("   ·   ") || "—",
          ],
        })),
      );
    }
  }

  // ---------- Cierre para socios ----------
  if (showMoney) {
    sectionTitle("Concentración");
    paragraph(
      `${input.totals.productosHasta80} de los ${input.totals.productosDistintos} productos del período hacen el 80% de las ` +
        `unidades vendidas. El top ${input.items.length} de este informe explica el ${pct(input.totals.topParticipacionPct)} del total.`,
    );
  }

  if (showCosts) {
    sectionTitle("Cómo leer estos números");
    paragraph(
      `Los reportes de ${input.sourceLabel} traen cantidades vendidas, no importes por producto. El CMV% y el margen% ` +
        `de cada producto son TEÓRICOS: salen del costo cargado en DataFlow (receta o costo manual) contra el precio de ` +
        `la receta, ${input.ivaIncluded ? "con IVA" : "sin IVA"}. El margen es el complemento del CMV (100% − CMV%), ` +
        `antes de comisiones, impuestos y costos fijos. ` +
        `Hoy hay costo cargado para el ${pct(input.totals.coberturaPct)} de las unidades vendidas; ` +
        `los productos sin costo no suman al CMV promedio y por eso el porcentaje del período mejora a medida que se ` +
        `completa el costeo. Los nombres se agrupan ignorando mayúsculas, acentos y espacios de más, así que ` +
        `"EMPANADA" y "Empanada" cuentan como un solo producto.`,
    );
  }

  footer();
  return doc;
}
