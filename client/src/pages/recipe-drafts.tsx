/**
 * Pizarrón de Recetas — listado, filtros, comparador de variantes e insumos de prueba.
 *
 * Todo lo que vive acá es de prueba: no cuenta en Carta, CMV, consumo ni informes hasta que una
 * receta se envía a Carta desde su editor.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { QuantityInput } from "@/components/quantity-input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { exportToExcel, exportToPdf, type ExportInput } from "@/lib/table-export";
import { DRAFT_QUERY_KEYS, draftRowToInput, useDraftData, type DraftRow, type TempSupplyRow } from "@/lib/recipe-drafts";
import { DRAFT_STATUS_LABELS, type DraftCosting, type DraftStatus } from "@shared/recipeDrafts";
import type { RecipeCategory, RecipeSubcategory, UnitOfMeasure } from "@shared/schema";
import {
  FlaskConical,
  Plus,
  Search,
  Copy,
  Trash2,
  Columns3,
  Package,
  Download,
  FileDown,
  FileSpreadsheet,
  Pencil,
} from "lucide-react";

const STATUS_TONE: Record<DraftStatus, string> = {
  borrador: "bg-muted text-muted-foreground",
  en_prueba: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  aprobada: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  enviada: "bg-primary/15 text-primary",
  descartada: "bg-destructive/10 text-destructive line-through",
};

const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v)}%`;
const fmtDate = (v: string | null | undefined) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-AR");
};
/** Fecha local "YYYY-MM-DD" (toISOString corre un día en Argentina). */
const localYmd = (v: string | null | undefined) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Row {
  draft: DraftRow;
  costing: DraftCosting | null;
  categoryName: string | null;
  subcategoryName: string | null;
}

export default function RecipeDraftsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { sources, drafts, tempSupplies, coster, isLoading, error } = useDraftData();
  const { data: subcategories = [] } = useQuery<(RecipeSubcategory & { recipeCategory?: RecipeCategory | null })[]>({
    queryKey: ["/api/recipe-subcategories"],
  });

  const [search, setSearch] = usePersistentFilter("pizarron.search", "");
  const [statusFilter, setStatusFilter] = usePersistentFilter("pizarron.status", "activas");
  const [typeFilter, setTypeFilter] = usePersistentFilter("pizarron.type", "all");
  const [categoryFilter, setCategoryFilter] = usePersistentFilter("pizarron.category", "all");
  const [dateFrom, setDateFrom] = usePersistentFilter("pizarron.dateFrom", "");
  const [dateTo, setDateTo] = usePersistentFilter("pizarron.dateTo", "");

  const [selected, setSelected] = useState<number[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [fromCartaOpen, setFromCartaOpen] = useState(false);
  const [tempOpen, setTempOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DraftRow | null>(null);

  const subById = useMemo(() => new Map(subcategories.map((s) => [s.id, s])), [subcategories]);
  const categoryOptions = useMemo(() => {
    const cats = new Map<number, string>();
    for (const s of subcategories) if (s.recipeCategory) cats.set(s.recipeCategory.id, s.recipeCategory.name);
    return [
      { value: "all", label: "Todas las categorías" },
      ...Array.from(cats.entries())
        .sort((a, b) => a[1].localeCompare(b[1], "es"))
        .map(([id, n]) => ({ value: String(id), label: n })),
    ];
  }, [subcategories]);

  const rows: Row[] = useMemo(
    () =>
      drafts.map((d) => {
        const sub = d.subcategoryId != null ? subById.get(d.subcategoryId) : undefined;
        return {
          draft: d,
          costing: coster ? coster.costDraft(draftRowToInput(d)) : null,
          categoryName: sub?.recipeCategory?.name ?? null,
          subcategoryName: sub?.name ?? null,
        };
      }),
    [drafts, coster, subById],
  );

  const q = search.trim().toLowerCase();
  const filtered = rows.filter(({ draft: d, categoryName, subcategoryName }) => {
    if (statusFilter === "activas" && (d.status === "descartada" || d.status === "enviada")) return false;
    if (statusFilter !== "activas" && statusFilter !== "all" && d.status !== statusFilter) return false;
    if (typeFilter !== "all" && d.recipeType !== typeFilter) return false;
    if (categoryFilter !== "all" && String(d.categoryId ?? "") !== categoryFilter) return false;
    const created = localYmd(d.createdAt);
    if (dateFrom && created && created < dateFrom) return false;
    if (dateTo && created && created > dateTo) return false;
    if (q && ![d.name, categoryName, subcategoryName, d.notes].some((x) => String(x ?? "").toLowerCase().includes(q))) return false;
    return true;
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of drafts) c[d.status] = (c[d.status] ?? 0) + 1;
    return c;
  }, [drafts]);

  const invalidate = () => DRAFT_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));

  const duplicate = useMutation({
    mutationFn: async (id: number) => (await (await apiRequest("POST", `/api/recipe-drafts/${id}/duplicate`)).json()) as DraftRow,
    onSuccess: (copy) => {
      invalidate();
      toast({ title: "Copia creada", description: copy.name });
    },
    onError: (e: Error) => toast({ title: "No se pudo duplicar", description: e.message, variant: "destructive" }),
  });

  const changeStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: DraftStatus }) =>
      apiRequest("PATCH", `/api/recipe-drafts/${id}/status`, { status }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: "No se pudo cambiar el estado", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/recipe-drafts/${id}`),
    onSuccess: () => {
      invalidate();
      setSelected((s) => s.filter((x) => x !== toDelete?.id));
      setToDelete(null);
      toast({ title: "Eliminada del pizarrón" });
    },
    onError: (e: Error) => {
      setToDelete(null);
      toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" });
    },
  });

  const toggleSelect = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));

  const buildExport = (): ExportInput => ({
    title: "Pizarrón de Recetas",
    filtros: [
      `Estado: ${statusFilter === "activas" ? "activas" : statusFilter === "all" ? "todas" : DRAFT_STATUS_LABELS[statusFilter as DraftStatus]}`,
      `Tipo: ${typeFilter === "all" ? "todos" : typeFilter === "sub" ? "sub-recetas" : "platos"}`,
      ...(q ? [`Búsqueda: "${search.trim()}"`] : []),
      "Recetas de prueba: no impactan en Carta",
    ],
    resumen: [`Recetas: ${filtered.length}`],
    fileBase: "pizarron-recetas",
    sheets: [
      {
        name: "Recetas",
        rows: filtered,
        columns: [
          { header: "Nombre", value: (r: Row) => r.draft.name, width: 2.4 },
          { header: "Tipo", value: (r: Row) => (r.draft.recipeType === "sub" ? "Sub-receta" : "Plato"), width: 0.8 },
          { header: "Estado", value: (r: Row) => DRAFT_STATUS_LABELS[r.draft.status], width: 1 },
          { header: "Categoría", value: (r: Row) => [r.categoryName, r.subcategoryName].filter(Boolean).join(" — "), width: 1.6 },
          { header: "Costo", value: (r: Row) => r.costing?.totalCost ?? null, money: true },
          { header: "Precio (c/IVA)", value: (r: Row) => (r.draft.recipeType === "sub" ? null : parseFloat(String(r.draft.salePriceWithTax ?? 0)) || null), money: true },
          { header: "CMV %", value: (r: Row) => (r.costing?.metrics && r.costing.metrics.salePrice > 0 ? Math.round(r.costing.metrics.cmvPercentage * 10) / 10 : null), width: 0.7 },
          { header: "Creada", value: (r: Row) => fmtDate(r.draft.createdAt), width: 0.8 },
        ],
      },
    ],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pizarrón de Recetas"
        description="Armá y costeá recetas de prueba sin tocar Carta. Cuando una te cierra, la enviás."
      />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate("/pizarron-recetas/nueva")} data-testid="button-new-draft">
          <Plus className="h-4 w-4 mr-1.5" /> Nuevo plato de prueba
        </Button>
        <Button variant="outline" onClick={() => navigate("/pizarron-recetas/nueva?type=sub")}>
          <Plus className="h-4 w-4 mr-1.5" /> Nueva sub-receta de prueba
        </Button>
        <Button variant="outline" onClick={() => setFromCartaOpen(true)}>
          <Download className="h-4 w-4 mr-1.5" /> Traer una receta de Carta
        </Button>
        <Button variant="outline" onClick={() => setTempOpen(true)}>
          <Package className="h-4 w-4 mr-1.5" /> Insumos de prueba ({tempSupplies.length})
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => exportToExcel(buildExport())} disabled={filtered.length === 0}>
          <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportToPdf(buildExport())} disabled={filtered.length === 0}>
          <FileDown className="h-4 w-4 mr-1.5" /> PDF
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-1">
              <Search className="h-4 w-4 absolute left-2.5 top-3 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <DataEntryCombobox
              options={[
                { value: "activas", label: `Activas (sin enviadas ni descartadas)` },
                { value: "all", label: `Todas (${drafts.length})` },
                ...(["borrador", "en_prueba", "aprobada", "enviada", "descartada"] as DraftStatus[]).map((s) => ({
                  value: s,
                  label: `${DRAFT_STATUS_LABELS[s]} (${counts[s] ?? 0})`,
                })),
              ]}
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v || "activas")}
            />
            <DataEntryCombobox
              options={[
                { value: "all", label: "Platos y sub-recetas" },
                { value: "plato", label: "Solo platos" },
                { value: "sub", label: "Solo sub-recetas" },
              ]}
              value={typeFilter}
              onValueChange={(v) => setTypeFilter(v || "all")}
            />
            <DataEntryCombobox options={categoryOptions} value={categoryFilter} onValueChange={(v) => setCategoryFilter(v || "all")} />
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(f, t) => {
                setDateFrom(f);
                setDateTo(t);
              }}
              placeholder="Creadas entre…"
            />
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
              <span className="text-sm">{selected.length} seleccionada(s)</span>
              <Button size="sm" onClick={() => setCompareOpen(true)} disabled={selected.length < 2}>
                <Columns3 className="h-4 w-4 mr-1.5" /> Comparar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Limpiar
              </Button>
              {selected.length < 2 && <span className="text-xs text-muted-foreground">Elegí al menos 2 (hasta 4) para comparar.</span>}
            </div>
          )}

          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <FlaskConical className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {drafts.length === 0 ? "Todavía no hay recetas en el pizarrón." : "Ninguna receta coincide con los filtros."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="w-8 py-2" />
                    <th className="text-left font-medium py-2 px-1">Receta</th>
                    <th className="text-left font-medium py-2 px-1">Estado</th>
                    <th className="text-right font-medium py-2 px-1">Costo</th>
                    <th className="text-right font-medium py-2 px-1 hidden md:table-cell">Precio</th>
                    <th className="text-right font-medium py-2 px-1">CMV</th>
                    <th className="text-right font-medium py-2 px-1 hidden lg:table-cell">Actualizada</th>
                    <th className="py-2 px-1 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ draft: d, costing, categoryName, subcategoryName }) => {
                    const isSub = d.recipeType === "sub";
                    const m = costing?.metrics;
                    const ideal = parseFloat(String(d.cmvIdeal ?? 0)) || 0;
                    const over = m && ideal > 0 && m.salePrice > 0 && m.cmvPercentage > ideal;
                    return (
                      <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2 px-1">
                          <Checkbox checked={selected.includes(d.id)} onCheckedChange={() => toggleSelect(d.id)} aria-label="Seleccionar para comparar" />
                        </td>
                        <td className="py-2 px-1">
                          <Link href={`/pizarron-recetas/${d.id}`}>
                            <span className="font-medium hover:underline cursor-pointer">{d.name}</span>
                          </Link>
                          <p className="text-[11px] text-muted-foreground">
                            {[isSub ? "Sub-receta" : "Plato", categoryName && subcategoryName ? `${categoryName} — ${subcategoryName}` : null, `${d.lines.length} ingredientes`]
                              .filter(Boolean)
                              .join(" · ")}
                            {costing && costing.missingLines > 0 && <span className="text-amber-600"> · {costing.missingLines} sin costo</span>}
                          </p>
                        </td>
                        <td className="py-2 px-1">
                          {d.status === "enviada" ? (
                            <Badge className={STATUS_TONE.enviada} variant="secondary">
                              {DRAFT_STATUS_LABELS.enviada}
                            </Badge>
                          ) : (
                            <DataEntryCombobox
                              options={(["borrador", "en_prueba", "aprobada", "descartada"] as DraftStatus[]).map((s) => ({ value: s, label: DRAFT_STATUS_LABELS[s] }))}
                              value={d.status}
                              onValueChange={(v) => v && v !== d.status && changeStatus.mutate({ id: d.id, status: v as DraftStatus })}
                              triggerClassName={`h-7 text-xs w-32 border-0 ${STATUS_TONE[d.status]}`}
                            />
                          )}
                        </td>
                        <td className="py-2 px-1 text-right font-mono">
                          {costing ? formatCurrency(isSub ? costing.unitCost : costing.totalCost) : "—"}
                          {isSub && d.yieldUnit && <p className="text-[10px] text-muted-foreground">por {d.yieldUnit}</p>}
                        </td>
                        <td className="py-2 px-1 text-right font-mono hidden md:table-cell">
                          {isSub ? "—" : formatCurrency(parseFloat(String(d.salePriceWithTax ?? 0)) || 0)}
                        </td>
                        <td className={`py-2 px-1 text-right font-mono ${over ? "text-destructive" : ""}`}>
                          {m && m.salePrice > 0 ? fmtPct(m.cmvPercentage) : "—"}
                          {ideal > 0 && !isSub && <p className="text-[10px] text-muted-foreground">ideal {fmtPct(ideal)}</p>}
                        </td>
                        <td className="py-2 px-1 text-right text-xs text-muted-foreground hidden lg:table-cell">{fmtDate(d.updatedAt)}</td>
                        <td className="py-2 px-1 text-right whitespace-nowrap">
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={() => navigate(`/pizarron-recetas/${d.id}`)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicar" onClick={() => duplicate.mutate(d.id)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" title="Eliminar" onClick={() => setToDelete(d)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {compareOpen && (
        <CompareDialog rows={rows.filter((r) => selected.includes(r.draft.id))} onClose={() => setCompareOpen(false)} />
      )}
      {fromCartaOpen && <FromCartaDialog platos={sources?.platos ?? []} subRecipes={sources?.subRecipes ?? []} onClose={() => setFromCartaOpen(false)} />}
      {tempOpen && <TempSuppliesDialog rows={tempSupplies} onClose={() => setTempOpen(false)} />}

      <AlertDialog open={toDelete != null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar "{toDelete?.name}" del pizarrón?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.status === "enviada"
                ? "La receta que ya está en Carta no se toca: solo se borra este borrador."
                : "No afecta a Carta. Si querés guardarla como historial, mejor cambiale el estado a Descartada."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete.id)}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Comparar variantes ───────────────────────────────────────────────────────

function CompareDialog({ rows, onClose }: { rows: Row[]; onClose: () => void }) {
  // Filas de ingredientes: la unión de todos, por "tipo:id", para ver qué cambia entre variantes.
  const ingredientKeys = useMemo(() => {
    const keys = new Map<string, string>();
    for (const r of rows) {
      r.draft.lines.forEach((l, i) => {
        const id = l.lineType === "supply" ? l.supplyId : l.lineType === "subrecipe" ? l.subRecipeId : l.lineType === "draft" ? l.draftSubId : l.tempSupplyId;
        const k = `${l.lineType}:${id}`;
        if (!keys.has(k)) keys.set(k, r.costing?.lines[i]?.label ?? k);
      });
    }
    return Array.from(keys.entries());
  }, [rows]);

  const cell = (r: Row, key: string) => {
    let qty = 0;
    let cost = 0;
    let found = false;
    r.draft.lines.forEach((l, i) => {
      const id = l.lineType === "supply" ? l.supplyId : l.lineType === "subrecipe" ? l.subRecipeId : l.lineType === "draft" ? l.draftSubId : l.tempSupplyId;
      if (`${l.lineType}:${id}` !== key) return;
      found = true;
      qty += parseFloat(String(l.quantity)) || 0;
      cost += r.costing?.lines[i]?.lineCost ?? 0;
    });
    return found ? { qty, cost } : null;
  };

  const minCost = Math.min(...rows.map((r) => r.costing?.totalCost ?? Infinity));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Comparar variantes</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-1 text-xs text-muted-foreground font-medium">&nbsp;</th>
                {rows.map((r) => (
                  <th key={r.draft.id} className="text-right py-2 px-2 font-semibold min-w-[150px]">
                    {r.draft.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: "Costo",
                  render: (r: Row) => (
                    <span className={r.costing?.totalCost === minCost && rows.length > 1 ? "text-emerald-600 dark:text-emerald-500 font-bold" : "font-bold"}>
                      {formatCurrency(r.costing?.totalCost ?? 0)}
                    </span>
                  ),
                },
                { label: "Precio (c/IVA)", render: (r: Row) => (r.draft.recipeType === "sub" ? "—" : formatCurrency(parseFloat(String(r.draft.salePriceWithTax ?? 0)) || 0)) },
                { label: "CMV", render: (r: Row) => (r.costing?.metrics && r.costing.metrics.salePrice > 0 ? fmtPct(r.costing.metrics.cmvPercentage) : "—") },
                { label: "Margen $", render: (r: Row) => (r.costing?.metrics && r.costing.metrics.salePrice > 0 ? formatCurrency(r.costing.metrics.margin) : "—") },
                { label: "Margen %", render: (r: Row) => (r.costing?.metrics && r.costing.metrics.salePrice > 0 ? fmtPct(r.costing.metrics.marginPercentage) : "—") },
              ].map((row) => (
                <tr key={row.label} className="border-b bg-muted/30">
                  <td className="py-2 px-1 text-xs font-medium">{row.label}</td>
                  {rows.map((r) => (
                    <td key={r.draft.id} className="py-2 px-2 text-right font-mono">
                      {row.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td colSpan={rows.length + 1} className="pt-4 pb-1 text-xs font-semibold text-muted-foreground">
                  Ingredientes (cantidad · costo)
                </td>
              </tr>
              {ingredientKeys.map(([key, label]) => {
                const cells = rows.map((r) => cell(r, key));
                const allSame = cells.every((c) => c && cells[0] && Math.abs(c.qty - cells[0].qty) < 1e-9);
                return (
                  <tr key={key} className={`border-b last:border-0 ${allSame ? "" : "bg-amber-500/5"}`}>
                    <td className="py-1.5 px-1">{label}</td>
                    {cells.map((c, i) => (
                      <td key={rows[i].draft.id} className="py-1.5 px-2 text-right font-mono text-xs">
                        {c ? (
                          <>
                            {new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(c.qty)}
                            <span className="text-muted-foreground"> · {formatCurrency(c.cost)}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">En amarillo, los ingredientes que cambian entre variantes. En verde, la más barata.</p>
      </DialogContent>
    </Dialog>
  );
}

// ─── Traer de Carta ───────────────────────────────────────────────────────────

function FromCartaDialog({
  platos,
  subRecipes,
  onClose,
}: {
  platos: Array<{ id: number; name: string; active: boolean; categoryName: string | null }>;
  subRecipes: Array<{ id: number; name: string; active: boolean }>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [recipeId, setRecipeId] = useState("");
  const options = useMemo(
    () => [
      ...platos.filter((p) => p.active).map((p) => ({ value: String(p.id), label: `${p.name}${p.categoryName ? ` — ${p.categoryName}` : ""}` })),
      ...subRecipes.filter((s) => s.active).map((s) => ({ value: String(s.id), label: `${s.name} — sub-receta` })),
    ],
    [platos, subRecipes],
  );
  const copy = useMutation({
    mutationFn: async () => (await (await apiRequest("POST", `/api/recipe-drafts/from-recipe/${recipeId}`)).json()) as DraftRow,
    onSuccess: (d) => {
      DRAFT_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      toast({ title: "Copiada al pizarrón", description: "La receta de Carta no se modificó." });
      onClose();
      navigate(`/pizarron-recetas/${d.id}`);
    },
    onError: (e: Error) => toast({ title: "No se pudo copiar", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Traer una receta de Carta</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Se copia al pizarrón con sus ingredientes y precio, para probar cambios (otro gramaje, otro insumo, otro precio) sin
          tocar la original.
        </p>
        <DataEntryCombobox options={options} value={recipeId} onValueChange={setRecipeId} placeholder="Elegí la receta" searchPlaceholder="Buscar receta…" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => copy.mutate()} disabled={!recipeId || copy.isPending}>
            {copy.isPending ? "Copiando…" : "Copiar al pizarrón"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Insumos de prueba ────────────────────────────────────────────────────────

function TempSuppliesDialog({ rows, onClose }: { rows: TempSupplyRow[]; onClose: () => void }) {
  const { toast } = useToast();
  const { data: units = [] } = useQuery<UnitOfMeasure[]>({ queryKey: ["/api/units"] });
  const [editing, setEditing] = useState<Record<number, number>>({});
  const invalidate = () => DRAFT_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));

  const [name, setName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [cost, setCost] = useState(0);

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/recipe-draft-supplies", { name, unitOfMeasureId: unitId ? parseInt(unitId, 10) : null, unitCost: cost }),
    onSuccess: () => {
      invalidate();
      setName("");
      setCost(0);
      toast({ title: "Insumo de prueba creado" });
    },
    onError: (e: Error) => toast({ title: "No se pudo crear", description: e.message, variant: "destructive" }),
  });
  const update = useMutation({
    mutationFn: async ({ id, unitCost }: { id: number; unitCost: number }) => apiRequest("PATCH", `/api/recipe-draft-supplies/${id}`, { unitCost }),
    onSuccess: (_r, v) => {
      invalidate();
      setEditing((e) => {
        const n = { ...e };
        delete n[v.id];
        return n;
      });
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/recipe-draft-supplies/${id}`),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Insumos de prueba</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Insumos que solo existen en el pizarrón, con costo cargado a mano (sin IVA). No aparecen en Insumos ni necesitan
          factura. Cuando quedan vinculados a un insumo real, las recetas del pizarrón toman el costo real.
        </p>

        <div className="grid gap-2 sm:grid-cols-[1fr_140px_140px_auto] items-end rounded-lg border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unidad</Label>
            <DataEntryCombobox
              options={units.filter((u) => u.active !== false).map((u) => ({ value: String(u.id), label: `${u.name} (${u.abbreviation})` }))}
              value={unitId}
              onValueChange={setUnitId}
              placeholder="Unidad"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Costo</Label>
            <QuantityInput value={cost} onChange={setCost} unit="$" />
          </div>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || !unitId || create.isPending}>
            <Plus className="h-4 w-4 mr-1" /> Crear
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Todavía no hay insumos de prueba.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left font-medium py-2">Insumo</th>
                <th className="text-right font-medium py-2">Costo</th>
                <th className="text-right font-medium py-2">Usado en</th>
                <th className="py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t.unit ? `x ${t.unit}` : "sin unidad"}
                      {t.linkedSupplyName && <> · vinculado a <span className="font-medium">{t.linkedSupplyName}</span></>}
                    </p>
                  </td>
                  <td className="py-2 text-right">
                    {editing[t.id] != null ? (
                      <div className="flex justify-end gap-1">
                        <div className="w-32">
                          <QuantityInput value={editing[t.id]} onChange={(v) => setEditing({ ...editing, [t.id]: v })} unit="$" />
                        </div>
                        <Button size="sm" onClick={() => update.mutate({ id: t.id, unitCost: editing[t.id] })}>
                          OK
                        </Button>
                      </div>
                    ) : (
                      <button type="button" className="font-mono hover:underline" onClick={() => setEditing({ ...editing, [t.id]: t.unitCost })}>
                        {formatCurrency(t.unitCost)}
                      </button>
                    )}
                  </td>
                  <td className="py-2 text-right text-xs">{t.usedIn} receta(s)</td>
                  <td className="py-2 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground"
                      disabled={t.usedIn > 0}
                      title={t.usedIn > 0 ? "Lo usa alguna receta del pizarrón" : "Eliminar"}
                      onClick={() => del.mutate(t.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
