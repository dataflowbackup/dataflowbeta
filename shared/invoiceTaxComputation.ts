/** Cálculo unificado de impuestos de factura (ítem + total comprobante) para cliente y servidor. */

export type TaxLike = {
  id: number;
  percentage: string | number;
  type?: string | null;
};

export function isInternalTaxType(type: string | null | undefined): boolean {
  const t = String(type ?? "").toLowerCase();
  return t === "interno" || t === "impuesto_interno";
}

/** Solo IVA por línea (alícuota distinta por insumo). */
export function isLineEligibleTaxType(type: string | null | undefined): boolean {
  return String(type ?? "").toLowerCase() === "iva";
}

export function roundMoney2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** Reparte el descuento global en proporción al subtotal bruto de cada línea. */
export function computeDiscountedLineSubtotals(lineSubtotals: number[], discount: number): number[] {
  const gross = lineSubtotals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const disc = Math.max(0, Number(discount) || 0);
  if (gross <= 0) return lineSubtotals.map(() => 0);
  const net = Math.max(0, gross - disc);
  const factor = net / gross;
  return lineSubtotals.map((s) => {
    const v = Number(s) || 0;
    return Math.max(0, roundMoney2(v * factor));
  });
}

export type InvoiceTaxRowPersist = { taxId: number; baseAmount: number; taxAmount: number };

export type InvoiceTaxComputationInput = {
  items: Array<{ subtotal: unknown; taxId?: unknown }>;
  discount: number;
  invoiceLevelTaxes: Array<{ taxId: unknown; baseAmount?: unknown; taxAmount?: unknown }>;
  taxesById: Map<number, TaxLike>;
};

export type InvoiceTaxComputationResult = {
  rows: InvoiceTaxRowPersist[];
  lineTaxTotal: number;
  invoiceLevelTaxTotal: number;
  taxGrandTotal: number;
  itemsSubtotal: number;
  subtotalAfterDiscount: number;
};

function addToAgg(
  agg: Map<number, { baseAmount: number; taxAmount: number }>,
  taxId: number,
  baseAmount: number,
  taxAmount: number,
) {
  const cur = agg.get(taxId) ?? { baseAmount: 0, taxAmount: 0 };
  cur.baseAmount += baseAmount;
  cur.taxAmount += taxAmount;
  agg.set(taxId, cur);
}

/**
 * Combina impuestos por ítem (solo tipo IVA) + impuestos declarados al total del comprobante.
 * Los montos se fusionan por taxId para persistir en invoice_taxes.
 */
export function computeInvoiceTaxes(input: InvoiceTaxComputationInput): InvoiceTaxComputationResult {
  const lineSubtotals = input.items.map((i) => parseFloat(String(i.subtotal ?? 0)) || 0);
  const itemsSubtotal = roundMoney2(lineSubtotals.reduce((a, b) => a + b, 0));
  const discountNum = Math.max(0, Number(input.discount) || 0);
  const subtotalAfterDiscount = roundMoney2(Math.max(0, itemsSubtotal - discountNum));

  const discountedLines = computeDiscountedLineSubtotals(lineSubtotals, discountNum);

  const merged = new Map<number, { baseAmount: number; taxAmount: number }>();

  let lineTaxTotal = 0;
  input.items.forEach((item, idx) => {
    const tidRaw = item.taxId;
    const tid =
      tidRaw != null && tidRaw !== ""
        ? typeof tidRaw === "number"
          ? tidRaw
          : parseInt(String(tidRaw), 10)
        : NaN;
    if (!Number.isFinite(tid) || tid <= 0) return;

    const tax = input.taxesById.get(tid);
    if (!tax || !isLineEligibleTaxType(tax.type)) return;

    const base = discountedLines[idx] ?? 0;
    const pct = parseFloat(String(tax.percentage)) || 0;
    const amt = roundMoney2((base * pct) / 100);
    lineTaxTotal += amt;
    addToAgg(merged, tid, base, amt);
  });
  lineTaxTotal = roundMoney2(lineTaxTotal);

  let invoiceLevelTaxTotal = 0;
  for (const row of input.invoiceLevelTaxes) {
    const tid = typeof row.taxId === "number" ? row.taxId : parseInt(String(row.taxId ?? ""), 10);
    if (!Number.isFinite(tid) || tid <= 0) continue;

    const tax = input.taxesById.get(tid);
    if (!tax) continue;

    let base: number;
    let amt: number;

    if (isInternalTaxType(tax.type)) {
      base = subtotalAfterDiscount;
      amt = roundMoney2(parseFloat(String(row.taxAmount ?? 0)) || 0);
    } else {
      base = subtotalAfterDiscount;
      const pct = parseFloat(String(tax.percentage)) || 0;
      amt = roundMoney2((base * pct) / 100);
    }

    invoiceLevelTaxTotal += amt;
    addToAgg(merged, tid, base, amt);
  }
  invoiceLevelTaxTotal = roundMoney2(invoiceLevelTaxTotal);

  const rows: InvoiceTaxRowPersist[] = Array.from(merged.entries()).map(([taxId, v]) => ({
    taxId,
    baseAmount: roundMoney2(v.baseAmount),
    taxAmount: roundMoney2(v.taxAmount),
  }));

  const taxGrandTotal = roundMoney2(rows.reduce((s, r) => s + r.taxAmount, 0));

  return {
    rows,
    lineTaxTotal,
    invoiceLevelTaxTotal,
    taxGrandTotal,
    itemsSubtotal,
    subtotalAfterDiscount,
  };
}
