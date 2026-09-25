/**
 * Estado de Resultado Económico — catálogos y fórmulas compartidas entre el browser y el servidor.
 *
 * Criterio de IVA (usuario, 25-sep-2026, revisa el "todo en bruto" del 21-sep): las ventas
 * FACTURADAS entran sin IVA (÷1,21) porque ese 21% es de AFIP; las no facturadas van completas.
 * Las compras siguen con IVA. La línea "IVA" de impuestos se muestra pero no resta: ya se descontó
 * de las ventas.
 */

// ── Impuestos ────────────────────────────────────────────────────────────────

export type TaxKind = "iva" | "iibb" | "ganancias" | "credito" | "debito" | "cheque";
/**
 * Cómo se determina el importe de un impuesto:
 *  - manual:     se escribe a mano (sale de la liquidación).
 *  - calculado:  alícuota × ventas del mes por medio de pago, pudiendo excluir medios.
 *  - facturado:  alícuota × ventas FACTURADAS netas de IVA (como lo liquida AFIP).
 *  - categorias: la suma de los movimientos de extractos de las categorías elegidas. Esas
 *                categorías dejan de restar en Gastos Operativos y pasan a restar acá.
 */
export type TaxMode = "manual" | "calculado" | "facturado" | "categorias";

export const TAX_MODE_LABELS: Record<TaxMode, string> = {
  calculado: "Sobre medios de pago",
  facturado: "Sobre ventas facturadas netas",
  categorias: "Desde categorías de extractos",
  manual: "A mano",
};

export function isTaxMode(v: unknown): v is TaxMode {
  return v === "manual" || v === "calculado" || v === "facturado" || v === "categorias";
}

export interface TaxKindDef {
  kind: TaxKind;
  label: string;
  /** Modos que admite, el primero es el sugerido al crear la fila. */
  modes: TaxMode[];
  /** Alícuota sugerida al crear la fila, en %. */
  defaultRatePct: number;
  /**
   * Dónde pega en el Estado de Resultado. Los impuestos sobre ingresos y movimientos son gasto
   * operativo y restan ARRIBA; Ganancias se calcula sobre el resultado, así que resta al final.
   * Mezclarlos haría que Ganancias se calcule sobre una base que ya lo incluye.
   */
  placement: "operativo" | "sobre_resultado";
  help: string;
}

export const TAX_KINDS: TaxKindDef[] = [
  {
    kind: "iva",
    label: "IVA",
    modes: ["manual"],
    defaultRatePct: 21,
    placement: "operativo",
    help: "El saldo que efectivamente se paga a la AFIP en el mes. Se carga a mano porque sale de la liquidación, no de las ventas.",
  },
  {
    kind: "iibb",
    label: "Ingresos Brutos",
    modes: ["facturado", "calculado", "manual"],
    defaultRatePct: 3,
    placement: "operativo",
    help: "Sobre las ventas facturadas netas de IVA (como lo liquida AFIP), sobre los medios de pago que elijas (ventas del sistema + manuales), o a mano.",
  },
  {
    kind: "credito",
    label: "Impuesto al Crédito",
    modes: ["categorias", "manual"],
    defaultRatePct: 0,
    placement: "operativo",
    help: "Sale de las categorías de los extractos donde se registra (o se carga a mano). Esas categorías dejan de restar en Gastos Operativos para no contarlas dos veces.",
  },
  {
    kind: "debito",
    label: "Impuesto al Débito",
    modes: ["categorias", "manual"],
    defaultRatePct: 0,
    placement: "operativo",
    help: "Sale de las categorías de los extractos donde se registra (o se carga a mano). Esas categorías dejan de restar en Gastos Operativos para no contarlas dos veces.",
  },
  {
    kind: "cheque",
    label: "Impuesto al Cheque",
    modes: ["manual"],
    defaultRatePct: 0,
    placement: "operativo",
    help: "Se carga a mano.",
  },
  {
    kind: "ganancias",
    label: "Impuesto a las Ganancias",
    modes: ["manual"],
    defaultRatePct: 0,
    placement: "sobre_resultado",
    help: "Se carga a mano y resta DESPUÉS del resultado antes de impuestos, porque se calcula sobre él.",
  },
];

export const TAX_KIND_BY_KEY: Record<TaxKind, TaxKindDef> = Object.fromEntries(
  TAX_KINDS.map((t) => [t.kind, t]),
) as Record<TaxKind, TaxKindDef>;

export function isTaxKind(v: unknown): v is TaxKind {
  return typeof v === "string" && TAX_KINDS.some((t) => t.kind === v);
}

/** Base imponible de IIBB "sobre ventas facturadas": las facturadas del mes sin el IVA (÷1,21). */
export const IVA_FACTOR = 1.21;
export function netOfIva(bruto: number): number {
  return bruto / IVA_FACTOR;
}

/**
 * Importe de un impuesto calculado: alícuota sobre las ventas de los medios de pago que NO están
 * excluidos. Devuelve también la base, para poder mostrar sobre qué se calculó.
 */
export function computeTaxAmount(input: {
  mode: TaxMode;
  ratePct: number;
  manualAmount: number;
  /** Ventas del mes desagregadas por medio de pago. Base del modo "calculado". */
  salesByPaymentMethod: Array<{ method: string; amount: number }>;
  excludedPaymentMethods: string[];
  /** Ventas facturadas netas de IVA. Base del modo "facturado". */
  invoicedNet?: number;
  /** Suma de los movimientos de las categorías elegidas. Importe del modo "categorias". */
  categoriesTotal?: number;
}): { amount: number; base: number } {
  if (input.mode === "manual") return { amount: input.manualAmount || 0, base: 0 };
  if (input.mode === "categorias") return { amount: input.categoriesTotal || 0, base: 0 };
  if (input.mode === "facturado") {
    const base = input.invoicedNet || 0;
    return { amount: (base * (input.ratePct || 0)) / 100, base };
  }
  const excluidos = new Set(input.excludedPaymentMethods.map((m) => m.trim().toLowerCase()));
  const base = input.salesByPaymentMethod
    .filter((s) => !excluidos.has(s.method.trim().toLowerCase()))
    .reduce((acc, s) => acc + (s.amount || 0), 0);
  return { amount: (base * (input.ratePct || 0)) / 100, base };
}

// ── Ventas manuales ──────────────────────────────────────────────────────────

/**
 * Medios de pago genéricos para las ventas manuales. El `value` es EXACTAMENTE el nombre con que
 * FUDO los informa: así, cuando un impuesto deja "Efectivo" afuera, quedan afuera juntos el
 * efectivo de FUDO y el de las ventas manuales.
 */
export const MANUAL_SALE_PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: "Efectivo", label: "Efectivo" },
  { value: "Tarj. Débito", label: "Tarjeta de Débito" },
  { value: "Tarj. Crédito", label: "Tarjeta de Crédito" },
  { value: "Transferencia", label: "Transferencia" },
  { value: "Qr", label: "QR / Mercado Pago" },
  { value: "Cta. Cte.", label: "Cuenta Corriente" },
  { value: "Otro", label: "Otro" },
];

/** Nombre a mostrar de un medio de pago guardado (los viejos, de texto libre, se muestran tal cual). */
export function paymentMethodLabel(value: string | null | undefined): string {
  if (!value) return "Sin especificar";
  return MANUAL_SALE_PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;
}

// ── Comisiones ───────────────────────────────────────────────────────────────

/**
 * Las que el usuario nombró explícitamente. `concept` guarda esta clave para las conocidas y el
 * nombre libre para las que se agreguen, así el índice único sirve para las dos.
 */
export const COMMISSION_PRESETS: Array<{ concept: string; label: string }> = [
  { concept: "rappi", label: "Rappi" },
  { concept: "pedidos_ya", label: "Pedidos Ya" },
  { concept: "mp_posnet", label: "Mercado Pago Posnet" },
  { concept: "mp_delivery", label: "Mercado Pago Delivery" },
  { concept: "nave_debito", label: "Nave Débito" },
  { concept: "nave_credito", label: "Nave Crédito" },
  { concept: "payway_debito", label: "Payway Débito" },
  { concept: "payway_credito", label: "Payway Crédito" },
];

const COMMISSION_LABEL_BY_CONCEPT = new Map(COMMISSION_PRESETS.map((c) => [c.concept, c.label]));

/** Nombre a mostrar: el del catálogo si es una conocida, o el texto tal cual si es agregada. */
export function commissionLabel(concept: string): string {
  return COMMISSION_LABEL_BY_CONCEPT.get(concept) ?? concept;
}

/** Una comisión agregada por el usuario no puede pisar una clave del catálogo. */
export function isReservedCommissionConcept(concept: string): boolean {
  return COMMISSION_LABEL_BY_CONCEPT.has(concept.trim().toLowerCase());
}
