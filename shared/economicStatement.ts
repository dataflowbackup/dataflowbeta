/**
 * Estado de Resultado Económico — catálogos y fórmulas compartidas entre el browser y el servidor.
 *
 * Todo el módulo trabaja EN BRUTO (con IVA), decisión del usuario del 21-sep-2026: las ventas y
 * las compras entran con IVA incluido y el IVA a pagar figura como una línea más de impuestos que
 * resta. Es el mismo criterio con el que venía funcionando el módulo, así que no hay ninguna base
 * histórica que migrar.
 */

// ── Impuestos ────────────────────────────────────────────────────────────────

export type TaxKind = "iva" | "iibb" | "ganancias" | "credito" | "debito" | "cheque";
export type TaxMode = "manual" | "calculado";

export interface TaxKindDef {
  kind: TaxKind;
  label: string;
  /** Si admite el modo "calculado" sobre las ventas. Los demás son siempre a mano. */
  calculable: boolean;
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
    calculable: false,
    defaultRatePct: 21,
    placement: "operativo",
    help: "El saldo que efectivamente se paga a la AFIP en el mes. Se carga a mano porque sale de la liquidación, no de las ventas.",
  },
  {
    kind: "iibb",
    label: "Ingresos Brutos",
    calculable: true,
    defaultRatePct: 3,
    placement: "operativo",
    help: "Se calcula sobre las ventas. Podés dejar medios de pago afuera del cálculo, o cargar el importe a mano.",
  },
  {
    kind: "credito",
    label: "Impuesto al Crédito",
    calculable: true,
    defaultRatePct: 0.6,
    placement: "operativo",
    help: "Se calcula sobre las acreditaciones. Podés dejar medios de pago afuera (el efectivo no acredita en cuenta), o cargarlo a mano.",
  },
  {
    kind: "debito",
    label: "Impuesto al Débito",
    calculable: false,
    defaultRatePct: 0.6,
    placement: "operativo",
    help: "Se carga a mano: depende de los débitos de la cuenta, no de las ventas.",
  },
  {
    kind: "cheque",
    label: "Impuesto al Cheque",
    calculable: false,
    defaultRatePct: 0,
    placement: "operativo",
    help: "Se carga a mano.",
  },
  {
    kind: "ganancias",
    label: "Impuesto a las Ganancias",
    calculable: false,
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

/**
 * Importe de un impuesto calculado: alícuota sobre las ventas de los medios de pago que NO están
 * excluidos. Devuelve también la base, para poder mostrar sobre qué se calculó.
 */
export function computeTaxAmount(input: {
  mode: TaxMode;
  ratePct: number;
  manualAmount: number;
  /** Ventas del mes desagregadas por medio de pago. */
  salesByPaymentMethod: Array<{ method: string; amount: number }>;
  excludedPaymentMethods: string[];
}): { amount: number; base: number } {
  if (input.mode === "manual") return { amount: input.manualAmount || 0, base: 0 };
  const excluidos = new Set(input.excludedPaymentMethods.map((m) => m.trim().toLowerCase()));
  const base = input.salesByPaymentMethod
    .filter((s) => !excluidos.has(s.method.trim().toLowerCase()))
    .reduce((acc, s) => acc + (s.amount || 0), 0);
  return { amount: (base * (input.ratePct || 0)) / 100, base };
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
