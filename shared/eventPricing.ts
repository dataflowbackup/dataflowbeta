/**
 * Eventos (oct-2026) — cálculo de una propuesta.
 *
 * Orden de las cuentas (lo recomendó Claude y el usuario lo delegó, 19-oct-2026), el habitual en
 * una factura:
 *   1. Subtotal = Σ cantidad × precio unitario.
 *   2. Se lleva a NETO (sin IVA). Con precios "IVA incluido" se divide por 1,21.
 *   3. El descuento se aplica sobre el neto.
 *   4. Sobre el neto con descuento se calculan el IVA y los demás impuestos.
 *
 * El IVA y los impuestos que se le cobran al cliente pasan de largo: no son ingreso. Los que paga
 * la empresa (IIBB, por ejemplo) restan de la rentabilidad.
 */

export type EventIvaMode = "incluido" | "discriminado" | "sin_iva";
export type EventStatus = "borrador" | "enviada" | "aceptada" | "rechazada";

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
};

export const EVENT_IVA_MODE_LABELS: Record<EventIvaMode, string> = {
  incluido: "Precios con IVA incluido",
  discriminado: "Precios + IVA (discriminado)",
  sin_iva: "Sin IVA",
};

export interface EventItem {
  key: string;
  /** "recipe" = plato de Carta, "draft" = receta del Pizarrón, "manual" = ítem cargado a mano. */
  sourceType: "recipe" | "draft" | "manual";
  recipeId?: number | null;
  draftId?: number | null;
  name: string;
  description?: string | null;
  quantity: number;
  /** Precio unitario en los términos del evento: con IVA si ivaMode es "incluido", neto si no. */
  unitPrice: number;
  /** Costo unitario SIN IVA. Es foto: se actualiza mientras el evento es borrador. */
  unitCost: number;
}

export interface EventDirectCost {
  key: string;
  concept: string;
  amount: number;
}

export interface EventFixedCost {
  key: string;
  concept: string;
  financialGroupId?: number | null;
  categoryId?: number | null;
  /** "manual": se carga el monto. "promedio": promedio mensual real × la porción asignada. */
  mode: "manual" | "promedio";
  monthlyAverage?: number | null;
  /** Porción del mes que se le asigna al evento, en % (ej: 1 día de 30 = 3,33). */
  sharePct?: number | null;
  months?: number | null;
  amount: number;
}

export interface EventTax {
  key: string;
  name: string;
  taxId?: number | null;
  /** "pct": alícuota sobre el neto con descuento. "amount": monto fijo. */
  mode: "pct" | "amount";
  rate?: number | null;
  amount?: number | null;
  /** true: se le suma al cliente. false: lo paga la empresa y resta de la rentabilidad. */
  chargedToClient: boolean;
}

export interface EventPricingInput {
  ivaMode: EventIvaMode;
  ivaRate: number;
  discountType: "pct" | "amount";
  discountValue: number;
  guests: number | null;
  items: EventItem[];
  directCosts: EventDirectCost[];
  fixedCosts: EventFixedCost[];
  taxes: EventTax[];
}

export interface EventItemResult {
  key: string;
  name: string;
  quantity: number;
  /** Precio unitario como lo ve el cliente (con IVA si "incluido"). */
  unitPriceShown: number;
  lineShown: number;
  unitNet: number;
  lineNet: number;
  unitCost: number;
  lineCost: number;
  /** CMV del ítem sobre su neto. */
  cmvPct: number | null;
  /** Margen del ítem sobre su neto (sin descuento ni fijos). */
  marginPct: number | null;
}

export interface EventTaxResult {
  key: string;
  name: string;
  amount: number;
  chargedToClient: boolean;
  label: string;
}

export interface EventTotals {
  items: EventItemResult[];
  /** Lo que ve el cliente (en los términos del ivaMode). */
  subtotalShown: number;
  discountShown: number;
  /** Neto sin IVA, antes y después del descuento. */
  netBeforeDiscount: number;
  discountNet: number;
  netAfterDiscount: number;
  iva: number;
  taxes: EventTaxResult[];
  taxesToClient: number;
  totalClient: number;
  perGuest: number | null;
  // ── Interno ──
  cmv: number;
  cmvPct: number | null;
  grossMargin: number;
  directCosts: number;
  fixedCosts: number;
  internalTaxes: number;
  totalCosts: number;
  profit: number;
  profitPct: number | null;
  costPerGuest: number | null;
  /** Descuento máximo (neto) antes de perder plata. Negativo = ya pierde sin descuento. */
  maxDiscountNet: number | null;
  maxDiscountPct: number | null;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function computeEventTotals(input: EventPricingInput): EventTotals {
  const k = input.ivaMode === "sin_iva" ? 1 : 1 + n(input.ivaRate) / 100;
  const pricesIncludeIva = input.ivaMode === "incluido";
  const toNet = (v: number) => (pricesIncludeIva ? v / k : v);

  const items: EventItemResult[] = input.items.map((it) => {
    const quantity = n(it.quantity);
    const unitPriceShown = n(it.unitPrice);
    const unitNet = toNet(unitPriceShown);
    const unitCost = n(it.unitCost);
    const lineNet = unitNet * quantity;
    const lineCost = unitCost * quantity;
    return {
      key: it.key,
      name: it.name,
      quantity,
      unitPriceShown,
      lineShown: unitPriceShown * quantity,
      unitNet,
      lineNet,
      unitCost,
      lineCost,
      cmvPct: unitNet > 0 ? (unitCost / unitNet) * 100 : null,
      marginPct: unitNet > 0 ? ((unitNet - unitCost) / unitNet) * 100 : null,
    };
  });

  const subtotalShown = items.reduce((a, i) => a + i.lineShown, 0);
  const netBeforeDiscount = items.reduce((a, i) => a + i.lineNet, 0);

  // El descuento en $ se carga en los mismos términos que los precios (con IVA si "incluido").
  const rawDiscountNet =
    input.discountType === "pct" ? netBeforeDiscount * (n(input.discountValue) / 100) : toNet(n(input.discountValue));
  const discountNet = Math.max(0, Math.min(rawDiscountNet, netBeforeDiscount));
  const netAfterDiscount = netBeforeDiscount - discountNet;
  const discountShown = pricesIncludeIva ? discountNet * k : discountNet;

  const iva = input.ivaMode === "sin_iva" ? 0 : netAfterDiscount * (k - 1);

  const taxes: EventTaxResult[] = input.taxes.map((t) => {
    const amount = t.mode === "pct" ? netAfterDiscount * (n(t.rate) / 100) : n(t.amount);
    const fmtRate = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n(t.rate));
    return {
      key: t.key,
      name: t.name,
      amount,
      chargedToClient: !!t.chargedToClient,
      label: t.mode === "pct" ? `${t.name} (${fmtRate}%)` : t.name,
    };
  });
  const taxesToClient = taxes.filter((t) => t.chargedToClient).reduce((a, t) => a + t.amount, 0);
  const internalTaxes = taxes.filter((t) => !t.chargedToClient).reduce((a, t) => a + t.amount, 0);

  const totalClient = netAfterDiscount + iva + taxesToClient;
  const guests = n(input.guests) > 0 ? n(input.guests) : null;

  const cmv = items.reduce((a, i) => a + i.lineCost, 0);
  const directCosts = input.directCosts.reduce((a, c) => a + n(c.amount), 0);
  const fixedCosts = input.fixedCosts.reduce((a, c) => a + n(c.amount), 0);
  const totalCosts = cmv + directCosts + fixedCosts + internalTaxes;
  const profit = netAfterDiscount - totalCosts;

  // Descuento máximo: el neto mínimo que cubre todos los costos. Los impuestos internos en % se
  // achican con el neto, por eso se despeja: neto × (1 − t) = costos fijos en $.
  const internalPct = input.taxes
    .filter((t) => !t.chargedToClient && t.mode === "pct")
    .reduce((a, t) => a + n(t.rate) / 100, 0);
  const internalFixed = input.taxes.filter((t) => !t.chargedToClient && t.mode === "amount").reduce((a, t) => a + n(t.amount), 0);
  let maxDiscountNet: number | null = null;
  if (internalPct < 1 && netBeforeDiscount > 0) {
    const minNet = (cmv + directCosts + fixedCosts + internalFixed) / (1 - internalPct);
    maxDiscountNet = netBeforeDiscount - minNet;
  }

  return {
    items,
    subtotalShown,
    discountShown,
    netBeforeDiscount,
    discountNet,
    netAfterDiscount,
    iva,
    taxes,
    taxesToClient,
    totalClient,
    perGuest: guests ? totalClient / guests : null,
    cmv,
    cmvPct: netAfterDiscount > 0 ? (cmv / netAfterDiscount) * 100 : null,
    grossMargin: netAfterDiscount - cmv,
    directCosts,
    fixedCosts,
    internalTaxes,
    totalCosts,
    profit,
    profitPct: netAfterDiscount > 0 ? (profit / netAfterDiscount) * 100 : null,
    costPerGuest: guests ? totalCosts / guests : null,
    maxDiscountNet,
    maxDiscountPct: maxDiscountNet != null && netBeforeDiscount > 0 ? (maxDiscountNet / netBeforeDiscount) * 100 : null,
  };
}

/** Precio unitario por defecto de un plato en los términos del evento. */
export function defaultUnitPrice(grossPrice: number, ivaMode: EventIvaMode, ivaRate: number): number {
  const g = n(grossPrice);
  if (ivaMode === "incluido") return g;
  return g / (1 + n(ivaRate) / 100);
}

/** Cambiar el modo de IVA sin cambiar lo que se cobra: convierte los precios cargados. */
export function convertUnitPrice(price: number, from: EventIvaMode, to: EventIvaMode, ivaRate: number): number {
  const k = 1 + n(ivaRate) / 100;
  const fromIncl = from === "incluido";
  const toIncl = to === "incluido";
  if (fromIncl === toIncl) return n(price);
  return fromIncl ? n(price) / k : n(price) * k;
}
