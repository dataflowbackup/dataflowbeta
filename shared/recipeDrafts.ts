/**
 * Pizarrón de Recetas (oct-2026) — costeo de las recetas de prueba.
 *
 * Mismas reglas que Carta para que lo que se prueba acá dé lo mismo cuando se envía:
 *   - costo de una línea = cantidad × costo unitario (la merma no entra en el costo, como en Carta);
 *   - una sub-receta cuesta su costo total ÷ rendimiento (sin rendimiento, la tanda entera es 1);
 *   - CMV, margen y markup con `computeRecipeMetrics` y la política de IVA de la receta.
 *
 * Los costos de insumos y sub-recetas reales los da el servidor (`/api/recipe-drafts/cost-sources`)
 * con la misma prioridad que el costeo de Carta, así la pantalla y el envío usan el mismo número.
 */
import { computeRecipeMetrics, type RecipeMetrics } from "./recipePricing";

export const DRAFT_STATUSES = ["borrador", "en_prueba", "aprobada", "enviada", "descartada"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  borrador: "Borrador",
  en_prueba: "En prueba",
  aprobada: "Aprobada",
  enviada: "Enviada a Carta",
  descartada: "Descartada",
};

export type DraftLineType = "supply" | "subrecipe" | "draft" | "temp";

export interface DraftLineInput {
  lineType: DraftLineType;
  supplyId?: number | null;
  subRecipeId?: number | null;
  draftSubId?: number | null;
  tempSupplyId?: number | null;
  quantity: number;
  notes?: string | null;
}

export interface DraftInput {
  id?: number;
  name: string;
  recipeType: "plato" | "sub";
  salePriceWithTax: number;
  removeIvaFromPrice: boolean;
  cmvIdeal: number | null;
  usefulYield: number | null;
  lines: DraftLineInput[];
}

/** Costos vigentes que da el servidor. */
export interface DraftCostSources {
  supplies: Array<{ id: number; name: string; unit: string | null; unitCost: number; rubroName: string | null; active: boolean }>;
  subRecipes: Array<{ id: number; name: string; unit: string | null; unitCost: number; totalCost: number; usefulYield: number | null; active: boolean }>;
  /** Platos de Carta: para traerlos al pizarrón y para Eventos. */
  platos: Array<{
    id: number;
    name: string;
    categoryName: string | null;
    subcategoryName: string | null;
    totalCost: number;
    salePriceWithTax: number;
    removeIvaFromPrice: boolean;
    active: boolean;
  }>;
}

export interface TempSupplyCost {
  id: number;
  name: string;
  unit: string | null;
  unitCost: number;
  linkedSupplyId: number | null;
}

export interface DraftLineCosting {
  label: string;
  unit: string | null;
  unitCost: number;
  lineCost: number;
  /** El ítem ya no existe o no tiene costo: la línea suma $0 y se avisa. */
  missing: boolean;
}

export interface DraftCosting {
  lines: DraftLineCosting[];
  totalCost: number;
  /** Sub-recetas: costo por unidad de rendimiento. Platos: igual al total. */
  unitCost: number;
  metrics: RecipeMetrics | null;
  /** Precio cobrado (con IVA) que daría el CMV ideal, si hay CMV ideal. */
  suggestedGrossPrice: number | null;
  missingLines: number;
}

const IVA_FACTOR = 1.21;

export interface DraftCostContext {
  sources: DraftCostSources;
  tempSupplies: TempSupplyCost[];
  /** Todas las recetas del pizarrón, para resolver las líneas "draft". */
  drafts: DraftInput[];
}

/**
 * Prepara un costeador con memoria. Las sub-recetas del pizarrón que se llaman entre sí en ciclo
 * se cortan en $0 en vez de colgar el cálculo.
 */
export function createDraftCoster(ctx: DraftCostContext) {
  const supplyById = new Map(ctx.sources.supplies.map((s) => [s.id, s]));
  const subById = new Map(ctx.sources.subRecipes.map((s) => [s.id, s]));
  const tempById = new Map(ctx.tempSupplies.map((t) => [t.id, t]));
  const draftById = new Map(ctx.drafts.filter((d) => d.id != null).map((d) => [d.id!, d]));
  const memo = new Map<number, DraftCosting>();
  const open = new Set<number>();

  const costLine = (line: DraftLineInput): DraftLineCosting => {
    const q = Number(line.quantity) || 0;
    const make = (label: string, unit: string | null, unitCost: number, missing = false): DraftLineCosting => ({
      label,
      unit,
      unitCost,
      lineCost: unitCost * q,
      missing,
    });

    if (line.lineType === "supply") {
      const s = line.supplyId != null ? supplyById.get(line.supplyId) : undefined;
      return s ? make(s.name, s.unit, s.unitCost, !(s.unitCost > 0)) : make("(insumo eliminado)", null, 0, true);
    }
    if (line.lineType === "subrecipe") {
      const s = line.subRecipeId != null ? subById.get(line.subRecipeId) : undefined;
      return s ? make(s.name, s.unit, s.unitCost, !(s.unitCost > 0)) : make("(sub-receta eliminada)", null, 0, true);
    }
    if (line.lineType === "temp") {
      const t = line.tempSupplyId != null ? tempById.get(line.tempSupplyId) : undefined;
      if (!t) return make("(insumo de prueba eliminado)", null, 0, true);
      // Ya vinculado a un insumo real: manda el costo real.
      const linked = t.linkedSupplyId != null ? supplyById.get(t.linkedSupplyId) : undefined;
      const unitCost = linked && linked.unitCost > 0 ? linked.unitCost : t.unitCost;
      return make(t.name, t.unit, unitCost, !(unitCost > 0));
    }
    // "draft": otra receta del pizarrón
    const d = line.draftSubId != null ? draftById.get(line.draftSubId) : undefined;
    if (!d) return make("(receta del pizarrón eliminada)", null, 0, true);
    const sub = costDraft(d);
    return make(d.name, null, sub.unitCost, !(sub.unitCost > 0));
  };

  const costDraft = (draft: DraftInput): DraftCosting => {
    if (draft.id != null) {
      const cached = memo.get(draft.id);
      if (cached) return cached;
      if (open.has(draft.id)) {
        return { lines: [], totalCost: 0, unitCost: 0, metrics: null, suggestedGrossPrice: null, missingLines: 0 };
      }
      open.add(draft.id);
    }

    const lines = draft.lines.map(costLine);
    const totalCost = lines.reduce((acc, l) => acc + l.lineCost, 0);
    const y = Number(draft.usefulYield) || 0;
    const isSub = draft.recipeType === "sub";
    const unitCost = isSub && y > 0 ? totalCost / y : totalCost;

    let metrics: RecipeMetrics | null = null;
    let suggestedGrossPrice: number | null = null;
    if (!isSub) {
      metrics = computeRecipeMetrics({
        grossPrice: Number(draft.salePriceWithTax) || 0,
        totalCost,
        removeIva: draft.removeIvaFromPrice !== false,
      });
      const ideal = Number(draft.cmvIdeal) || 0;
      if (ideal > 0 && totalCost > 0) {
        // CMV = costo / precio de referencia → referencia = costo / CMV; con IVA quitado, se lo devuelve.
        const reference = totalCost / (ideal / 100);
        suggestedGrossPrice = draft.removeIvaFromPrice !== false ? reference * IVA_FACTOR : reference;
      }
    }

    const result: DraftCosting = {
      lines,
      totalCost,
      unitCost,
      metrics,
      suggestedGrossPrice,
      missingLines: lines.filter((l) => l.missing).length,
    };
    if (draft.id != null) {
      open.delete(draft.id);
      memo.set(draft.id, result);
    }
    return result;
  };

  return { costDraft, costLine };
}

/** IDs de sub-recetas del pizarrón que una receta usa (directo), para validar ciclos y envíos. */
export function draftSubIdsOf(draft: Pick<DraftInput, "lines">): number[] {
  return draft.lines.filter((l) => l.lineType === "draft" && l.draftSubId != null).map((l) => l.draftSubId!);
}

/** true si agregar `candidateSubId` a la receta `draftId` crearía un ciclo. */
export function wouldCreateCycle(draftId: number | undefined, candidateSubId: number, drafts: DraftInput[]): boolean {
  if (draftId == null) return false;
  if (candidateSubId === draftId) return true;
  const byId = new Map(drafts.filter((d) => d.id != null).map((d) => [d.id!, d]));
  const seen = new Set<number>();
  const stack = [candidateSubId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === draftId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const d = byId.get(id);
    if (d) stack.push(...draftSubIdsOf(d));
  }
  return false;
}
