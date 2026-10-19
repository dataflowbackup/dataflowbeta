/**
 * PDFs de Eventos: la propuesta COMERCIAL (lo que ve el cliente) y el detalle INTERNO (costos,
 * rentabilidad y margen de negociación). Dibujados a mano con jsPDF, como el resto de los PDF.
 */
import { jsPDF } from "jspdf";
import { EVENT_IVA_MODE_LABELS, type EventIvaMode, type EventTotals } from "@shared/eventPricing";

export interface EventPdfInput {
  brandName: string;
  name: string;
  customerName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
  guests: number | null;
  version: number;
  status: string;
  validUntil: string | null;
  paymentTerms: string | null;
  clientNotes: string | null;
  internalNotes: string | null;
  ivaMode: EventIvaMode;
  ivaRate: number;
  discountLabel: string | null;
  items: Array<{ key: string; name: string; description?: string | null }>;
  directCosts: Array<{ concept: string; amount: number }>;
  fixedCosts: Array<{ concept: string; amount: number; detail?: string | null }>;
  totals: EventTotals;
}

const money = (n: number) =>
  `${n < -0.004 ? "- " : ""}$ ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n))}`;
const qty = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n);
const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const longDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  const s = dt.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const today = () => new Date().toLocaleDateString("es-AR");

type RGB = [number, number, number];
const INK: RGB = [33, 33, 40];
const MUTED: RGB = [118, 118, 130];
const LINE: RGB = [224, 224, 230];
const ACCENT: RGB = [24, 64, 112]; // azul profundo, sobrio
const GOLD: RGB = [176, 141, 87];
const SOFT: RGB = [246, 246, 249];
const GOOD: RGB = [16, 122, 96];
const BAD: RGB = [190, 45, 45];

function setColor(doc: jsPDF, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function fileSafe(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "evento";
}

// ─── Propuesta comercial ──────────────────────────────────────────────────────

export function buildEventProposalPdf(input: EventPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 48;
  const W = pageW - M * 2;
  const t = input.totals;
  const incl = input.ivaMode === "incluido";
  let y = 0;

  const footer = () => {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.line(M, pageH - 36, pageW - M, pageH - 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, MUTED);
    doc.text(input.brandName, M, pageH - 22);
    doc.text(`Página ${doc.getNumberOfPages()}`, pageW - M, pageH - 22, { align: "right" });
  };
  const ensure = (h: number) => {
    if (y + h > pageH - 56) {
      footer();
      doc.addPage();
      y = M;
    }
  };

  // Encabezado: banda con la marca
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.rect(0, 0, pageW, 92, "F");
  doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.rect(0, 92, pageW, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text(input.brandName, M, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(214, 222, 236);
  doc.text("PROPUESTA DE EVENTO", M, 70);
  doc.text(`Emitida el ${today()}${input.version > 1 ? ` · Versión ${input.version}` : ""}`, pageW - M, 70, { align: "right" });
  y = 128;

  // Título del evento
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setColor(doc, INK);
  const titleLines = doc.splitTextToSize(input.name, W);
  doc.text(titleLines, M, y);
  y += titleLines.length * 20 + 6;

  // Dos columnas: para quién / el evento
  const colW = (W - 24) / 2;
  const block = (x: number, title: string, rows: Array<[string, string | null | undefined]>) => {
    let yy = y;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, GOLD);
    doc.text(title.toUpperCase(), x, yy);
    yy += 14;
    for (const [label, value] of rows) {
      if (!value) continue;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      setColor(doc, MUTED);
      doc.text(label, x, yy);
      doc.setFontSize(10);
      setColor(doc, INK);
      const lines = doc.splitTextToSize(value, colW - 70);
      doc.text(lines, x + 70, yy);
      yy += Math.max(1, lines.length) * 13 + 2;
    }
    return yy;
  };
  const y1 = block(M, "Para", [
    ["Cliente", input.customerName],
    ["Contacto", input.contactName],
    ["Teléfono", input.contactPhone],
    ["Email", input.contactEmail],
  ]);
  const y2 = block(M + colW + 24, "El evento", [
    ["Fecha", longDate(input.eventDate)],
    ["Horario", input.eventTime],
    ["Lugar", input.location],
    ["Invitados", input.guests ? `${input.guests} personas` : null],
  ]);
  y = Math.max(y1, y2) + 16;

  // Tabla de platos
  const cols = [
    { h: "Detalle", w: W - 230, align: "left" as const },
    { h: "Cant.", w: 50, align: "right" as const },
    { h: incl ? "Precio unit." : "Precio unit. (neto)", w: 90, align: "right" as const },
    { h: "Total", w: 90, align: "right" as const },
  ];
  const header = () => {
    doc.setFillColor(SOFT[0], SOFT[1], SOFT[2]);
    doc.rect(M, y, W, 22, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, MUTED);
    let x = M;
    for (const c of cols) {
      if (c.align === "right") doc.text(c.h.toUpperCase(), x + c.w - 8, y + 14, { align: "right" });
      else doc.text(c.h.toUpperCase(), x + 8, y + 14);
      x += c.w;
    }
    y += 22;
  };
  ensure(60);
  header();
  t.items.forEach((it, i) => {
    const src = input.items.find((s) => s.key === it.key);
    const desc = src?.description?.trim();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const nameLines = doc.splitTextToSize(it.name, cols[0].w - 16);
    doc.setFontSize(8);
    const descLines = desc ? doc.splitTextToSize(desc, cols[0].w - 16) : [];
    const h = nameLines.length * 13 + descLines.length * 10 + 12;
    if (y + h > pageH - 56) {
      footer();
      doc.addPage();
      y = M;
      header();
    }
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    if (i > 0) doc.line(M, y, M + W, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    setColor(doc, INK);
    doc.text(nameLines, M + 8, y + 15);
    if (descLines.length) {
      doc.setFontSize(8);
      setColor(doc, MUTED);
      doc.text(descLines, M + 8, y + 15 + nameLines.length * 13);
    }
    doc.setFontSize(10);
    setColor(doc, INK);
    let x = M + cols[0].w;
    doc.text(qty(it.quantity), x + cols[1].w - 8, y + 15, { align: "right" });
    x += cols[1].w;
    doc.text(money(it.unitPriceShown), x + cols[2].w - 8, y + 15, { align: "right" });
    x += cols[2].w;
    doc.setFont("helvetica", "bold");
    doc.text(money(it.lineShown), x + cols[3].w - 8, y + 15, { align: "right" });
    y += h;
  });
  doc.setDrawColor(INK[0], INK[1], INK[2]);
  doc.setLineWidth(0.8);
  doc.line(M, y, M + W, y);
  doc.setLineWidth(0.2);
  y += 16;

  // Totales
  const boxW = 250;
  const bx = M + W - boxW;
  const row = (label: string, value: string, opts?: { bold?: boolean; big?: boolean; color?: RGB }) => {
    ensure(opts?.big ? 34 : 18);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.big ? 13 : 9.5);
    setColor(doc, opts?.color ?? INK);
    doc.text(label, bx, y);
    doc.text(value, bx + boxW, y, { align: "right" });
    y += opts?.big ? 22 : 16;
  };
  row("Subtotal", money(t.subtotalShown));
  if (t.discountNet > 0.004) row(`Descuento${input.discountLabel ? ` (${input.discountLabel})` : ""}`, `- ${money(t.discountShown)}`, { color: GOOD });
  if (input.ivaMode === "discriminado") {
    if (t.discountNet > 0.004) row("Subtotal neto", money(t.netAfterDiscount));
    row(`IVA ${qty(input.ivaRate)}%`, money(t.iva));
  }
  for (const tx of t.taxes.filter((x) => x.chargedToClient)) row(tx.label, money(tx.amount));
  y += 4;
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  ensure(40);
  // El recuadro termina donde termina la tabla: el texto va con 10 pt de aire adentro.
  doc.rect(bx - 12, y - 14, boxW + 12, 32, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL", bx, y + 6);
  doc.text(money(t.totalClient), bx + boxW - 10, y + 6, { align: "right" });
  y += 34;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  setColor(doc, MUTED);
  const notes: string[] = [];
  if (t.perGuest != null) notes.push(`${money(t.perGuest)} por persona`);
  notes.push(input.ivaMode === "incluido" ? "IVA incluido" : input.ivaMode === "discriminado" ? "IVA discriminado" : "Precios finales");
  doc.text(notes.join("  ·  "), bx + boxW, y, { align: "right" });
  y += 28;

  // Condiciones
  const cond: Array<[string, string | null]> = [
    ["Validez de la propuesta", input.validUntil ? `Hasta el ${fmtDate(input.validUntil)}` : null],
    ["Forma de pago", input.paymentTerms],
    ["Observaciones", input.clientNotes],
  ];
  if (cond.some(([, v]) => v)) {
    ensure(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, GOLD);
    doc.text("CONDICIONES", M, y);
    y += 14;
    for (const [label, value] of cond) {
      if (!value) continue;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      setColor(doc, INK);
      const lines = doc.splitTextToSize(value, W - 140);
      ensure(lines.length * 12 + 8);
      doc.text(label, M, y);
      doc.setFont("helvetica", "normal");
      setColor(doc, INK);
      doc.text(lines, M + 140, y);
      y += lines.length * 12 + 6;
    }
  }

  y += 18;
  ensure(30);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  setColor(doc, ACCENT);
  doc.text(`Gracias por elegirnos. — ${input.brandName}`, pageW / 2, y, { align: "center" });

  footer();
  return doc;
}

// ─── Detalle interno ──────────────────────────────────────────────────────────

export function buildEventInternalPdf(input: EventPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 40;
  const W = pageW - M * 2;
  const t = input.totals;
  let y = 0;

  const footer = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setColor(doc, MUTED);
    doc.text(`${input.brandName} · Detalle interno · ${input.name}`, M, pageH - 18);
    doc.text(`Página ${doc.getNumberOfPages()}`, pageW - M, pageH - 18, { align: "right" });
  };
  const ensure = (h: number) => {
    if (y + h > pageH - 40) {
      footer();
      doc.addPage();
      y = M;
    }
  };

  doc.setFillColor(45, 45, 52);
  doc.rect(0, 0, pageW, 70, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(input.name, M, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(210, 210, 218);
  doc.text(
    [input.customerName, longDate(input.eventDate), input.guests ? `${input.guests} invitados` : null, `v${input.version} · ${input.status}`]
      .filter(Boolean)
      .join("  ·  "),
    M,
    50,
  );
  doc.setFillColor(BAD[0], BAD[1], BAD[2]);
  doc.roundedRect(pageW - M - 150, 22, 150, 20, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("USO INTERNO · NO ENVIAR", pageW - M - 75, 35, { align: "center" });
  y = 96;

  // Indicadores
  const kpis: Array<[string, string, RGB?]> = [
    ["Venta neta (sin IVA)", money(t.netAfterDiscount)],
    ["Costos totales", money(t.totalCosts)],
    ["Utilidad", money(t.profit), t.profit >= 0 ? GOOD : BAD],
    ["Margen", pct(t.profitPct), t.profit >= 0 ? GOOD : BAD],
  ];
  const kw = W / kpis.length;
  kpis.forEach(([label, value, color], i) => {
    const x = M + i * kw;
    doc.setFillColor(SOFT[0], SOFT[1], SOFT[2]);
    doc.rect(x + 2, y, kw - 4, 46, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, MUTED);
    doc.text(label, x + 10, y + 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    setColor(doc, color ?? INK);
    doc.text(value, x + 10, y + 34);
  });
  y += 62;

  const section = (title: string) => {
    ensure(36);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(doc, INK);
    doc.text(title, M, y);
    y += 8;
  };
  const table = (
    cols: Array<{ h: string; w: number; right?: boolean }>,
    rows: Array<Array<string>>,
    opts?: { boldLast?: boolean },
  ) => {
    const head = () => {
      doc.setFillColor(45, 45, 52);
      doc.rect(M, y, W, 16, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      let x = M;
      for (const c of cols) {
        if (c.right) doc.text(c.h, x + c.w - 4, y + 11, { align: "right" });
        else doc.text(c.h, x + 4, y + 11);
        x += c.w;
      }
      y += 16;
    };
    ensure(40);
    head();
    rows.forEach((r, ri) => {
      if (y + 14 > pageH - 40) {
        footer();
        doc.addPage();
        y = M;
        head();
      }
      const last = opts?.boldLast && ri === rows.length - 1;
      if (ri % 2 === 1 && !last) {
        doc.setFillColor(248, 248, 250);
        doc.rect(M, y, W, 14, "F");
      }
      if (last) {
        doc.setDrawColor(INK[0], INK[1], INK[2]);
        doc.line(M, y, M + W, y);
      }
      doc.setFont("helvetica", last ? "bold" : "normal");
      doc.setFontSize(7.5);
      setColor(doc, INK);
      let x = M;
      r.forEach((v, i) => {
        const c = cols[i];
        let txt = v;
        while (txt.length > 2 && doc.getTextWidth(txt) > c.w - 8) txt = txt.slice(0, -2) + "…";
        if (c.right) doc.text(txt, x + c.w - 4, y + 10, { align: "right" });
        else doc.text(txt, x + 4, y + 10);
        x += c.w;
      });
      y += 14;
    });
    y += 14;
  };

  section("Platos: precio, costo y margen");
  table(
    [
      { h: "Plato", w: W - 380 },
      { h: "Cant.", w: 40, right: true },
      { h: "Precio neto", w: 70, right: true },
      { h: "Costo unit.", w: 70, right: true },
      { h: "CMV", w: 50, right: true },
      { h: "Venta neta", w: 75, right: true },
      { h: "Costo total", w: 75, right: true },
    ],
    [
      ...t.items.map((i) => [i.name, qty(i.quantity), money(i.unitNet), money(i.unitCost), pct(i.cmvPct), money(i.lineNet), money(i.lineCost)]),
      ["Total", "", "", "", pct(t.netBeforeDiscount > 0 ? (t.cmv / t.netBeforeDiscount) * 100 : null), money(t.netBeforeDiscount), money(t.cmv)],
    ],
    { boldLast: true },
  );

  section("Resultado del evento");
  const res: string[][] = [
    ["Venta neta antes de descuento", money(t.netBeforeDiscount)],
    [`Descuento${input.discountLabel ? ` (${input.discountLabel})` : ""}`, t.discountNet > 0 ? `- ${money(t.discountNet)}` : money(0)],
    ["Venta neta", money(t.netAfterDiscount)],
    ["Costo de mercadería (CMV)", `- ${money(t.cmv)}  (${pct(t.cmvPct)})`],
    ["Margen bruto", money(t.grossMargin)],
    ...input.directCosts.map((c) => [`Costo directo: ${c.concept || "sin nombre"}`, `- ${money(c.amount)}`]),
    ...input.fixedCosts.map((c) => [`Costo fijo: ${c.concept || "sin nombre"}${c.detail ? ` (${c.detail})` : ""}`, `- ${money(c.amount)}`]),
    ...t.taxes.filter((x) => !x.chargedToClient).map((x) => [`Impuesto a cargo: ${x.label}`, `- ${money(x.amount)}`]),
    ["Utilidad del evento", `${money(t.profit)}  (${pct(t.profitPct)})`],
  ];
  table(
    [
      { h: "Concepto", w: W - 170 },
      { h: "Importe", w: 170, right: true },
    ],
    res,
    { boldLast: true },
  );

  section("Lo que paga el cliente");
  table(
    [
      { h: "Concepto", w: W - 170 },
      { h: "Importe", w: 170, right: true },
    ],
    [
      ["Venta neta", money(t.netAfterDiscount)],
      [input.ivaMode === "sin_iva" ? "IVA (no aplica)" : `IVA ${qty(input.ivaRate)}%`, money(t.iva)],
      ...t.taxes.filter((x) => x.chargedToClient).map((x) => [x.label, money(x.amount)]),
      ["Total al cliente", money(t.totalClient)],
    ],
    { boldLast: true },
  );

  section("Para negociar");
  const neg: string[][] = [
    ["Precio por persona", t.perGuest != null ? money(t.perGuest) : "—"],
    ["Costo por persona", t.costPerGuest != null ? money(t.costPerGuest) : "—"],
    [
      "Descuento máximo sin perder plata (sobre el neto)",
      t.maxDiscountNet == null ? "—" : t.maxDiscountNet < 0 ? "Ya pierde sin descuento" : `${money(t.maxDiscountNet)} (${pct(t.maxDiscountPct)})`,
    ],
    ["Modalidad de precios", EVENT_IVA_MODE_LABELS[input.ivaMode]],
  ];
  table(
    [
      { h: "Dato", w: W - 170 },
      { h: "Valor", w: 170, right: true },
    ],
    neg,
  );

  if (input.internalNotes?.trim()) {
    section("Notas internas");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    setColor(doc, INK);
    const lines = doc.splitTextToSize(input.internalNotes, W);
    ensure(lines.length * 11 + 8);
    doc.text(lines, M, y + 6);
    y += lines.length * 11 + 12;
  }

  footer();
  return doc;
}

export function eventPdfFileName(kind: "propuesta" | "interno", name: string, version: number) {
  return `${kind}_${fileSafe(name)}${version > 1 ? `_v${version}` : ""}.pdf`;
}
