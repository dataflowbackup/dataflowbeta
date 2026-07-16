import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Download, Upload, Save, Package, RotateCcw, Pencil, X, AlertTriangle } from "lucide-react";
import type { Supply, Local, UnitOfMeasure } from "@shared/schema";

interface StockValuationRow {
  id: number;
  localId: number | null;
  valuationDate: string;
  totalValued: string | number;
  status: string;
}

interface CmvUsageRow {
  id: number;
  periodFrom: string | null;
  periodTo: string | null;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function StockValuationPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [valuationDate, setValuationDate] = useState(today());
  const [localId, setLocalId] = useState("all");
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reverseTarget, setReverseTarget] = useState<StockValuationRow | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  // Costos congelados de la valorización que se está editando: corregir cantidades no debe
  // re-precificar con los costos de hoy. Espeja la regla del server.
  const [costOverride, setCostOverride] = useState<Record<number, number>>({});

  const { data: supplies = [] } = useQuery<Supply[]>({ queryKey: ["/api/supplies"] });
  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: units = [] } = useQuery<UnitOfMeasure[]>({ queryKey: ["/api/units"] });
  const { data: valuations = [] } = useQuery<StockValuationRow[]>({ queryKey: ["/api/finance/stock-valuations"] });

  // CMV guardados que usan la valorización en edición: se recalculan al guardar.
  const { data: cmvUsage = [] } = useQuery<CmvUsageRow[]>({
    queryKey: ["/api/finance/stock-valuations", editingId, "cmv-usage"],
    enabled: editingId != null,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/finance/stock-valuations/${editingId}/cmv-usage`);
      return res.json();
    },
  });

  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.abbreviation || u.name])), [units]);
  const localName = useMemo(() => new Map(locals.map((l) => [l.id, l.name])), [locals]);

  const localOptions = useMemo(
    () => [{ value: "all", label: "Sin local / general" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );

  const cost = (s: Supply) => costOverride[s.id] ?? (parseFloat(String(s.lastCost ?? 0)) || 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return supplies;
    return supplies.filter((s) => s.name.toLowerCase().includes(q));
  }, [supplies, search]);

  const total = useMemo(
    () =>
      supplies.reduce((acc, s) => {
        const n = parseFloat(qty[s.id] ?? "");
        return acc + (Number.isFinite(n) && n > 0 ? n * cost(s) : 0);
      }, 0),
    [supplies, qty],
  );

  const filledCount = useMemo(
    () => Object.values(qty).filter((v) => parseFloat(v) > 0).length,
    [qty],
  );

  const exportTemplate = () => {
    const rows = supplies.map((s) => ({
      "ID Insumo": s.id,
      Insumo: s.name,
      Unidad: s.unitOfMeasureId ? unitName.get(s.unitOfMeasureId) ?? "" : "",
      "Costo reposición": cost(s),
      Cantidad: "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock");
    XLSX.writeFile(wb, `plantilla_stock_${valuationDate}.xlsx`);
  };

  const importFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as any[];
      const next: Record<number, string> = {};
      let matched = 0;
      const byName = new Map(supplies.map((s) => [s.name.trim().toLowerCase(), s.id]));
      for (const r of rows) {
        const idRaw = r["ID Insumo"] ?? r["id"] ?? r["ID"];
        const cantidad = r["Cantidad"] ?? r["cantidad"];
        let sid = idRaw != null ? parseInt(String(idRaw), 10) : NaN;
        if (!Number.isFinite(sid)) {
          const nm = String(r["Insumo"] ?? "").trim().toLowerCase();
          sid = byName.get(nm) ?? NaN;
        }
        const c = parseFloat(String(cantidad).replace(",", "."));
        if (Number.isFinite(sid) && Number.isFinite(c) && c > 0) {
          next[sid] = String(c);
          matched++;
        }
      }
      setQty(next);
      toast({ title: "Planilla importada", description: `${matched} insumos con cantidad cargada.` });
    } catch (e: any) {
      toast({ title: "No se pudo leer el Excel", description: e?.message, variant: "destructive" });
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setCostOverride({});
    setQty({});
    setValuationDate(today());
    setLocalId("all");
    setSearch("");
  };

  const startEdit = async (row: StockValuationRow) => {
    try {
      const res = await apiRequest("GET", `/api/finance/stock-valuations/${row.id}`);
      const data = await res.json();
      const nextQty: Record<number, string> = {};
      const nextCost: Record<number, number> = {};
      for (const it of data.items ?? []) {
        nextQty[it.supplyId] = String(parseFloat(String(it.quantity)) || 0);
        nextCost[it.supplyId] = parseFloat(String(it.replacementUnitCost ?? 0)) || 0;
      }
      setQty(nextQty);
      setCostOverride(nextCost);
      setValuationDate(String(data.valuation.valuationDate));
      setLocalId(data.valuation.localId != null ? String(data.valuation.localId) : "all");
      setSearch("");
      setEditingId(row.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      toast({ title: "No se pudo abrir la valorización", description: e?.message, variant: "destructive" });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = supplies
        .map((s) => ({ supplyId: s.id, quantity: parseFloat(qty[s.id] ?? "") }))
        .filter((it) => Number.isFinite(it.quantity) && it.quantity > 0);
      if (items.length === 0) throw new Error("Cargá al menos un insumo con cantidad");
      const body = {
        valuationDate,
        localId: localId === "all" ? null : parseInt(localId, 10),
        items,
      };
      const res = editingId != null
        ? await apiRequest("PUT", `/api/finance/stock-valuations/${editingId}`, body)
        : await apiRequest("POST", "/api/finance/stock-valuations", body);
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/stock-valuations"] });
      if (editingId != null) {
        queryClient.invalidateQueries({ queryKey: ["/api/finance/cmv-calculations"] });
        const recalc = result?.recalculatedCmvIds?.length ?? 0;
        const failed = result?.failedCmvIds?.length ?? 0;
        toast({
          title: "Valorización actualizada",
          description: `Total ${formatCurrency(total)} al ${valuationDate}.`
            + (recalc > 0 ? ` Se recalcularon ${recalc} CMV que la usan.` : "")
            + (failed > 0 ? ` ${failed} CMV no se pudieron recalcular: revisalos.` : ""),
          variant: failed > 0 ? "destructive" : undefined,
        });
      } else {
        toast({ title: "Valorización guardada", description: `Total ${formatCurrency(total)} al ${valuationDate}.` });
      }
      resetForm();
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const reverseMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/finance/stock-valuations/${id}/reverse`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/stock-valuations"] });
      toast({ title: "Valorización reversada" });
      setReverseTarget(null);
    },
    onError: (e: Error) => toast({ title: "Error al reversar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Valorizar Stock"
        description="Cantidad en stock × costo de reposición (última compra) de cada insumo"
      />

      <Card className={editingId != null ? "border-primary" : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {editingId != null && <Pencil className="h-4 w-4 text-primary" />}
              {editingId != null ? "Editando valorización" : "Nueva valorización"}
            </span>
            {editingId != null && (
              <Button variant="ghost" size="sm" onClick={resetForm} data-testid="button-cancel-edit">
                <X className="h-4 w-4 mr-1" /> Cancelar edición
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {editingId != null && cmvUsage.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-700 dark:text-amber-400">
                <p className="font-medium">
                  {cmvUsage.length === 1 ? "Hay 1 CMV guardado que usa esta valorización." : `Hay ${cmvUsage.length} CMV guardados que usan esta valorización.`}
                </p>
                <p className="text-xs mt-0.5">
                  Al guardar los cambios se recalculan automáticamente:{" "}
                  {cmvUsage.map((c) => `${c.periodFrom ?? "—"} → ${c.periodTo ?? "—"}`).join(" · ")}
                </p>
              </div>
            </div>
          )}
          {editingId != null && (
            <p className="text-xs text-muted-foreground">
              Los costos de reposición quedan como estaban cuando se creó la valorización. Un insumo que agregues ahora toma su costo actual.
            </p>
          )}
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Fecha</Label>
              <Input type="date" value={valuationDate} onChange={(e) => setValuationDate(e.target.value)} className="w-40" data-testid="input-valuation-date" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Local</Label>
              <DataEntryCombobox options={localOptions} value={localId} onValueChange={setLocalId} placeholder="Local" searchPlaceholder="Buscar local…" triggerClassName="w-48" data-testid="select-local" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={exportTemplate} data-testid="button-export-template">
                <Download className="h-4 w-4 mr-2" /> Exportar planilla
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) importFile(e.target.files[0]);
                  e.target.value = "";
                }}
                data-testid="input-import"
              />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-import">
                <Upload className="h-4 w-4 mr-2" /> Importar Excel
              </Button>
            </div>
          </div>

          <Input placeholder="Buscar insumo…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" data-testid="input-search" />

          <div className="rounded-md border max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Insumo</th>
                  <th className="text-left px-3 py-2 font-medium">Unidad</th>
                  <th className="text-right px-3 py-2 font-medium">Costo rep.</th>
                  <th className="text-right px-3 py-2 font-medium w-28">Cantidad</th>
                  <th className="text-right px-3 py-2 font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const n = parseFloat(qty[s.id] ?? "");
                  const sub = Number.isFinite(n) && n > 0 ? n * cost(s) : 0;
                  return (
                    <tr key={s.id} className="border-b">
                      <td className="px-3 py-1.5">{s.name}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{s.unitOfMeasureId ? unitName.get(s.unitOfMeasureId) ?? "—" : "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{formatCurrency(cost(s))}</td>
                      <td className="px-3 py-1.5">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={qty[s.id] ?? ""}
                          onChange={(e) => setQty((p) => ({ ...p, [s.id]: e.target.value }))}
                          className="h-7 text-right"
                          data-testid={`qty-${s.id}`}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{sub > 0 ? formatCurrency(sub) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">{filledCount} insumos cargados</div>
            <div className="flex items-center gap-4">
              <div className="text-lg font-bold font-mono" data-testid="text-total">Total: {formatCurrency(total)}</div>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || filledCount === 0} data-testid="button-save">
                <Save className="h-4 w-4 mr-2" />
                {saveMutation.isPending ? "Guardando..." : editingId != null ? "Guardar cambios" : "Guardar valorización"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" /> Valorizaciones guardadas</CardTitle>
        </CardHeader>
        <CardContent className="p-0 md:p-6">
          {valuations.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">Todavía no hay valorizaciones guardadas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium border-b">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium border-b">Local</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Total valorizado</th>
                    <th className="text-left px-3 py-2 font-medium border-b">Estado</th>
                    <th className="text-right px-3 py-2 font-medium border-b w-32">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {valuations.map((v) => (
                    <tr key={v.id} className="border-b">
                      <td className="px-3 py-2">{v.valuationDate}</td>
                      <td className="px-3 py-2 text-muted-foreground">{v.localId ? localName.get(v.localId) ?? "—" : "General"}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(v.totalValued)) || 0)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status === "active" ? "Activa" : "Reversada"}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {v.status === "active" && (
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Editar valorización" onClick={() => startEdit(v)} data-testid={`button-edit-${v.id}`}>
                              <Pencil className="h-4 w-4 text-muted-foreground" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Reversar (no borra: la marca como reversada)" onClick={() => setReverseTarget(v)} data-testid={`button-reverse-${v.id}`}>
                              <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!reverseTarget}
        onOpenChange={(o) => !o && setReverseTarget(null)}
        title="Reversar valorización"
        description={`¿Reversar la valorización del ${reverseTarget?.valuationDate}? Quedará marcada como reversada (no se borra el historial).`}
        confirmLabel="Reversar"
        variant="destructive"
        onConfirm={() => reverseTarget && reverseMutation.mutate(reverseTarget.id)}
        isLoading={reverseMutation.isPending}
      />
    </div>
  );
}
