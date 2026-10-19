/**
 * Pizarrón de Recetas — lectura y escritura. El costeo vive en `shared/recipeDrafts.ts`.
 *
 * Regla del módulo: NADA de acá toca `recipes`, `recipe_ingredients` ni `supplies`, salvo el envío
 * a Carta (`promoteDraft`), que el usuario dispara a mano y queda en el log de auditoría.
 */
import { db } from "./db";
import { eq, and, inArray, asc } from "drizzle-orm";
import {
  recipeDrafts,
  recipeDraftLines,
  recipeDraftSupplies,
  recipes,
  recipeIngredients,
  recipeCategories,
  recipeSubcategories,
  supplies,
  unitsOfMeasure,
  rubros,
  type RecipeDraft,
  type RecipeDraftLine,
} from "@shared/schema";
import { getCurrentSupplyUnitCosts } from "./supplyMetricsQueries";
import { recipeGrossPrice, recipeRemovesIva, computeRecipeMetrics } from "@shared/recipePricing";
import {
  createDraftCoster,
  DRAFT_STATUSES,
  type DraftCostSources,
  type DraftInput,
  type DraftLineInput,
  type DraftStatus,
  type TempSupplyCost,
} from "@shared/recipeDrafts";

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(parseFloat(String(v))) ? parseFloat(String(v)) : null);

export class DraftError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// ==========================================
// Costos vigentes
// ==========================================

export async function getDraftCostSources(clientId: number): Promise<DraftCostSources> {
  const supplyCosts = await getCurrentSupplyUnitCosts(clientId);
  const supplyRows = await db
    .select({
      id: supplies.id,
      name: supplies.name,
      unit: unitsOfMeasure.abbreviation,
      rubroName: rubros.name,
      active: supplies.active,
    })
    .from(supplies)
    .leftJoin(unitsOfMeasure, eq(supplies.unitOfMeasureId, unitsOfMeasure.id))
    .leftJoin(rubros, eq(supplies.rubroId, rubros.id))
    .where(eq(supplies.clientId, clientId));

  const recipeRows = await db
    .select({
      recipe: recipes,
      categoryName: recipeCategories.name,
      subcategoryName: recipeSubcategories.name,
    })
    .from(recipes)
    .leftJoin(recipeCategories, eq(recipes.categoryId, recipeCategories.id))
    .leftJoin(recipeSubcategories, eq(recipes.subcategoryId, recipeSubcategories.id))
    .where(eq(recipes.clientId, clientId));

  return {
    supplies: supplyRows
      .map((s) => ({
        id: s.id,
        name: s.name,
        unit: s.unit ?? null,
        unitCost: supplyCosts.get(s.id) ?? 0,
        rubroName: s.rubroName ?? null,
        active: s.active !== false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    subRecipes: recipeRows
      .filter((r) => r.recipe.recipeType === "sub")
      .map(({ recipe: r }) => {
        const totalCost = num(r.totalCost);
        const y = numOrNull(r.usefulYield);
        return {
          id: r.id,
          name: r.name,
          unit: r.yieldUnit ?? null,
          totalCost,
          usefulYield: y,
          // Misma regla que Carta: sin rendimiento, la tanda entera es una unidad.
          unitCost: y && y > 0 ? totalCost / y : totalCost,
          active: r.active !== false,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    platos: recipeRows
      .filter((r) => r.recipe.recipeType !== "sub")
      .map(({ recipe: r, categoryName, subcategoryName }) => ({
        id: r.id,
        name: r.name,
        categoryName: categoryName ?? null,
        subcategoryName: subcategoryName ?? null,
        totalCost: num(r.totalCost),
        salePriceWithTax: recipeGrossPrice(r),
        removeIvaFromPrice: recipeRemovesIva(r),
        active: r.active !== false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}

// ==========================================
// Insumos de prueba
// ==========================================

export async function listTempSupplies(clientId: number) {
  const rows = await db
    .select({ s: recipeDraftSupplies, unit: unitsOfMeasure.abbreviation, linkedName: supplies.name })
    .from(recipeDraftSupplies)
    .leftJoin(unitsOfMeasure, eq(recipeDraftSupplies.unitOfMeasureId, unitsOfMeasure.id))
    .leftJoin(supplies, eq(recipeDraftSupplies.linkedSupplyId, supplies.id))
    .where(eq(recipeDraftSupplies.clientId, clientId))
    .orderBy(asc(recipeDraftSupplies.name));

  // Cuántas recetas del pizarrón usan cada uno (para no borrar uno en uso).
  const ids = rows.map((r) => r.s.id);
  const usage = new Map<number, number>();
  if (ids.length > 0) {
    const lineRows = await db
      .select({ tempSupplyId: recipeDraftLines.tempSupplyId, draftId: recipeDraftLines.draftId })
      .from(recipeDraftLines)
      .where(inArray(recipeDraftLines.tempSupplyId, ids));
    const seen = new Set<string>();
    for (const l of lineRows) {
      if (l.tempSupplyId == null) continue;
      const k = `${l.tempSupplyId}:${l.draftId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      usage.set(l.tempSupplyId, (usage.get(l.tempSupplyId) ?? 0) + 1);
    }
  }

  return rows.map((r) => ({
    ...r.s,
    unitCost: num(r.s.unitCost),
    unit: r.unit ?? null,
    linkedSupplyName: r.linkedName ?? null,
    usedIn: usage.get(r.s.id) ?? 0,
  }));
}

async function assertUnitBelongs(clientId: number, unitOfMeasureId: number | null | undefined) {
  if (unitOfMeasureId == null) return;
  const [u] = await db
    .select({ id: unitsOfMeasure.id })
    .from(unitsOfMeasure)
    .where(and(eq(unitsOfMeasure.id, unitOfMeasureId), eq(unitsOfMeasure.clientId, clientId)));
  if (!u) throw new DraftError("La unidad no existe");
}

export async function createTempSupply(
  clientId: number,
  data: { name: string; unitOfMeasureId?: number | null; unitCost: number; notes?: string | null },
) {
  await assertUnitBelongs(clientId, data.unitOfMeasureId);
  const [row] = await db
    .insert(recipeDraftSupplies)
    .values({
      clientId,
      name: data.name.trim(),
      unitOfMeasureId: data.unitOfMeasureId ?? null,
      unitCost: String(data.unitCost),
      notes: data.notes ?? null,
    } as any)
    .returning();
  return row;
}

export async function updateTempSupply(
  clientId: number,
  id: number,
  data: { name?: string; unitOfMeasureId?: number | null; unitCost?: number; notes?: string | null },
) {
  if (data.unitOfMeasureId !== undefined) await assertUnitBelongs(clientId, data.unitOfMeasureId);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) set.name = data.name.trim();
  if (data.unitOfMeasureId !== undefined) set.unitOfMeasureId = data.unitOfMeasureId;
  if (data.unitCost !== undefined) set.unitCost = String(data.unitCost);
  if (data.notes !== undefined) set.notes = data.notes;
  const [row] = await db
    .update(recipeDraftSupplies)
    .set(set as any)
    .where(and(eq(recipeDraftSupplies.id, id), eq(recipeDraftSupplies.clientId, clientId)))
    .returning();
  if (!row) throw new DraftError("Insumo de prueba no encontrado", 404);
  return row;
}

export async function deleteTempSupply(clientId: number, id: number) {
  const [row] = await db
    .select({ id: recipeDraftSupplies.id })
    .from(recipeDraftSupplies)
    .where(and(eq(recipeDraftSupplies.id, id), eq(recipeDraftSupplies.clientId, clientId)));
  if (!row) throw new DraftError("Insumo de prueba no encontrado", 404);
  const used = await db
    .select({ id: recipeDraftLines.id })
    .from(recipeDraftLines)
    .where(eq(recipeDraftLines.tempSupplyId, id))
    .limit(1);
  if (used.length > 0) throw new DraftError("Lo usa al menos una receta del pizarrón: sacalo de esas recetas primero", 409);
  await db.delete(recipeDraftSupplies).where(eq(recipeDraftSupplies.id, id));
}

// ==========================================
// Recetas del pizarrón
// ==========================================

export type DraftWithLines = RecipeDraft & { lines: RecipeDraftLine[] };

export async function listDrafts(clientId: number): Promise<DraftWithLines[]> {
  const drafts = await db.select().from(recipeDrafts).where(eq(recipeDrafts.clientId, clientId));
  if (drafts.length === 0) return [];
  const lines = await db
    .select()
    .from(recipeDraftLines)
    .where(inArray(recipeDraftLines.draftId, drafts.map((d) => d.id)))
    .orderBy(asc(recipeDraftLines.sortOrder), asc(recipeDraftLines.id));
  const byDraft = new Map<number, RecipeDraftLine[]>();
  for (const l of lines) {
    const list = byDraft.get(l.draftId);
    if (list) list.push(l);
    else byDraft.set(l.draftId, [l]);
  }
  return drafts
    .map((d) => ({ ...d, lines: byDraft.get(d.id) ?? [] }))
    .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
}

export async function getDraft(clientId: number, id: number): Promise<DraftWithLines | undefined> {
  const [d] = await db
    .select()
    .from(recipeDrafts)
    .where(and(eq(recipeDrafts.id, id), eq(recipeDrafts.clientId, clientId)));
  if (!d) return undefined;
  const lines = await db
    .select()
    .from(recipeDraftLines)
    .where(eq(recipeDraftLines.draftId, id))
    .orderBy(asc(recipeDraftLines.sortOrder), asc(recipeDraftLines.id));
  return { ...d, lines };
}

export interface DraftPayload {
  name: string;
  recipeType: "plato" | "sub";
  status?: DraftStatus;
  subcategoryId?: number | null;
  description?: string | null;
  preparationSteps?: string | null;
  notes?: string | null;
  salePriceWithTax?: number;
  removeIvaFromPrice?: boolean;
  cmvIdeal?: number | null;
  usefulYield?: number | null;
  yieldUnit?: string | null;
  sourceRecipeId?: number | null;
  lines: DraftLineInput[];
}

/** Que cada referencia de las líneas sea de esta empresa (nunca confiar en ids del navegador). */
async function validateLines(clientId: number, draftId: number | null, lines: DraftLineInput[]) {
  const ids = (t: DraftLineInput["lineType"], key: keyof DraftLineInput) =>
    Array.from(new Set(lines.filter((l) => l.lineType === t).map((l) => Number(l[key])).filter((n) => Number.isFinite(n))));

  for (const l of lines) {
    if (!(Number(l.quantity) > 0)) throw new DraftError("Todas las líneas necesitan una cantidad mayor a 0");
    const ref =
      l.lineType === "supply" ? l.supplyId : l.lineType === "subrecipe" ? l.subRecipeId : l.lineType === "draft" ? l.draftSubId : l.tempSupplyId;
    if (ref == null) throw new DraftError("Hay una línea sin insumo elegido");
  }

  const supplyIds = ids("supply", "supplyId");
  if (supplyIds.length) {
    const found = await db
      .select({ id: supplies.id })
      .from(supplies)
      .where(and(eq(supplies.clientId, clientId), inArray(supplies.id, supplyIds)));
    if (found.length !== supplyIds.length) throw new DraftError("Algún insumo no existe");
  }
  const subIds = ids("subrecipe", "subRecipeId");
  if (subIds.length) {
    const found = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.clientId, clientId), inArray(recipes.id, subIds), eq(recipes.recipeType, "sub")));
    if (found.length !== subIds.length) throw new DraftError("Alguna sub-receta no existe");
  }
  const tempIds = ids("temp", "tempSupplyId");
  if (tempIds.length) {
    const found = await db
      .select({ id: recipeDraftSupplies.id })
      .from(recipeDraftSupplies)
      .where(and(eq(recipeDraftSupplies.clientId, clientId), inArray(recipeDraftSupplies.id, tempIds)));
    if (found.length !== tempIds.length) throw new DraftError("Algún insumo de prueba no existe");
  }
  const draftIds = ids("draft", "draftSubId");
  if (draftIds.length) {
    if (draftId != null && draftIds.includes(draftId)) throw new DraftError("Una receta no puede usarse a sí misma");
    const all = await listDrafts(clientId);
    const byId = new Map(all.map((d) => [d.id, d]));
    for (const id of draftIds) {
      const d = byId.get(id);
      if (!d) throw new DraftError("Alguna receta del pizarrón no existe");
      if (d.recipeType !== "sub") throw new DraftError(`"${d.name}" no es una sub-receta`);
    }
    // Ciclo: si alguna sub-receta usada termina usando a esta.
    if (draftId != null) {
      const stack = [...draftIds];
      const seen = new Set<number>();
      while (stack.length) {
        const id = stack.pop()!;
        if (id === draftId) throw new DraftError("Esas sub-recetas del pizarrón se usan entre sí en círculo");
        if (seen.has(id)) continue;
        seen.add(id);
        for (const l of byId.get(id)?.lines ?? []) if (l.lineType === "draft" && l.draftSubId != null) stack.push(l.draftSubId);
      }
    }
  }
}

async function resolveCategory(clientId: number, subcategoryId: number | null | undefined) {
  if (subcategoryId == null) return { categoryId: null, subcategoryId: null };
  const [sub] = await db
    .select({ id: recipeSubcategories.id, categoryId: recipeSubcategories.recipeCategoryId })
    .from(recipeSubcategories)
    .where(and(eq(recipeSubcategories.id, subcategoryId), eq(recipeSubcategories.clientId, clientId)));
  if (!sub) throw new DraftError("La subcategoría no existe");
  return { categoryId: sub.categoryId, subcategoryId: sub.id };
}

function headerValues(p: DraftPayload) {
  return {
    name: p.name.trim(),
    recipeType: p.recipeType,
    status: p.status && (DRAFT_STATUSES as readonly string[]).includes(p.status) && p.status !== "enviada" ? p.status : undefined,
    description: p.description ?? null,
    preparationSteps: p.preparationSteps ?? null,
    notes: p.notes ?? null,
    salePriceWithTax: p.recipeType === "sub" ? "0" : String(Number(p.salePriceWithTax) || 0),
    removeIvaFromPrice: p.removeIvaFromPrice !== false,
    cmvIdeal: p.cmvIdeal != null && p.cmvIdeal > 0 ? String(p.cmvIdeal) : null,
    usefulYield: p.usefulYield != null && p.usefulYield > 0 ? String(p.usefulYield) : null,
    yieldUnit: p.yieldUnit || null,
  };
}

async function writeLines(draftId: number, lines: DraftLineInput[]) {
  await db.delete(recipeDraftLines).where(eq(recipeDraftLines.draftId, draftId));
  let i = 0;
  for (const l of lines) {
    await db.insert(recipeDraftLines).values({
      draftId,
      sortOrder: i++,
      lineType: l.lineType,
      supplyId: l.lineType === "supply" ? l.supplyId : null,
      subRecipeId: l.lineType === "subrecipe" ? l.subRecipeId : null,
      draftSubId: l.lineType === "draft" ? l.draftSubId : null,
      tempSupplyId: l.lineType === "temp" ? l.tempSupplyId : null,
      quantity: String(Number(l.quantity)),
      notes: l.notes ?? null,
    } as any);
  }
}

export async function createDraft(clientId: number, userId: string | null, p: DraftPayload): Promise<DraftWithLines> {
  if (!p.name?.trim()) throw new DraftError("El nombre es obligatorio");
  await validateLines(clientId, null, p.lines);
  const cat = await resolveCategory(clientId, p.subcategoryId);
  const h = headerValues(p);
  const [row] = await db
    .insert(recipeDrafts)
    .values({
      clientId,
      ...h,
      status: h.status ?? "borrador",
      ...cat,
      sourceRecipeId: p.sourceRecipeId ?? null,
      createdBy: userId,
      updatedBy: userId,
    } as any)
    .returning();
  await writeLines(row.id, p.lines);
  return (await getDraft(clientId, row.id))!;
}

export async function updateDraft(clientId: number, userId: string | null, id: number, p: DraftPayload): Promise<DraftWithLines> {
  const existing = await getDraft(clientId, id);
  if (!existing) throw new DraftError("Receta del pizarrón no encontrada", 404);
  if (!p.name?.trim()) throw new DraftError("El nombre es obligatorio");
  if (existing.recipeType === "sub" && p.recipeType !== "sub") {
    const all = await listDrafts(clientId);
    const users = all.filter((d) => d.lines.some((l) => l.lineType === "draft" && l.draftSubId === id));
    if (users.length > 0) {
      throw new DraftError(`No puede dejar de ser sub-receta: la usa "${users[0].name}"`, 409);
    }
  }
  await validateLines(clientId, id, p.lines);
  const cat = await resolveCategory(clientId, p.subcategoryId);
  const h = headerValues(p);
  await db
    .update(recipeDrafts)
    .set({
      ...h,
      // Una enviada sigue enviada aunque se la edite (sirve de historial de la versión enviada).
      status: existing.status === "enviada" ? "enviada" : h.status ?? existing.status,
      ...cat,
      updatedBy: userId,
      updatedAt: new Date(),
    } as any)
    .where(eq(recipeDrafts.id, id));
  await writeLines(id, p.lines);
  return (await getDraft(clientId, id))!;
}

export async function setDraftStatus(clientId: number, userId: string | null, id: number, status: DraftStatus) {
  const existing = await getDraft(clientId, id);
  if (!existing) throw new DraftError("Receta del pizarrón no encontrada", 404);
  if (status === "enviada") throw new DraftError("Para enviarla a Carta usá el botón Enviar a Carta");
  if (existing.status === "enviada") throw new DraftError("Ya fue enviada a Carta");
  await db
    .update(recipeDrafts)
    .set({ status, updatedBy: userId, updatedAt: new Date() } as any)
    .where(eq(recipeDrafts.id, id));
}

export async function deleteDraft(clientId: number, id: number) {
  const all = await listDrafts(clientId);
  const target = all.find((d) => d.id === id);
  if (!target) throw new DraftError("Receta del pizarrón no encontrada", 404);
  const users = all.filter((d) => d.id !== id && d.lines.some((l) => l.lineType === "draft" && l.draftSubId === id));
  if (users.length > 0) {
    throw new DraftError(`La usa "${users[0].name}". Sacala de esa receta primero.`, 409);
  }
  await db.delete(recipeDrafts).where(eq(recipeDrafts.id, id));
}

export async function duplicateDraft(clientId: number, userId: string | null, id: number) {
  const d = await getDraft(clientId, id);
  if (!d) throw new DraftError("Receta del pizarrón no encontrada", 404);
  return createDraft(clientId, userId, {
    name: `${d.name} (copia)`,
    recipeType: d.recipeType === "sub" ? "sub" : "plato",
    subcategoryId: d.subcategoryId,
    description: d.description,
    preparationSteps: d.preparationSteps,
    notes: d.notes,
    salePriceWithTax: num(d.salePriceWithTax),
    removeIvaFromPrice: d.removeIvaFromPrice !== false,
    cmvIdeal: numOrNull(d.cmvIdeal),
    usefulYield: numOrNull(d.usefulYield),
    yieldUnit: d.yieldUnit,
    sourceRecipeId: d.sourceRecipeId,
    lines: d.lines.map(lineToInput),
  });
}

function lineToInput(l: RecipeDraftLine): DraftLineInput {
  return {
    lineType: l.lineType as DraftLineInput["lineType"],
    supplyId: l.supplyId,
    subRecipeId: l.subRecipeId,
    draftSubId: l.draftSubId,
    tempSupplyId: l.tempSupplyId,
    quantity: num(l.quantity),
    notes: l.notes,
  };
}

/** Copia una receta de Carta al pizarrón para probar variantes. La de Carta no se toca. */
export async function draftFromRecipe(clientId: number, userId: string | null, recipeId: number) {
  const [r] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.clientId, clientId)));
  if (!r) throw new DraftError("Receta no encontrada", 404);
  const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
  const lines: DraftLineInput[] = ings
    .filter((i) => i.supplyId != null || i.subRecipeId != null)
    .map((i) => ({
      lineType: i.subRecipeId != null ? "subrecipe" : "supply",
      supplyId: i.supplyId,
      subRecipeId: i.subRecipeId,
      quantity: num(i.quantityTotal),
    }));
  return createDraft(clientId, userId, {
    name: `${r.name} (prueba)`,
    recipeType: r.recipeType === "sub" ? "sub" : "plato",
    subcategoryId: r.subcategoryId,
    description: r.description,
    preparationSteps: r.preparationSteps,
    salePriceWithTax: recipeGrossPrice(r),
    removeIvaFromPrice: recipeRemovesIva(r),
    cmvIdeal: numOrNull(r.cmvIdeal),
    usefulYield: numOrNull(r.usefulYield),
    yieldUnit: r.yieldUnit,
    sourceRecipeId: r.id,
    lines,
  });
}

// ==========================================
// Enviar a Carta
// ==========================================

export interface PromoteOptions {
  /** Plato: obligatoria, como en Carta. Sub-receta: si no viene, va a Producción como en el alta de sub-recetas. */
  subcategoryId?: number | null;
  /** Qué hacer con cada insumo de prueba que la receta usa y todavía no está vinculado. */
  mappings: Record<string, { mode: "link"; supplyId: number } | { mode: "create"; rubroId?: number | null }>;
}

const clampFixed = (v: number, max: number, d = 2) =>
  Math.min(max, Math.max(-max, Number.isFinite(v) ? v : 0)).toFixed(d);

export async function promoteDraft(clientId: number, userId: string | null, id: number, opts: PromoteOptions) {
  const all = await listDrafts(clientId);
  const draft = all.find((d) => d.id === id);
  if (!draft) throw new DraftError("Receta del pizarrón no encontrada", 404);
  if (draft.status === "enviada" && draft.promotedRecipeId) throw new DraftError("Ya fue enviada a Carta");
  if (draft.lines.length === 0) throw new DraftError("La receta no tiene ingredientes");

  const isSub = draft.recipeType === "sub";

  // Sub-recetas del pizarrón: tienen que estar enviadas antes (pasan a ser sub-recetas de Carta).
  const draftById = new Map(all.map((d) => [d.id, d]));
  for (const l of draft.lines) {
    if (l.lineType !== "draft") continue;
    const sub = l.draftSubId != null ? draftById.get(l.draftSubId) : undefined;
    if (!sub?.promotedRecipeId) {
      throw new DraftError(`Primero enviá a Carta la sub-receta "${sub?.name ?? "?"}"`);
    }
  }

  // Nombre repetido en Carta: se frena para no tener dos platos iguales.
  const sameName = await db
    .select({ id: recipes.id, name: recipes.name })
    .from(recipes)
    .where(and(eq(recipes.clientId, clientId), eq(recipes.active, true)));
  const norm = (s: string) => s.trim().toLowerCase();
  if (sameName.some((r) => norm(r.name) === norm(draft.name))) {
    throw new DraftError(`Ya hay una receta llamada "${draft.name}" en Carta. Cambiale el nombre al borrador.`, 409);
  }

  // Categoría
  let categoryId: number | null = null;
  let subcategoryId: number | null = null;
  if (isSub) {
    if (opts.subcategoryId != null) {
      ({ categoryId, subcategoryId } = await resolveCategory(clientId, opts.subcategoryId));
    } else {
      // Igual que el alta de sub-recetas: categoría "Producción" y su primera subcategoría.
      const cats = await db.select().from(recipeCategories).where(eq(recipeCategories.clientId, clientId));
      const prod = cats.find((c) => ["produccion", "producción"].includes(c.name.toLowerCase()));
      categoryId = prod?.id ?? null;
      if (prod) {
        const subs = await db
          .select()
          .from(recipeSubcategories)
          .where(and(eq(recipeSubcategories.clientId, clientId), eq(recipeSubcategories.recipeCategoryId, prod.id)));
        subcategoryId = subs.filter((s) => s.active !== false).sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null;
      }
    }
  } else {
    const subId = opts.subcategoryId ?? draft.subcategoryId;
    if (subId == null) throw new DraftError("Elegí la subcategoría con la que entra a Carta");
    ({ categoryId, subcategoryId } = await resolveCategory(clientId, subId));
  }

  // Insumos de prueba: vincular o crear (decisión del usuario, 19-oct-2026).
  const tempIds = Array.from(new Set(draft.lines.filter((l) => l.lineType === "temp" && l.tempSupplyId != null).map((l) => l.tempSupplyId!)));
  const tempRows = tempIds.length
    ? await db
        .select()
        .from(recipeDraftSupplies)
        .where(and(eq(recipeDraftSupplies.clientId, clientId), inArray(recipeDraftSupplies.id, tempIds)))
    : [];
  const pendingTemp = tempRows.filter((t) => t.linkedSupplyId == null);
  for (const t of pendingTemp) {
    const m = opts.mappings[String(t.id)];
    if (!m) throw new DraftError(`Falta decidir qué hacer con el insumo de prueba "${t.name}"`);
    if (m.mode === "link") {
      const [s] = await db
        .select({ id: supplies.id })
        .from(supplies)
        .where(and(eq(supplies.id, m.supplyId), eq(supplies.clientId, clientId)));
      if (!s) throw new DraftError(`El insumo elegido para "${t.name}" no existe`);
    }
    if (m.mode === "create" && m.rubroId != null) {
      const [r] = await db.select({ id: rubros.id }).from(rubros).where(and(eq(rubros.id, m.rubroId), eq(rubros.clientId, clientId)));
      if (!r) throw new DraftError(`El rubro elegido para "${t.name}" no existe`);
    }
  }

  // Costeo ANTES de escribir: en SQLite leer con otra conexión dentro de la transacción puede
  // bloquearse. Un insumo vinculado cuesta lo que el real; uno que se crea, su costo de prueba
  // (que es el último costo con el que nace el insumo nuevo).
  const sources = await getDraftCostSources(clientId);
  // TODOS los insumos de prueba de la empresa, no solo los de esta receta: una sub-receta del
  // pizarrón que se usa adentro puede tener los suyos.
  const allTemp = await db.select().from(recipeDraftSupplies).where(eq(recipeDraftSupplies.clientId, clientId));
  const tempCosts: TempSupplyCost[] = allTemp.map((t) => {
    const m = tempIds.includes(t.id) ? opts.mappings[String(t.id)] : undefined;
    return {
      id: t.id,
      name: t.name,
      unit: null,
      unitCost: num(t.unitCost),
      linkedSupplyId: t.linkedSupplyId ?? (m?.mode === "link" ? m.supplyId : null),
    };
  });
  const toInput = (d: DraftWithLines): DraftInput => ({
    id: d.id,
    name: d.name,
    recipeType: d.recipeType === "sub" ? "sub" : "plato",
    salePriceWithTax: num(d.salePriceWithTax),
    removeIvaFromPrice: d.removeIvaFromPrice !== false,
    cmvIdeal: numOrNull(d.cmvIdeal),
    usefulYield: numOrNull(d.usefulYield),
    lines: d.lines.map(lineToInput),
  });
  const input = toInput(draft);
  const costing = createDraftCoster({ sources, tempSupplies: tempCosts, drafts: all.map(toInput) }).costDraft(input);
  const metrics = isSub
    ? null
    : computeRecipeMetrics({
        grossPrice: num(draft.salePriceWithTax),
        totalCost: costing.totalCost,
        removeIva: draft.removeIvaFromPrice !== false,
      });

  return db.transaction(async (tx) => {
    const createdSupplies: Array<{ tempId: number; supplyId: number; name: string }> = [];
    const tempToSupply = new Map<number, number>();
    for (const t of tempRows) {
      if (t.linkedSupplyId != null) {
        tempToSupply.set(t.id, t.linkedSupplyId);
        continue;
      }
      const m = opts.mappings[String(t.id)]!;
      let supplyId: number;
      if (m.mode === "link") {
        supplyId = m.supplyId;
      } else {
        const [created] = await tx
          .insert(supplies)
          .values({
            clientId,
            name: t.name,
            unitOfMeasureId: t.unitOfMeasureId,
            rubroId: m.rubroId ?? null,
            lastCost: String(num(t.unitCost)),
            unitCost: String(num(t.unitCost)),
            active: true,
          } as any)
          .returning();
        supplyId = created.id;
        createdSupplies.push({ tempId: t.id, supplyId, name: t.name });
      }
      tempToSupply.set(t.id, supplyId);
      await tx
        .update(recipeDraftSupplies)
        .set({ linkedSupplyId: supplyId, updatedAt: new Date() } as any)
        .where(eq(recipeDraftSupplies.id, t.id));
    }

    const ingredients = input.lines.map((l, i) => {
      const c = costing.lines[i];
      let supplyId: number | null = null;
      let subRecipeId: number | null = null;
      if (l.lineType === "supply") supplyId = l.supplyId!;
      else if (l.lineType === "subrecipe") subRecipeId = l.subRecipeId!;
      else if (l.lineType === "temp") supplyId = tempToSupply.get(l.tempSupplyId!)!;
      else subRecipeId = draftById.get(l.draftSubId!)!.promotedRecipeId!;
      return {
        supplyId,
        subRecipeId,
        quantityTotal: String(l.quantity),
        quantityUseful: null,
        quantityWithWaste: String(l.quantity),
        wastePercentage: "0",
        unitCostAtCreation: c.unitCost.toFixed(4),
        currentCost: c.unitCost.toFixed(4),
        totalCost: c.lineCost.toFixed(4),
      };
    });

    const [recipe] = await tx
      .insert(recipes)
      .values({
        clientId,
        categoryId,
        subcategoryId,
        recipeType: isSub ? "sub" : "plato",
        name: draft.name,
        description: draft.description,
        preparationSteps: draft.preparationSteps,
        salePrice: metrics ? metrics.salePrice.toFixed(2) : "0",
        salePriceWithTax: metrics ? metrics.salePriceWithTax.toFixed(2) : "0",
        removeIvaFromPrice: isSub ? true : draft.removeIvaFromPrice !== false,
        totalCost: costing.totalCost.toFixed(4),
        usefulYield: draft.usefulYield,
        yieldUnit: draft.yieldUnit,
        cmvPercentage: metrics ? clampFixed(metrics.cmvPercentage, 999.99) : "0",
        cmvIdeal: draft.cmvIdeal,
        margin: metrics ? clampFixed(metrics.margin, 9999999999.99) : "0",
        marginPercentage: metrics ? clampFixed(metrics.marginPercentage, 999.99) : "0",
        markup: metrics ? clampFixed(metrics.markup, 999.99) : "0",
        active: true,
      } as any)
      .returning();

    for (const ing of ingredients) {
      await tx.insert(recipeIngredients).values({ ...ing, recipeId: recipe.id } as any);
    }

    await tx
      .update(recipeDrafts)
      .set({ status: "enviada", promotedRecipeId: recipe.id, promotedAt: new Date(), updatedBy: userId, updatedAt: new Date() } as any)
      .where(eq(recipeDrafts.id, id));

    return { recipeId: recipe.id, recipeType: recipe.recipeType as string, totalCost: costing.totalCost, createdSupplies };
  });
}
