import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Upload, Save, Trash2 } from "lucide-react";
import { parseDataliveReport, type ParsedDataliveDay } from "@shared/dataliveSalesParser";
import { parseDataliveProductsReport, type ParsedDataliveProducto } from "@shared/dataliveProductsParser";
import type { Local } from "@shared/schema";

const DELETE_KEYWORD = "BORRAR";

interface DataliveVentaRow {
  id: number;
  localId: number;
  fecha: string;
  ventaTotal: string | number;
  ventaEfectivo: string | number;
  ventaOnline: string | number;
}

interface DataliveProductoRow {
  id: number;
  localId: number;
  fechaDesde: string;
  fechaHasta: string;
  producto: string;
  cantidad: number;
}

export default function DataliveVentasPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const prodFileRef = useRef<HTMLInputElement>(null);

  // ── estado Tab Ventas ──
  const [localId, setLocalId] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedDays, setParsedDays] = useState<ParsedDataliveDay[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [replaceSet, setReplaceSet] = useState<Set<string>>(new Set());
  const [filterLocalId, setFilterLocalId] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [deleteRow, setDeleteRow] = useState<DataliveVentaRow | null>(null);
  const [deleteKeyword, setDeleteKeyword] = useState("");

  // ── estado Tab Productos ──
  const [prodLocalId, setProdLocalId] = useState("");
  const [prodFechaDesde, setProdFechaDesde] = useState("");
  const [prodFechaHasta, setProdFechaHasta] = useState("");
  const [prodFileName, setProdFileName] = useState("");
  const [parsedProductos, setParsedProductos] = useState<ParsedDataliveProducto[]>([]);
  const [prodWarnings, setProdWarnings] = useState<string[]>([]);
  const [prodReplace, setProdReplace] = useState(false);
  const [filterProdLocalId, setFilterProdLocalId] = useState("all");
  const [filterProdFrom, setFilterProdFrom] = useState("");
  const [filterProdTo, setFilterProdTo] = useState("");

  // ── estado borrado de período ──
  interface PeriodoKey { localId: number; fechaDesde: string; fechaHasta: string }
  const [deletePeriodo, setDeletePeriodo] = useState<PeriodoKey | null>(null);
  const [deletePeriodoKw, setDeletePeriodoKw] = useState("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: existing = [] } = useQuery<DataliveVentaRow[]>({
    queryKey: ["/api/datalive-ventas"],
    queryFn: async () => {
      const res = await fetch(`/api/datalive-ventas`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar ventas");
      return res.json();
    },
  });
  const { data: productos = [] } = useQuery<DataliveProductoRow[]>({
    queryKey: ["/api/datalive-productos"],
    queryFn: async () => {
      const res = await fetch(`/api/datalive-productos`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar productos");
      return res.json();
    },
  });

  const localOptions = useMemo(() => locals.map((l) => ({ value: String(l.id), label: l.name })), [locals]);
  const localNameById = useMemo(() => new Map(locals.map((l) => [l.id, l.name])), [locals]);
  const existingFechas = useMemo(
    () => new Set(existing.filter((e) => String(e.localId) === localId).map((e) => String(e.fecha))),
    [existing, localId],
  );

  // ── handlers Ventas ──
  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as any[][];
      const res = parseDataliveReport(rows);
      setParsedDays(res.days);
      setWarnings(res.warnings);
      setFileName(file.name);
      setReplaceSet(new Set());
      if (res.days.length === 0) {
        toast({ title: "No se leyeron ventas del archivo", description: res.warnings.join(" ") || undefined, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "No se pudo leer el archivo", description: e?.message, variant: "destructive" });
    }
  };

  // ── handler Productos ──
  const handleProdFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as any[][];
      const res = parseDataliveProductsReport(rows);
      setParsedProductos(res.items);
      setProdWarnings(res.warnings);
      setProdFileName(file.name);
      setProdReplace(false);
      if (res.items.length === 0) {
        toast({ title: "No se leyeron productos del archivo", description: res.warnings.join(" ") || undefined, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "No se pudo leer el archivo", description: e?.message, variant: "destructive" });
    }
  };

  const counts = useMemo(() => {
    let nuevos = 0; let yaImport = 0; let aReemplazar = 0;
    for (const d of parsedDays) {
      if (existingFechas.has(d.fecha)) { yaImport++; if (replaceSet.has(d.fecha)) aReemplazar++; }
      else nuevos++;
    }
    return { nuevos, yaImport, aReemplazar };
  }, [parsedDays, existingFechas, replaceSet]);

  // ¿ya existe el período para este local en productos?
  const existingPeriod = useMemo(() => {
    if (!prodLocalId || !prodFechaDesde || !prodFechaHasta) return false;
    return productos.some(
      (p) => String(p.localId) === prodLocalId && String(p.fechaDesde) === prodFechaDesde && String(p.fechaHasta) === prodFechaHasta,
    );
  }, [productos, prodLocalId, prodFechaDesde, prodFechaHasta]);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!localId) throw new Error("Elegí el local");
      const res = await apiRequest("POST", "/api/datalive-ventas/import", {
        localId: parseInt(localId, 10),
        sourceFile: fileName,
        days: parsedDays,
        replaceFechas: Array.from(replaceSet),
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/datalive-ventas"] });
      toast({ title: "Importación lista", description: `${r.insertados} nuevo(s), ${r.reemplazados} reemplazado(s), ${r.omitidos} omitido(s).` });
      setParsedDays([]); setFileName(""); setReplaceSet(new Set());
    },
    onError: (e: Error) => toast({ title: "No se pudo importar", description: e.message, variant: "destructive" }),
  });

  const importProdMutation = useMutation({
    mutationFn: async () => {
      if (!prodLocalId) throw new Error("Elegí el local");
      if (!prodFechaDesde || !prodFechaHasta) throw new Error("Seleccioná el período");
      const res = await apiRequest("POST", "/api/datalive-productos/import", {
        localId: parseInt(prodLocalId, 10),
        fechaDesde: prodFechaDesde,
        fechaHasta: prodFechaHasta,
        sourceFile: prodFileName,
        replace: prodReplace,
        items: parsedProductos,
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/datalive-productos"] });
      toast({ title: "Importación lista", description: `${r.insertados} nuevo(s), ${r.reemplazados} reemplazado(s), ${r.omitidos} omitido(s).` });
      setParsedProductos([]); setProdFileName(""); setProdReplace(false);
    },
    onError: (e: Error) => toast({ title: "No se pudo importar", description: e.message, variant: "destructive" }),
  });

  const filteredExisting = useMemo(() => {
    return existing.filter((e) => {
      if (filterLocalId !== "all" && String(e.localId) !== filterLocalId) return false;
      const f = String(e.fecha);
      if (filterFrom && f < filterFrom) return false;
      if (filterTo && f > filterTo) return false;
      return true;
    });
  }, [existing, filterLocalId, filterFrom, filterTo]);

  const totals = useMemo(() => {
    let total = 0; let efectivo = 0; let online = 0;
    for (const e of filteredExisting) {
      total += parseFloat(String(e.ventaTotal)) || 0;
      efectivo += parseFloat(String(e.ventaEfectivo)) || 0;
      online += parseFloat(String(e.ventaOnline)) || 0;
    }
    return { total, efectivo, online, dias: filteredExisting.length };
  }, [filteredExisting]);

  const filteredProductos = useMemo(() => {
    return productos.filter((p) => {
      if (filterProdLocalId !== "all" && String(p.localId) !== filterProdLocalId) return false;
      if (filterProdFrom && String(p.fechaDesde) < filterProdFrom) return false;
      if (filterProdTo && String(p.fechaHasta) > filterProdTo) return false;
      return true;
    });
  }, [productos, filterProdLocalId, filterProdFrom, filterProdTo]);

  const prodAgrupados = useMemo(() => {
    const byProd = new Map<string, { producto: string; cantidad: number }>();
    for (const p of filteredProductos) {
      if (!byProd.has(p.producto)) byProd.set(p.producto, { producto: p.producto, cantidad: 0 });
      byProd.get(p.producto)!.cantidad += p.cantidad;
    }
    return Array.from(byProd.values()).sort((a, b) => b.cantidad - a.cantidad);
  }, [filteredProductos]);

  // Períodos distintos cargados (para mostrar con botón de borrar)
  const periodosDistintos = useMemo(() => {
    const map = new Map<string, { localId: number; fechaDesde: string; fechaHasta: string; count: number }>();
    for (const p of productos) {
      const key = `${p.localId}||${p.fechaDesde}||${p.fechaHasta}`;
      if (!map.has(key)) map.set(key, { localId: p.localId, fechaDesde: String(p.fechaDesde), fechaHasta: String(p.fechaHasta), count: 0 });
      map.get(key)!.count++;
    }
    return Array.from(map.values()).sort((a, b) => b.fechaDesde.localeCompare(a.fechaDesde));
  }, [productos]);

  const deletePeriodoMutation = useMutation({
    mutationFn: async (p: { localId: number; fechaDesde: string; fechaHasta: string }) => {
      const res = await apiRequest("DELETE", "/api/datalive-productos/periodo", p);
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/datalive-productos"] });
      toast({ title: "Período eliminado", description: `${r.eliminados} producto(s) eliminados.` });
      setDeletePeriodo(null);
      setDeletePeriodoKw("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/datalive-ventas/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/datalive-ventas"] });
      toast({ title: "Venta eliminada" });
      setDeleteRow(null); setDeleteKeyword("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const closeDeleteDialog = () => { setDeleteRow(null); setDeleteKeyword(""); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas Datalive"
        description="Importá el reporte diario de Datalive por local (venta bruta: total, efectivo y online)"
      />

      <Tabs defaultValue="ventas">
        <TabsList>
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="productos">Productos vendidos</TabsTrigger>
        </TabsList>

        {/* ── TAB VENTAS ── */}
        <TabsContent value="ventas" className="space-y-6 mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Importar reporte</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Local *</Label>
                  <DataEntryCombobox
                    options={localOptions}
                    value={localId}
                    onValueChange={(v) => { setLocalId(v); setParsedDays([]); setFileName(""); setReplaceSet(new Set()); }}
                    placeholder="Elegí el local (manual)"
                    searchPlaceholder="Buscar local…"
                    triggerClassName="w-64"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reporte Datalive (.xls)</Label>
                  <div>
                    <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden"
                      onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }} />
                    <Button type="button" variant="outline" disabled={!localId} onClick={() => fileRef.current?.click()}>
                      <Upload className="h-4 w-4 mr-2" /> {fileName || "Subir archivo"}
                    </Button>
                  </div>
                </div>
              </div>
              {!localId && <p className="text-xs text-muted-foreground">Primero elegí el local; el local NO se detecta del archivo.</p>}

              {warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {warnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}

              {parsedDays.length > 0 && (
                <>
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-3 py-2 font-medium border-b">Día</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Total</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Efectivo</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Online</th>
                          <th className="text-left px-3 py-2 font-medium border-b">Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedDays.map((d) => {
                          const ya = existingFechas.has(d.fecha);
                          return (
                            <tr key={d.fecha} className="border-b">
                              <td className="px-3 py-2 font-mono">{d.fecha}</td>
                              <td className="px-3 py-2 text-right font-mono">{formatCurrency(d.ventaTotal)}</td>
                              <td className="px-3 py-2 text-right font-mono">{formatCurrency(d.ventaEfectivo)}</td>
                              <td className="px-3 py-2 text-right font-mono">{formatCurrency(d.ventaOnline)}</td>
                              <td className="px-3 py-2">
                                {ya ? (
                                  <label className="flex items-center gap-2">
                                    <Badge variant="secondary">Ya importado</Badge>
                                    <Checkbox
                                      checked={replaceSet.has(d.fecha)}
                                      onCheckedChange={(c) =>
                                        setReplaceSet((prev) => { const next = new Set(prev); c ? next.add(d.fecha) : next.delete(d.fecha); return next; })
                                      }
                                    />
                                    <span className="text-xs text-muted-foreground">Reemplazar</span>
                                  </label>
                                ) : (
                                  <Badge>Nuevo</Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {counts.nuevos} nuevo(s) · {counts.aReemplazar} a reemplazar · {counts.yaImport - counts.aReemplazar} se omiten
                    </div>
                    <Button
                      onClick={() => importMutation.mutate()}
                      disabled={importMutation.isPending || (counts.nuevos === 0 && counts.aReemplazar === 0)}
                    >
                      <Save className="h-4 w-4 mr-2" /> {importMutation.isPending ? "Importando..." : "Confirmar importación"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {existing.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Ventas Datalive cargadas</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Local</Label>
                    <DataEntryCombobox
                      options={[{ value: "all", label: "Todos los locales" }, ...localOptions]}
                      value={filterLocalId}
                      onValueChange={setFilterLocalId}
                      placeholder="Todos los locales"
                      searchPlaceholder="Buscar local…"
                      triggerClassName="w-64"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fecha</Label>
                    <DateRangePicker from={filterFrom} to={filterTo} onChange={(f, t) => { setFilterFrom(f); setFilterTo(t); }} placeholder="Todas las fechas" />
                  </div>
                  {(filterLocalId !== "all" || filterFrom || filterTo) && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setFilterLocalId("all"); setFilterFrom(""); setFilterTo(""); }}>
                      Limpiar filtros
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Venta Total</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.total)}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Efectivo</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.efectivo)}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Online</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.online)}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Días</p>
                    <p className="text-lg font-semibold font-mono">{totals.dias}</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium border-b">Local</th>
                        <th className="text-left px-3 py-2 font-medium border-b">Día</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Total</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Efectivo</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Online</th>
                        <th className="px-3 py-2 font-medium border-b w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExisting.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No hay ventas para el filtro seleccionado.</td></tr>
                      ) : (
                        filteredExisting.map((e) => (
                          <tr key={e.id} className="border-b">
                            <td className="px-3 py-2">{localNameById.get(e.localId) ?? `Local ${e.localId}`}</td>
                            <td className="px-3 py-2 font-mono">{e.fecha}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaTotal)) || 0)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaEfectivo)) || 0)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaOnline)) || 0)}</td>
                            <td className="px-3 py-2 text-center">
                              <Button variant="ghost" size="icon" className="h-8 w-8"
                                onClick={() => { setDeleteRow(e); setDeleteKeyword(""); }}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── TAB PRODUCTOS ── */}
        <TabsContent value="productos" className="space-y-6 mt-4">
          {/* Card de importación */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Importar productos Datalive</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end flex-wrap">
                <div className="space-y-1">
                  <Label className="text-xs">Local *</Label>
                  <DataEntryCombobox
                    options={localOptions}
                    value={prodLocalId}
                    onValueChange={(v) => { setProdLocalId(v); setParsedProductos([]); setProdFileName(""); setProdReplace(false); }}
                    placeholder="Elegí el local"
                    searchPlaceholder="Buscar local…"
                    triggerClassName="w-56"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Período (rango de fechas) *</Label>
                  <DateRangePicker
                    from={prodFechaDesde}
                    to={prodFechaHasta}
                    onChange={(f, t) => { setProdFechaDesde(f); setProdFechaHasta(t); setParsedProductos([]); setProdFileName(""); setProdReplace(false); }}
                    placeholder="Elegí el período"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reporte de productos (.xls)</Label>
                  <div>
                    <input ref={prodFileRef} type="file" accept=".xls,.xlsx" className="hidden"
                      onChange={(e) => { if (e.target.files?.[0]) handleProdFile(e.target.files[0]); e.target.value = ""; }} />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!prodLocalId || !prodFechaDesde || !prodFechaHasta}
                      onClick={() => prodFileRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" /> {prodFileName || "Subir archivo"}
                    </Button>
                  </div>
                </div>
              </div>
              {(!prodLocalId || !prodFechaDesde) && (
                <p className="text-xs text-muted-foreground">Primero elegí el local y el período antes de subir el archivo.</p>
              )}

              {prodWarnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {prodWarnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}

              {parsedProductos.length > 0 && (
                <>
                  {existingPeriod && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-3">
                      <span>Ya existen productos para este local y período.</span>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox checked={prodReplace} onCheckedChange={(c) => setProdReplace(!!c)} />
                        <span>Reemplazar todo el período</span>
                      </label>
                    </div>
                  )}

                  <div className="rounded-md border overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/80">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium border-b">Producto</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Cantidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedProductos.map((p, i) => (
                          <tr key={i} className="border-b">
                            <td className="px-3 py-2">{p.producto}</td>
                            <td className="px-3 py-2 text-right font-mono">{p.cantidad.toLocaleString("es-AR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {parsedProductos.length} producto(s) detectados
                      {existingPeriod && !prodReplace && " · se omitirán los ya existentes"}
                      {existingPeriod && prodReplace && " · se reemplazará el período completo"}
                    </div>
                    <Button
                      onClick={() => importProdMutation.mutate()}
                      disabled={importProdMutation.isPending || (existingPeriod && !prodReplace)}
                    >
                      <Save className="h-4 w-4 mr-2" /> {importProdMutation.isPending ? "Importando..." : "Confirmar importación"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Períodos cargados con botón de borrar */}
          {periodosDistintos.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Períodos cargados</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium border-b">Local</th>
                        <th className="text-left px-3 py-2 font-medium border-b">Desde</th>
                        <th className="text-left px-3 py-2 font-medium border-b">Hasta</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Productos</th>
                        <th className="px-3 py-2 border-b w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodosDistintos.map((p, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-3 py-2">{localNameById.get(p.localId) ?? `Local ${p.localId}`}</td>
                          <td className="px-3 py-2 font-mono">{p.fechaDesde}</td>
                          <td className="px-3 py-2 font-mono">{p.fechaHasta}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.count}</td>
                          <td className="px-3 py-2 text-center">
                            <Button variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => { setDeletePeriodo(p); setDeletePeriodoKw(""); }}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabla de productos cargados con filtros */}
          {productos.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Productos Datalive cargados</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Local</Label>
                    <DataEntryCombobox
                      options={[{ value: "all", label: "Todos los locales" }, ...localOptions]}
                      value={filterProdLocalId}
                      onValueChange={setFilterProdLocalId}
                      placeholder="Todos los locales"
                      searchPlaceholder="Buscar local…"
                      triggerClassName="w-64"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Período</Label>
                    <DateRangePicker
                      from={filterProdFrom}
                      to={filterProdTo}
                      onChange={(f, t) => { setFilterProdFrom(f); setFilterProdTo(t); }}
                      placeholder="Todos los períodos"
                    />
                  </div>
                  {(filterProdLocalId !== "all" || filterProdFrom || filterProdTo) && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setFilterProdLocalId("all"); setFilterProdFrom(""); setFilterProdTo(""); }}>
                      Limpiar filtros
                    </Button>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium border-b">Producto</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Cantidad total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodAgrupados.length === 0 ? (
                        <tr><td colSpan={2} className="px-3 py-6 text-center text-muted-foreground">No hay productos para el filtro seleccionado.</td></tr>
                      ) : (
                        prodAgrupados.map((p, i) => (
                          <tr key={i} className="border-b">
                            <td className="px-3 py-2">{p.producto}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">{p.cantidad.toLocaleString("es-AR")}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog borrar período de productos */}
      <Dialog open={!!deletePeriodo} onOpenChange={(o) => { if (!o) { setDeletePeriodo(null); setDeletePeriodoKw(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar período de productos</DialogTitle>
            <DialogDescription>
              {deletePeriodo && (
                <>Vas a eliminar todos los productos de <span className="font-medium">{localNameById.get(deletePeriodo.localId) ?? `Local ${deletePeriodo.localId}`}</span>{" "}del período <span className="font-mono">{deletePeriodo.fechaDesde}</span> al <span className="font-mono">{deletePeriodo.fechaHasta}</span>. Esta acción no se puede deshacer.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Para confirmar, escribí <span className="font-mono font-semibold">{DELETE_KEYWORD}</span></Label>
            <Input value={deletePeriodoKw} onChange={(e) => setDeletePeriodoKw(e.target.value)} placeholder={DELETE_KEYWORD} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setDeletePeriodo(null); setDeletePeriodoKw(""); }}>Cancelar</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletePeriodoKw.trim().toUpperCase() !== DELETE_KEYWORD || deletePeriodoMutation.isPending}
              onClick={() => deletePeriodo && deletePeriodoMutation.mutate(deletePeriodo)}
            >
              {deletePeriodoMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteRow} onOpenChange={(o) => !o && closeDeleteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar venta</DialogTitle>
            <DialogDescription>
              {deleteRow && (
                <>Vas a eliminar la venta de <span className="font-medium">{localNameById.get(deleteRow.localId) ?? `Local ${deleteRow.localId}`}</span>{" "}del <span className="font-mono">{deleteRow.fecha}</span>. Esta acción no se puede deshacer.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Para confirmar, escribí <span className="font-mono font-semibold">{DELETE_KEYWORD}</span></Label>
            <Input value={deleteKeyword} onChange={(e) => setDeleteKeyword(e.target.value)} placeholder={DELETE_KEYWORD} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDeleteDialog}>Cancelar</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteKeyword.trim().toUpperCase() !== DELETE_KEYWORD || deleteMutation.isPending}
              onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
