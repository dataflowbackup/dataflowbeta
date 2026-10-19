/**
 * Pizarrón de Recetas — datos y costeo del lado del navegador. Lo usan el listado, el editor y
 * Eventos (que costea platos del pizarrón).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createDraftCoster,
  type DraftCostSources,
  type DraftInput,
  type DraftLineInput,
  type DraftStatus,
  type TempSupplyCost,
} from "@shared/recipeDrafts";

export interface DraftLineRow {
  id: number;
  draftId: number;
  sortOrder: number | null;
  lineType: DraftLineInput["lineType"];
  supplyId: number | null;
  subRecipeId: number | null;
  draftSubId: number | null;
  tempSupplyId: number | null;
  quantity: number | string;
  notes: string | null;
}

export interface DraftRow {
  id: number;
  name: string;
  recipeType: "plato" | "sub";
  status: DraftStatus;
  categoryId: number | null;
  subcategoryId: number | null;
  description: string | null;
  preparationSteps: string | null;
  notes: string | null;
  salePriceWithTax: number | string | null;
  removeIvaFromPrice: boolean | null;
  cmvIdeal: number | string | null;
  usefulYield: number | string | null;
  yieldUnit: string | null;
  sourceRecipeId: number | null;
  promotedRecipeId: number | null;
  promotedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lines: DraftLineRow[];
}

export interface TempSupplyRow {
  id: number;
  name: string;
  unitOfMeasureId: number | null;
  unit: string | null;
  unitCost: number;
  notes: string | null;
  linkedSupplyId: number | null;
  linkedSupplyName: string | null;
  usedIn: number;
}

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const numOrNull = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

export function draftRowToInput(d: DraftRow): DraftInput {
  return {
    id: d.id,
    name: d.name,
    recipeType: d.recipeType === "sub" ? "sub" : "plato",
    salePriceWithTax: num(d.salePriceWithTax),
    removeIvaFromPrice: d.removeIvaFromPrice !== false,
    cmvIdeal: numOrNull(d.cmvIdeal),
    usefulYield: numOrNull(d.usefulYield),
    lines: d.lines.map((l) => ({
      lineType: l.lineType,
      supplyId: l.supplyId,
      subRecipeId: l.subRecipeId,
      draftSubId: l.draftSubId,
      tempSupplyId: l.tempSupplyId,
      quantity: num(l.quantity),
      notes: l.notes,
    })),
  };
}

export function tempRowsToCosts(rows: TempSupplyRow[]): TempSupplyCost[] {
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    unit: t.unit,
    unitCost: num(t.unitCost),
    linkedSupplyId: t.linkedSupplyId,
  }));
}

/** Todo lo que hace falta para costear recetas del pizarrón, ya cargado. */
export function useDraftData() {
  const sourcesQ = useQuery<DraftCostSources>({ queryKey: ["/api/recipe-drafts/cost-sources"] });
  const draftsQ = useQuery<DraftRow[]>({ queryKey: ["/api/recipe-drafts"] });
  const tempQ = useQuery<TempSupplyRow[]>({ queryKey: ["/api/recipe-draft-supplies"] });

  const sources = sourcesQ.data;
  const drafts = draftsQ.data ?? [];
  const tempSupplies = tempQ.data ?? [];

  const coster = useMemo(() => {
    if (!sources) return null;
    return createDraftCoster({
      sources,
      tempSupplies: tempRowsToCosts(tempSupplies),
      drafts: drafts.map(draftRowToInput),
    });
  }, [sources, drafts, tempSupplies]);

  return {
    sources,
    drafts,
    tempSupplies,
    coster,
    isLoading: sourcesQ.isLoading || draftsQ.isLoading || tempQ.isLoading,
    error: (sourcesQ.error || draftsQ.error || tempQ.error) as Error | null,
  };
}

/** Claves a invalidar después de cualquier cambio en el pizarrón. */
export const DRAFT_QUERY_KEYS = [["/api/recipe-drafts"], ["/api/recipe-draft-supplies"], ["/api/recipe-drafts/cost-sources"]];
