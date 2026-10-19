/**
 * Pizarrón de Recetas — editor de una receta de prueba.
 *
 * Se arma y se costea igual que en Carta, pero nada de lo que se guarda acá impacta en Carta, CMV
 * ni informes. Solo el botón "Enviar a Carta" crea la receta real.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { QuantityInput } from "@/components/quantity-input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { DRAFT_QUERY_KEYS, useDraftData, type DraftRow, type TempSupplyRow } from "@/lib/recipe-drafts";
import {
  DRAFT_STATUS_LABELS,
  wouldCreateCycle,
  type DraftInput,
  type DraftLineInput,
  type DraftStatus,
} from "@shared/recipeDrafts";
import type { RecipeCategory, RecipeSubcategory, UnitOfMeasure, Rubro } from "@shared/schema";
import {
  Plus,
  Trash2,
  ChevronsUpDown,
  FlaskConical,
  Send,
  Copy,
  Pencil,
  AlertTriangle,
  ExternalLink,
  Lightbulb,
} from "lucide-react";

type LineType = DraftLineInput["lineType"];

interface EditLine {
  key: string;
  lineType: LineType | null;
  refId: number | null;
  quantity: number;
}

const newKey = () => Math.random().toString(36).slice(2);
const blankLine = (): EditLine => ({ key: newKey(), lineType: null, refId: null, quantity: 0 });

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v)}%`;

const STATUS_OPTIONS = (["borrador", "en_prueba", "aprobada", "descartada"] as DraftStatus[]).map((s) => ({
  value: s,
  label: DRAFT_STATUS_LABELS[s],
}));

const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Búsqueda por palabras: cada palabra tiene que estar en el nombre (sin tildes). El filtro difuso
 * de cmdk hacía que "arroz" encontrara "Regul-ar 8 oz", que confunde al elegir un insumo.
 */
function pickerFilter(value: string, search: string): number {
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const v = fold(value);
  return words.every((w) => v.includes(w)) ? 1 : 0;
}

function toLineInput(l: EditLine): DraftLineInput | null {
  if (!l.lineType || l.refId == null) return null;
  return {
    lineType: l.lineType,
    supplyId: l.lineType === "supply" ? l.refId : null,
    subRecipeId: l.lineType === "subrecipe" ? l.refId : null,
    draftSubId: l.lineType === "draft" ? l.refId : null,
    tempSupplyId: l.lineType === "temp" ? l.refId : null,
    quantity: l.quantity,
  };
}

function fromRow(d: DraftRow): EditLine[] {
  return d.lines.map((l) => ({
    key: newKey(),
    lineType: l.lineType,
    refId: l.lineType === "supply" ? l.supplyId : l.lineType === "subrecipe" ? l.subRecipeId : l.lineType === "draft" ? l.draftSubId : l.tempSupplyId,
    quantity: num(l.quantity),
  }));
}

export default function RecipeDraftFormPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const isNew = !params.id || params.id === "nueva";
  const draftId = isNew ? undefined : parseInt(params.id, 10);
  const typeFromQuery = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("type");

  const { sources, drafts, tempSupplies, coster, isLoading } = useDraftData();
  const { data: subcategories = [] } = useQuery<(RecipeSubcategory & { recipeCategory?: RecipeCategory | null })[]>({
    queryKey: ["/api/recipe-subcategories"],
  });
  const { data: units = [] } = useQuery<UnitOfMeasure[]>({ queryKey: ["/api/units"] });

  const existing = draftId != null ? drafts.find((d) => d.id === draftId) : undefined;

  // ── Estado del formulario ──
  const [name, setName] = useState("");
  const [recipeType, setRecipeType] = useState<"plato" | "sub">(typeFromQuery === "sub" ? "sub" : "plato");
  const [status, setStatus] = useState<DraftStatus>("borrador");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [salePrice, setSalePrice] = useState(0);
  const [removeIva, setRemoveIva] = useState(true);
  const [cmvIdeal, setCmvIdeal] = useState(0);
  const [usefulYield, setUsefulYield] = useState(0);
  const [yieldUnit, setYieldUnit] = useState("");
  const [description, setDescription] = useState("");
  const [preparationSteps, setPreparationSteps] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<EditLine[]>([blankLine()]);
  const [dirty, setDirty] = useState(false);
  const [loadedId, setLoadedId] = useState<number | null>(null);

  useEffect(() => {
    if (!existing || loadedId === existing.id) return;
    setName(existing.name);
    setRecipeType(existing.recipeType === "sub" ? "sub" : "plato");
    setStatus(existing.status);
    setSubcategoryId(existing.subcategoryId != null ? String(existing.subcategoryId) : "");
    setSalePrice(num(existing.salePriceWithTax));
    setRemoveIva(existing.removeIvaFromPrice !== false);
    setCmvIdeal(num(existing.cmvIdeal));
    setUsefulYield(num(existing.usefulYield));
    setYieldUnit(existing.yieldUnit ?? "");
    setDescription(existing.description ?? "");
    setPreparationSteps(existing.preparationSteps ?? "");
    setNotes(existing.notes ?? "");
    setLines(existing.lines.length > 0 ? fromRow(existing) : [blankLine()]);
    setLoadedId(existing.id);
    setDirty(false);
  }, [existing, loadedId]);

  const touch = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setDirty(true);
  };

  const isSub = recipeType === "sub";
  const isSent = existing?.status === "enviada";

  // ── Costeo en vivo ──
  const validLines = lines.map(toLineInput).filter((l): l is DraftLineInput => l != null);
  const draftInput: DraftInput = {
    id: draftId,
    name,
    recipeType,
    salePriceWithTax: salePrice,
    removeIvaFromPrice: removeIva,
    cmvIdeal: cmvIdeal > 0 ? cmvIdeal : null,
    usefulYield: usefulYield > 0 ? usefulYield : null,
    lines: validLines,
  };
  // El costeador memoriza por id: la versión en edición se costea sin id para no leer la guardada.
  const costing = coster ? coster.costDraft({ ...draftInput, id: undefined }) : null;
  const lineCost = (l: EditLine) => {
    const li = toLineInput(l);
    return li && coster ? coster.costLine(li) : null;
  };

  // ── Opciones del selector de ingredientes ──
  const subcategoryOptions = useMemo(
    () =>
      subcategories
        .filter((s) => s.active !== false)
        .sort((a, b) => `${a.recipeCategory?.name} ${a.name}`.localeCompare(`${b.recipeCategory?.name} ${b.name}`, "es"))
        .map((s) => ({ value: String(s.id), label: `${s.recipeCategory?.name ?? "?"} — ${s.name}` })),
    [subcategories],
  );
  const unitOptions = useMemo(
    () => units.filter((u) => u.active !== false).map((u) => ({ value: u.abbreviation || u.name, label: `${u.name} (${u.abbreviation})` })),
    [units],
  );

  const allDraftInputs = useMemo(
    () =>
      drafts.map((d) => ({
        id: d.id,
        name: d.name,
        recipeType: d.recipeType,
        salePriceWithTax: 0,
        removeIvaFromPrice: true,
        cmvIdeal: null,
        usefulYield: null,
        lines: d.lines.map((l) => ({ lineType: l.lineType, draftSubId: l.draftSubId, quantity: 1 })),
      })) as DraftInput[],
    [drafts],
  );
  const draftSubOptions = drafts.filter(
    (d) => d.recipeType === "sub" && d.id !== draftId && d.status !== "descartada" && !wouldCreateCycle(draftId, d.id, allDraftInputs),
  );

  const unitOfLine = (l: EditLine): string | null => {
    if (!l.lineType || l.refId == null || !sources) return null;
    if (l.lineType === "supply") return sources.supplies.find((s) => s.id === l.refId)?.unit ?? null;
    if (l.lineType === "subrecipe") return sources.subRecipes.find((s) => s.id === l.refId)?.unit ?? null;
    if (l.lineType === "temp") return tempSupplies.find((t) => t.id === l.refId)?.unit ?? null;
    return drafts.find((d) => d.id === l.refId)?.yieldUnit ?? null;
  };

  // ── Diálogos ──
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [tempDialog, setTempDialog] = useState<{ forLine?: string; editing?: TempSupplyRow } | null>(null);
  const [promoteOpen, setPromoteOpen] = useState(false);

  const setLine = (key: string, patch: Partial<EditLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  // ── Guardar ──
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        recipeType,
        status,
        subcategoryId: subcategoryId ? parseInt(subcategoryId, 10) : null,
        description: description || null,
        preparationSteps: preparationSteps || null,
        notes: notes || null,
        salePriceWithTax: isSub ? 0 : salePrice,
        removeIvaFromPrice: removeIva,
        cmvIdeal: cmvIdeal > 0 ? cmvIdeal : null,
        usefulYield: usefulYield > 0 ? usefulYield : null,
        yieldUnit: yieldUnit || null,
        lines: validLines,
      };
      const res = isNew
        ? await apiRequest("POST", "/api/recipe-drafts", payload)
        : await apiRequest("PUT", `/api/recipe-drafts/${draftId}`, payload);
      return (await res.json()) as DraftRow;
    },
    onSuccess: (saved) => {
      DRAFT_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      setDirty(false);
      toast({ title: "Guardada en el pizarrón", description: "No impacta en Carta." });
      if (isNew) {
        setLoadedId(null);
        navigate(`/pizarron-recetas/${saved.id}`);
      }
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => (await (await apiRequest("POST", `/api/recipe-drafts/${draftId}/duplicate`)).json()) as DraftRow,
    onSuccess: (copy) => {
      DRAFT_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      toast({ title: "Copia creada", description: copy.name });
      setLoadedId(null);
      navigate(`/pizarron-recetas/${copy.id}`);
    },
    onError: (e: Error) => toast({ title: "No se pudo duplicar", description: e.message, variant: "destructive" }),
  });

  const canSave = name.trim().length > 0 && validLines.length > 0 && validLines.every((l) => l.quantity > 0);

  if (!isNew && !isLoading && !existing) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pizarrón de Recetas" backHref="/pizarron-recetas" />
        <p className="text-sm text-muted-foreground">Esta receta del pizarrón no existe o fue eliminada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isNew ? (isSub ? "Nueva sub-receta de prueba" : "Nuevo plato de prueba") : name || "Receta de prueba"}
        description="Pizarrón: se arma y se costea igual que en Carta, pero no impacta en nada hasta que la envíes"
        backHref="/pizarron-recetas"
      />

      {isSent && existing?.promotedRecipeId && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Esta receta ya fue enviada a Carta. Lo que cambies acá queda en el pizarrón y no modifica la receta de Carta.
          </p>
          <Link href={`/recetas/${existing.promotedRecipeId}${isSub ? "?type=sub" : ""}`}>
            <Button size="sm" variant="outline">
              <ExternalLink className="h-4 w-4 mr-1.5" /> Ver en Carta
            </Button>
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* ── Datos ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="h-4 w-4" /> Datos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Nombre</Label>
                  <Input value={name} onChange={(e) => touch(setName)(e.target.value)} placeholder="Ej: Ñoquis de calabaza" data-testid="input-draft-name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <DataEntryCombobox
                    options={[
                      { value: "plato", label: "Plato" },
                      { value: "sub", label: "Sub-receta" },
                    ]}
                    value={recipeType}
                    onValueChange={(v) => touch(setRecipeType)(v === "sub" ? "sub" : "plato")}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Estado</Label>
                  {isSent ? (
                    <div className="h-10 flex items-center">
                      <Badge>Enviada a Carta</Badge>
                    </div>
                  ) : (
                    <DataEntryCombobox options={STATUS_OPTIONS} value={status} onValueChange={(v) => touch(setStatus)(v as DraftStatus)} />
                  )}
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Subcategoría {isSub ? "(opcional)" : "(con la que entraría a Carta)"}</Label>
                  <DataEntryCombobox
                    options={subcategoryOptions}
                    value={subcategoryId}
                    onValueChange={touch(setSubcategoryId)}
                    emptyOptionLabel="Sin subcategoría"
                    placeholder="Sin subcategoría"
                    searchPlaceholder="Buscar subcategoría…"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Ingredientes ── */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Ingredientes</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setLines((prev) => [...prev, blankLine()]);
                  setDirty(true);
                }}
                data-testid="button-add-line"
              >
                <Plus className="h-4 w-4 mr-1" /> Agregar
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="hidden sm:grid grid-cols-[1fr_140px_110px_110px_36px] gap-2 text-xs text-muted-foreground px-1">
                <span>Insumo o sub-receta</span>
                <span>Cantidad</span>
                <span className="text-right">Costo unit.</span>
                <span className="text-right">Costo</span>
                <span />
              </div>
              {lines.map((l) => {
                const c = lineCost(l);
                const unit = unitOfLine(l);
                const temp = l.lineType === "temp" ? tempSupplies.find((t) => t.id === l.refId) : undefined;
                return (
                  <div key={l.key} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_110px_110px_36px] gap-2 items-center border-b pb-2 sm:border-0 sm:pb-0">
                    <Popover
                      open={pickerOpen === l.key}
                      onOpenChange={(o) => {
                        setPickerOpen(o ? l.key : null);
                        setPickerSearch("");
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="justify-between font-normal w-full min-w-0">
                          <span className="truncate flex items-center gap-1.5">
                            {c ? c.label : <span className="text-muted-foreground">Elegí un ingrediente…</span>}
                            {l.lineType === "temp" && <Badge variant="secondary" className="text-[10px]">prueba</Badge>}
                            {l.lineType === "draft" && <Badge variant="secondary" className="text-[10px]">pizarrón</Badge>}
                            {l.lineType === "subrecipe" && <Badge variant="outline" className="text-[10px]">sub-receta</Badge>}
                          </span>
                          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(420px,90vw)] p-0" align="start">
                        <Command filter={pickerFilter}>
                          <CommandInput placeholder="Buscar…" value={pickerSearch} onValueChange={setPickerSearch} />
                          <CommandList className="max-h-80">
                            <CommandEmpty>Sin resultados.</CommandEmpty>
                            {tempSupplies.length > 0 && (
                              <CommandGroup heading="Insumos de prueba">
                                {tempSupplies.map((t) => (
                                  <CommandItem
                                    key={`t${t.id}`}
                                    value={`prueba ${t.name} t${t.id}`}
                                    onSelect={() => {
                                      setLine(l.key, { lineType: "temp", refId: t.id });
                                      setPickerOpen(null);
                                    }}
                                  >
                                    <span className="truncate">{t.name}</span>
                                    <span className="ml-auto text-xs text-muted-foreground font-mono">
                                      {formatCurrency(t.unitCost)}/{t.unit ?? "u"}
                                    </span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )}
                            {draftSubOptions.length > 0 && (
                              <CommandGroup heading="Sub-recetas del pizarrón">
                                {draftSubOptions.map((d) => (
                                  <CommandItem
                                    key={`d${d.id}`}
                                    value={`pizarron ${d.name} d${d.id}`}
                                    onSelect={() => {
                                      setLine(l.key, { lineType: "draft", refId: d.id });
                                      setPickerOpen(null);
                                    }}
                                  >
                                    <span className="truncate">{d.name}</span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )}
                            <CommandGroup heading="Sub-recetas de Carta">
                              {(sources?.subRecipes ?? []).filter((s) => s.active).map((s) => (
                                <CommandItem
                                  key={`r${s.id}`}
                                  value={`sub ${s.name} r${s.id}`}
                                  onSelect={() => {
                                    setLine(l.key, { lineType: "subrecipe", refId: s.id });
                                    setPickerOpen(null);
                                  }}
                                >
                                  <span className="truncate">{s.name}</span>
                                  <span className="ml-auto text-xs text-muted-foreground font-mono">
                                    {formatCurrency(s.unitCost)}/{s.unit ?? "u"}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                            <CommandGroup heading="Insumos">
                              {(sources?.supplies ?? []).filter((s) => s.active).map((s) => (
                                <CommandItem
                                  key={`s${s.id}`}
                                  value={`${s.name} s${s.id}`}
                                  onSelect={() => {
                                    setLine(l.key, { lineType: "supply", refId: s.id });
                                    setPickerOpen(null);
                                  }}
                                >
                                  <span className="truncate">{s.name}</span>
                                  <span className="ml-auto text-xs text-muted-foreground font-mono">
                                    {formatCurrency(s.unitCost)}/{s.unit ?? "u"}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                            {/* Siempre visible y al final: con Enter se elige lo buscado, no "crear". */}
                            <CommandGroup forceMount>
                              <CommandItem
                                forceMount
                                value="__crear_insumo_de_prueba__"
                                onSelect={() => {
                                  setPickerOpen(null);
                                  setTempDialog({ forLine: l.key });
                                }}
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Crear insumo de prueba{pickerSearch ? ` "${pickerSearch}"` : ""}
                              </CommandItem>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <QuantityInput value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} unit={unit} />
                    <div className="text-right font-mono text-sm">
                      {c ? formatCurrency(c.unitCost) : "—"}
                      {temp && (
                        <button
                          type="button"
                          className="ml-1 text-muted-foreground hover:text-foreground"
                          title="Editar el costo del insumo de prueba"
                          onClick={() => setTempDialog({ editing: temp })}
                        >
                          <Pencil className="inline h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className={`text-right font-mono text-sm font-medium ${c?.missing ? "text-amber-600" : ""}`}>
                      {c ? formatCurrency(c.lineCost) : "—"}
                      {c?.missing && <AlertTriangle className="inline h-3 w-3 ml-1" aria-label="Sin costo" />}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => {
                        setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.key !== l.key) : [blankLine()]));
                        setDirty(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              {costing && costing.missingLines > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 pt-1">
                  {costing.missingLines} ingrediente(s) no tienen costo: suman $0.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Notas ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Descripción y notas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs">Descripción</Label>
                <Textarea rows={2} value={description} onChange={(e) => touch(setDescription)(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Preparación</Label>
                <Textarea rows={3} value={preparationSteps} onChange={(e) => touch(setPreparationSteps)(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notas de la prueba (no viajan a Carta)</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => touch(setNotes)(e.target.value)}
                  placeholder="Ej: probar con otro proveedor de queso, el cliente pidió porción más chica…"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Costeo ── */}
        <div className="space-y-6">
          <Card className="lg:sticky lg:top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Costeo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!costing ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">Costo {isSub ? "de la tanda" : "del plato"}</span>
                    <span className="text-2xl font-bold font-mono" data-testid="text-draft-total-cost">
                      {formatCurrency(costing.totalCost)}
                    </span>
                  </div>

                  {isSub ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Rinde</Label>
                          <QuantityInput value={usefulYield} onChange={touch(setUsefulYield)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Unidad</Label>
                          <DataEntryCombobox options={unitOptions} value={yieldUnit} onValueChange={touch(setYieldUnit)} placeholder="Unidad" />
                        </div>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-sm text-muted-foreground">Costo por {yieldUnit || "unidad"}</span>
                        <span className="text-lg font-bold font-mono">{formatCurrency(costing.unitCost)}</span>
                      </div>
                      {!(usefulYield > 0) && (
                        <p className="text-xs text-muted-foreground">Sin rendimiento, la tanda entera cuenta como una unidad (igual que en Carta).</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Precio de venta (con IVA)</Label>
                        <QuantityInput value={salePrice} onChange={touch(setSalePrice)} unit="$" />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={removeIva} onCheckedChange={touch(setRemoveIva)} />
                        Quitarle el IVA para costear
                      </label>
                      <div className="space-y-1">
                        <Label className="text-xs">CMV ideal %</Label>
                        <QuantityInput value={cmvIdeal} onChange={touch(setCmvIdeal)} unit="%" />
                      </div>
                      <Separator />
                      {costing.metrics && (
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">CMV</p>
                            <p
                              className={`text-lg font-bold font-mono ${
                                cmvIdeal > 0 && costing.metrics.salePrice > 0
                                  ? costing.metrics.cmvPercentage > cmvIdeal
                                    ? "text-destructive"
                                    : "text-emerald-600 dark:text-emerald-500"
                                  : ""
                              }`}
                            >
                              {costing.metrics.salePrice > 0 ? fmtPct(costing.metrics.cmvPercentage) : "—"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Margen</p>
                            <p className="text-lg font-bold font-mono">{costing.metrics.salePrice > 0 ? formatCurrency(costing.metrics.margin) : "—"}</p>
                            <p className="text-[11px] text-muted-foreground">{fmtPct(costing.metrics.marginPercentage)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Precio de referencia</p>
                            <p className="font-mono">{formatCurrency(costing.metrics.salePrice)}</p>
                            <p className="text-[11px] text-muted-foreground">{removeIva ? "sin IVA" : "con IVA"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Markup</p>
                            <p className="font-mono">{fmtPct(costing.metrics.markup)}</p>
                          </div>
                        </div>
                      )}
                      {costing.suggestedGrossPrice != null && (
                        <div className="rounded-lg border bg-muted/40 p-3 flex gap-2">
                          <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div className="text-sm">
                            Para un CMV de {fmtPct(cmvIdeal)} el precio de venta tendría que ser{" "}
                            <span className="font-semibold font-mono">{formatCurrency(costing.suggestedGrossPrice)}</span> (con IVA).
                            <button
                              type="button"
                              className="block text-xs text-primary hover:underline mt-1"
                              onClick={() => touch(setSalePrice)(Math.round(costing.suggestedGrossPrice! / 10) * 10)}
                            >
                              Usar ese precio (redondeado)
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              <Separator />
              <div className="flex flex-col gap-2">
                <Button onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending} data-testid="button-save-draft">
                  {saveMutation.isPending ? "Guardando…" : dirty || isNew ? "Guardar en el pizarrón" : "Guardado"}
                </Button>
                {!isNew && (
                  <>
                    <Button variant="outline" onClick={() => duplicateMutation.mutate()} disabled={duplicateMutation.isPending}>
                      <Copy className="h-4 w-4 mr-1.5" /> Duplicar para probar una variante
                    </Button>
                    {!isSent && (
                      <Button
                        variant="secondary"
                        onClick={() => setPromoteOpen(true)}
                        disabled={dirty}
                        title={dirty ? "Guardá los cambios antes de enviarla" : undefined}
                        data-testid="button-promote-draft"
                      >
                        <Send className="h-4 w-4 mr-1.5" /> Enviar a Carta
                      </Button>
                    )}
                  </>
                )}
                {!canSave && (
                  <p className="text-xs text-muted-foreground">Para guardar: un nombre y al menos un ingrediente con cantidad.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <TempSupplyDialog
        state={tempDialog}
        initialName={pickerSearch}
        units={units}
        onClose={() => setTempDialog(null)}
        onSaved={(row, forLine) => {
          DRAFT_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
          if (forLine) setLine(forLine, { lineType: "temp", refId: row.id });
        }}
      />

      {existing && promoteOpen && (
        <PromoteDialog
          draft={existing}
          drafts={drafts}
          tempSupplies={tempSupplies}
          supplies={sources?.supplies ?? []}
          subcategoryOptions={subcategoryOptions}
          onClose={() => setPromoteOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Insumo de prueba (crear / editar) ────────────────────────────────────────

function TempSupplyDialog({
  state,
  initialName,
  units,
  onClose,
  onSaved,
}: {
  state: { forLine?: string; editing?: TempSupplyRow } | null;
  initialName: string;
  units: UnitOfMeasure[];
  onClose: () => void;
  onSaved: (row: TempSupplyRow, forLine?: string) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [unitId, setUnitId] = useState("");
  const [cost, setCost] = useState(0);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!state) return;
    if (state.editing) {
      setName(state.editing.name);
      setUnitId(state.editing.unitOfMeasureId != null ? String(state.editing.unitOfMeasureId) : "");
      setCost(state.editing.unitCost);
      setNotes(state.editing.notes ?? "");
    } else {
      setName(initialName);
      setUnitId("");
      setCost(0);
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, unitOfMeasureId: unitId ? parseInt(unitId, 10) : null, unitCost: cost, notes: notes || null };
      const res = state?.editing
        ? await apiRequest("PATCH", `/api/recipe-draft-supplies/${state.editing.id}`, body)
        : await apiRequest("POST", "/api/recipe-draft-supplies", body);
      return (await res.json()) as TempSupplyRow;
    },
    onSuccess: (row) => {
      onSaved(row, state?.forLine);
      toast({ title: state?.editing ? "Insumo de prueba actualizado" : "Insumo de prueba creado" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const unit = units.find((u) => String(u.id) === unitId);

  return (
    <Dialog open={state != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.editing ? "Editar insumo de prueba" : "Nuevo insumo de prueba"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Solo existe en el pizarrón: no aparece en Insumos ni necesita factura. Si después enviás la receta a Carta, vas a
            elegir si se vincula a un insumo existente o se crea uno nuevo.
          </p>
          {state?.editing && state.editing.usedIn > 1 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Lo usan {state.editing.usedIn} recetas del pizarrón: el cambio de costo vale para todas.
            </p>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Trufa negra" />
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <Label className="text-xs">Costo por {unit?.abbreviation ?? "unidad"} (sin IVA)</Label>
              <QuantityInput value={cost} onChange={setCost} unit="$" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Nota (opcional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: cotización de proveedor X" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || !unitId || save.isPending}>
            {save.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Enviar a Carta ───────────────────────────────────────────────────────────

type Mapping = { mode: "link"; supplyId: number | null } | { mode: "create"; rubroId: number | null };

function PromoteDialog({
  draft,
  drafts,
  tempSupplies,
  supplies,
  subcategoryOptions,
  onClose,
}: {
  draft: DraftRow;
  drafts: DraftRow[];
  tempSupplies: TempSupplyRow[];
  supplies: Array<{ id: number; name: string; unit: string | null; unitCost: number; active: boolean }>;
  subcategoryOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: rubros = [] } = useQuery<Rubro[]>({ queryKey: ["/api/rubros"] });
  const isSub = draft.recipeType === "sub";
  const [subcategoryId, setSubcategoryId] = useState(draft.subcategoryId != null ? String(draft.subcategoryId) : "");

  const pendingTemp = useMemo(() => {
    const ids = new Set(draft.lines.filter((l) => l.lineType === "temp" && l.tempSupplyId != null).map((l) => l.tempSupplyId!));
    return tempSupplies.filter((t) => ids.has(t.id) && t.linkedSupplyId == null);
  }, [draft, tempSupplies]);

  const blockingSubs = draft.lines
    .filter((l) => l.lineType === "draft")
    .map((l) => drafts.find((d) => d.id === l.draftSubId))
    .filter((d) => !d?.promotedRecipeId)
    .map((d) => d?.name ?? "(eliminada)");

  // Sugerencia: el insumo real con el mismo nombre, si existe.
  const [mappings, setMappings] = useState<Record<number, Mapping>>(() => {
    const out: Record<number, Mapping> = {};
    for (const t of pendingTemp) {
      const same = supplies.find((s) => s.active && s.name.trim().toLowerCase() === t.name.trim().toLowerCase());
      out[t.id] = same ? { mode: "link", supplyId: same.id } : { mode: "create", rubroId: null };
    }
    return out;
  });

  const supplyOptions = useMemo(
    () => supplies.filter((s) => s.active).map((s) => ({ value: String(s.id), label: `${s.name}${s.unit ? ` (${s.unit})` : ""} — ${formatCurrency(s.unitCost)}` })),
    [supplies],
  );
  const rubroOptions = useMemo(() => rubros.map((r) => ({ value: String(r.id), label: r.name })), [rubros]);

  const ready =
    blockingSubs.length === 0 &&
    (isSub || !!subcategoryId) &&
    pendingTemp.every((t) => {
      const m = mappings[t.id];
      return m && (m.mode === "create" || m.supplyId != null);
    });

  const promote = useMutation({
    mutationFn: async () => {
      const body = {
        subcategoryId: subcategoryId ? parseInt(subcategoryId, 10) : null,
        mappings: Object.fromEntries(
          pendingTemp.map((t) => {
            const m = mappings[t.id];
            return [String(t.id), m.mode === "link" ? { mode: "link", supplyId: m.supplyId } : { mode: "create", rubroId: m.rubroId }];
          }),
        ),
      };
      const res = await apiRequest("POST", `/api/recipe-drafts/${draft.id}/promote`, body);
      return (await res.json()) as { recipeId: number; createdSupplies: Array<{ name: string }> };
    },
    onSuccess: (r) => {
      DRAFT_QUERY_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: k }));
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      toast({
        title: "Enviada a Carta",
        description:
          r.createdSupplies.length > 0
            ? `Se crearon ${r.createdSupplies.length} insumo(s): ${r.createdSupplies.map((s) => s.name).join(", ")}.`
            : "La receta ya está en Carta.",
      });
      onClose();
      navigate(`/recetas/${r.recipeId}${isSub ? "?type=sub" : ""}`);
    },
    onError: (e: Error) => toast({ title: "No se pudo enviar", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar "{draft.name}" a Carta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Se crea la {isSub ? "sub-receta" : "receta"} en Carta con estos ingredientes y cantidades, costeada con los precios
            de hoy. Desde ese momento entra en CMV, consumo e informes como cualquier otra. El borrador queda en el pizarrón
            como historial.
          </p>

          {blockingSubs.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Usa sub-recetas del pizarrón que todavía no están en Carta: {blockingSubs.join(", ")}. Enviá esas primero.
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Subcategoría en Carta {isSub ? "(si no elegís, va a Producción)" : ""}</Label>
            <DataEntryCombobox
              options={subcategoryOptions}
              value={subcategoryId}
              onValueChange={setSubcategoryId}
              placeholder={isSub ? "Producción (por defecto)" : "Elegí la subcategoría"}
              emptyOptionLabel={isSub ? "Producción (por defecto)" : undefined}
              searchPlaceholder="Buscar subcategoría…"
            />
          </div>

          {pendingTemp.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Insumos de prueba</p>
              {pendingTemp.map((t) => {
                const m = mappings[t.id];
                return (
                  <div key={t.id} className="rounded-lg border p-3 space-y-2">
                    <p className="text-sm font-medium">
                      {t.name}{" "}
                      <span className="text-xs text-muted-foreground font-normal font-mono">
                        {formatCurrency(t.unitCost)}/{t.unit ?? "u"}
                      </span>
                    </p>
                    <RadioGroup
                      value={m.mode}
                      onValueChange={(v) =>
                        setMappings({ ...mappings, [t.id]: v === "link" ? { mode: "link", supplyId: null } : { mode: "create", rubroId: null } })
                      }
                      className="flex flex-wrap gap-4"
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="link" /> Vincular a un insumo existente
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value="create" /> Crearlo como insumo nuevo
                      </label>
                    </RadioGroup>
                    {m.mode === "link" ? (
                      <DataEntryCombobox
                        options={supplyOptions}
                        value={m.supplyId != null ? String(m.supplyId) : ""}
                        onValueChange={(v) => setMappings({ ...mappings, [t.id]: { mode: "link", supplyId: v ? parseInt(v, 10) : null } })}
                        placeholder="Elegí el insumo"
                        searchPlaceholder="Buscar insumo…"
                      />
                    ) : (
                      <div className="space-y-1">
                        <DataEntryCombobox
                          options={rubroOptions}
                          value={m.rubroId != null ? String(m.rubroId) : ""}
                          onValueChange={(v) => setMappings({ ...mappings, [t.id]: { mode: "create", rubroId: v ? parseInt(v, 10) : null } })}
                          placeholder="Rubro (opcional)"
                          emptyOptionLabel="Sin rubro"
                          searchPlaceholder="Buscar rubro…"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Nace con {formatCurrency(t.unitCost)} como último costo. Cuando cargues la primera factura, toma el precio real.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => promote.mutate()} disabled={!ready || promote.isPending} data-testid="button-confirm-promote">
            <Send className="h-4 w-4 mr-1.5" /> {promote.isPending ? "Enviando…" : "Enviar a Carta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
