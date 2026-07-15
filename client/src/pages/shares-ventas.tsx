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
import { parseSharesReport, parseSharesProductsReport, type ParsedSharesDay, type ParsedSharesProducto } from "@shared/sharesSalesParser";
import type { Local } from "@shared/schema";

const DELETE_KEYWORD = "BORRAR";

interface SharesVentaRow {
  id: number;
  localId: number;
  fecha: string;
  ventaTotal: string | number;
  ventaEfectivo: string | number;
  ventaTarjeta: string | number;
  ventaEfectivoOnline: string | number;
  ventaOperOnline: string | number;
  ventaMercadopago: string | number;
}

interface SharesProductoRow {
  id: number;
  localId: number;
  fecha: string;
  producto: string;
  categoria: string | null;
  cantidad: number;
}

export default function SharesVentasPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const prodFileRef = useRef<HTMLInputElement>(null);

  // ── estado Tab Ventas ──
  const [localId, setLocalId] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedDays, setParsedDays] = useState<ParsedSharesDay[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [replaceSet, setReplaceSet] = useState<Set<string>>(new Set());
  const [filterLocalId, setFilterLocalId] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [deleteRow, setDeleteRow] = useState<SharesVentaRow | null>(null);
  const [deleteKeyword, setDeleteKeyword] = useState("");

  // ── estado Tab Productos ──
  const [prodLocalId, setProdLocalId] = useState("");
  const [prodFileName, setProdFileName] = useState("");
  const [parsedProductos, setParsedProductos] = useState<ParsedSharesProducto[]>([]);
  const [prodWarnings, setProdWarnings] = useState<string[]>([]);
  const [prodReplace, setProdReplace] = useState(false);
  const [filterProdLocalId, setFilterProdLocalId] = useState("all");
  const [filterProdFrom, setFilterProdFrom] = useState("");
  const [filterProdTo, setFilterProdTo] = useState("");
  const [deleteProdFecha, setDeleteProdFecha] = useState<{ localId: number; fecha: string } | null>(null);
  const [deleteProdKw, setDeleteProdKw] = useState("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: existing = [] } = useQuery<SharesVentaRow[]>({
    queryKey: ["/api/shares-ventas"],
    queryFn: async () => {
      const res = await fetch(`/api/shares-ventas`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar ventas");
      return res.json();
    },
  });
  const { data: productos = [] } = useQuery<SharesProductoRow[]>({
    queryKey: ["/api/shares-productos"],
    queryFn: async () => {
      const res = await fetch(`/api/shares-productos`, { credentials: "include" });
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
  const existingProdFechas = useMemo(
    () => new Set(productos.filter((p) => String(p.localId) === prodLocalId).map((p) => String(p.fecha))),
    [productos, prodLocalId],
  );

  // ── handlers Ventas ──
  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as any[][];
      const res = parseSharesReport(rows);
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
      const res = parseSharesProductsReport(rows);
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

  // Fechas de productos parseados que ya existen para el local (para reemplazo).
  const prodFechasExistentes = useMemo(() => {
    const set = new Set<string>();
    for (const p of parsedProductos) if (existingProdFechas.has(p.fecha)) set.add(p.fecha);
    return set;
  }, [parsedProductos, existingProdFechas]);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!localId) throw new Error("Elegí el local");
      const res = await apiRequest("POST", "/api/shares-ventas/import", {
        localId: parseInt(localId, 10),
        sourceFile: fileName,
        days: parsedDays,
        replaceFechas: Array.from(replaceSet),
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shares-ventas"] });
      toast({ title: "Importación lista", description: `${r.insertados} nuevo(s), ${r.reemplazados} reemplazado(s), ${r.omitidos} omitido(s).` });
      setParsedDays([]); setFileName(""); setReplaceSet(new Set());
    },
    onError: (e: Error) => toast({ title: "No se pudo importar", description: e.message, variant: "destructive" }),
  });

  const importProdMutation = useMutation({
    mutationFn: async () => {
      if (!prodLocalId) throw new Error("Elegí el local");
      const res = await apiRequest("POST", "/api/shares-productos/import", {
        localId: parseInt(prodLocalId, 10),
        sourceFile: prodFileName,
        items: parsedProductos,
        replaceFechas: prodReplace ? Array.from(prodFechasExistentes) : [],
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shares-productos"] });
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
    let total = 0, efectivo = 0, tarjeta = 0, efectivoOnline = 0, operOnline = 0, mercadopago = 0;
    for (const e of filteredExisting) {
      total += parseFloat(String(e.ventaTotal)) || 0;
      efectivo += parseFloat(String(e.ventaEfectivo)) || 0;
      tarjeta += parseFloat(String(e.ventaTarjeta)) || 0;
      efectivoOnline += parseFloat(String(e.ventaEfectivoOnline)) || 0;
      operOnline += parseFloat(String(e.ventaOperOnline)) || 0;
      mercadopago += parseFloat(String(e.ventaMercadopago)) || 0;
    }
    return { total, efectivo, tarjeta, efectivoOnline, operOnline, mercadopago, dias: filteredExisting.length };
  }, [filteredExisting]);

  const filteredProductos = useMemo(() => {
    return productos.filter((p) => {
      if (filterProdLocalId !== "all" && String(p.localId) !== filterProdLocalId) return false;
      if (filterProdFrom && String(p.fecha) < filterProdFrom) return false;
      if (filterProdTo && String(p.fecha) > filterProdTo) return false;
      return true;
    });
  }, [productos, filterProdLocalId, filterProdFrom, filterProdTo]);

  const prodAgrupados = useMemo(() => {
    const byProd = new Map<string, { producto: string; categoria: string; cantidad: number }>();
    for (const p of filteredProductos) {
      if (!byProd.has(p.producto)) byProd.set(p.producto, { producto: p.producto, categoria: p.categoria || "", cantidad: 0 });
      byProd.get(p.producto)!.cantidad += p.cantidad;
    }
    return Array.from(byProd.values()).sort((a, b) => b.cantidad - a.cantidad);
  }, [filteredProductos]);

  // Días distintos cargados en productos (para borrar por fecha).
  const diasProdDistintos = useMemo(() => {
    const map = new Map<string, { localId: number; fecha: string; count: number }>();
    for (const p of productos) {
      const key = `${p.localId}||${p.fecha}`;
      if (!map.has(key)) map.set(key, { localId: p.localId, fecha: String(p.fecha), count: 0 });
      map.get(key)!.count++;
    }
    return Array.from(map.values()).sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [productos]);

  const deleteProdFechaMutation = useMutation({
    mutationFn: async (p: { localId: number; fecha: string }) => {
      const res = await apiRequest("DELETE", "/api/shares-productos/fecha", p);
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shares-productos"] });
      toast({ title: "Día eliminado", description: `${r.eliminados} producto(s) eliminados.` });
      setDeleteProdFecha(null);
      setDeleteProdKw("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/shares-ventas/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shares-ventas"] });
      toast({ title: "Venta eliminada" });
      setDeleteRow(null); setDeleteKeyword("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const closeDeleteDialog = () => { setDeleteRow(null); setDeleteKeyword(""); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas Shares"
        description="Importá el reporte de Shares por local. El día viene partido en 2 cajas: se suman automáticamente."
      />

      <Tabs defaultValue="ventas">
        <TabsList>
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="productos">Productos vendidos</TabsTrigger>
        </TabsList>

        {/* ── TAB VENTAS ── */}
        <TabsContent value="ventas" className="space-y-6 mt-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Importar reporte de ventas</CardTitle></CardHeader>
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
                  <Label className="text-xs">Reporte de ventas Shares (.xls/.xlsx)</Label>
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
                          <th className="text-right px-3 py-2 font-medium border-b">Tarjeta</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Efvo. Online</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Oper. Online</th>
                          <th className="text-right px-3 py-2 font-medium border-b">MercadoPago</th>
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
                              <td className="px-3 py-2 text-right font-mono">{formatCurrency(d.ventaTarjeta)}</td>
                              <td className="px-3 py-2 text-right font-mono">{formatCurrency(d.ventaEfectivoOnline)}</td>
                              <td className="px-3 py-2 text-right font-mono">{formatCurrency(d.ventaOperOnline)}</td>
                              <td className="px-3 py-2 text-right font-mono">{formatCurrency(d.ventaMercadopago)}</td>
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
              <CardHeader className="pb-3"><CardTitle className="text-base">Ventas Shares cargadas</CardTitle></CardHeader>
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

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Venta Total</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.total)}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Efectivo</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.efectivo)}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Tarjeta</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.tarjeta)}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Efvo. Online</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.efectivoOnline)}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Oper. Online</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.operOnline)}</p>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">MercadoPago</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.mercadopago)}</p>
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
                        <th className="text-right px-3 py-2 font-medium border-b">Tarjeta</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Efvo. Online</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Oper. Online</th>
                        <th className="text-right px-3 py-2 font-medium border-b">MercadoPago</th>
                        <th className="px-3 py-2 font-medium border-b w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExisting.length === 0 ? (
                        <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No hay ventas para el filtro seleccionado.</td></tr>
                      ) : (
                        filteredExisting.map((e) => (
                          <tr key={e.id} className="border-b">
                            <td className="px-3 py-2">{localNameById.get(e.localId) ?? `Local ${e.localId}`}</td>
                            <td className="px-3 py-2 font-mono">{e.fecha}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaTotal)) || 0)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaEfectivo)) || 0)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaTarjeta)) || 0)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaEfectivoOnline)) || 0)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaOperOnline)) || 0)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaMercadopago)) || 0)}</td>
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
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Importar productos Shares</CardTitle></CardHeader>
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
                  <Label className="text-xs">Reporte de productos (.xls/.xlsx)</Label>
                  <div>
                    <input ref={prodFileRef} type="file" accept=".xls,.xlsx" className="hidden"
                      onChange={(e) => { if (e.target.files?.[0]) handleProdFile(e.target.files[0]); e.target.value = ""; }} />
                    <Button type="button" variant="outline" disabled={!prodLocalId} onClick={() => prodFileRef.current?.click()}>
                      <Upload className="h-4 w-4 mr-2" /> {prodFileName || "Subir archivo"}
                    </Button>
                  </div>
                </div>
              </div>
              {!prodLocalId && <p className="text-xs text-muted-foreground">Primero elegí el local antes de subir el archivo. Las fechas vienen en el archivo.</p>}

              {prodWarnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {prodWarnings.map((w, i) => <div key={i}>• {w}</div>)}
                </div>
              )}

              {parsedProductos.length > 0 && (
                <>
                  {prodFechasExistentes.size > 0 && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-3">
                      <span>Ya hay productos cargados para {prodFechasExistentes.size} día(s) de este archivo.</span>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox checked={prodReplace} onCheckedChange={(c) => setProdReplace(!!c)} />
                        <span>Reemplazar esos días</span>
                      </label>
                    </div>
                  )}

                  <div className="rounded-md border overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted/80">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium border-b">Día</th>
                          <th className="text-left px-3 py-2 font-medium border-b">Producto</th>
                          <th className="text-left px-3 py-2 font-medium border-b">Categoría</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Cantidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedProductos.map((p, i) => (
                          <tr key={i} className="border-b">
                            <td className="px-3 py-2 font-mono">{p.fecha}</td>
                            <td className="px-3 py-2">{p.producto}</td>
                            <td className="px-3 py-2 text-muted-foreground">{p.categoria}</td>
                            <td className="px-3 py-2 text-right font-mono">{p.cantidad.toLocaleString("es-AR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {parsedProductos.length} fila(s) detectadas
                      {prodFechasExistentes.size > 0 && !prodReplace && " · los días ya cargados se omiten"}
                      {prodFechasExistentes.size > 0 && prodReplace && " · se reemplazan los días ya cargados"}
                    </div>
                    <Button onClick={() => importProdMutation.mutate()} disabled={importProdMutation.isPending}>
                      <Save className="h-4 w-4 mr-2" /> {importProdMutation.isPending ? "Importando..." : "Confirmar importación"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Días cargados con botón de borrar */}
          {diasProdDistintos.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Días cargados</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium border-b">Local</th>
                        <th className="text-left px-3 py-2 font-medium border-b">Día</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Productos</th>
                        <th className="px-3 py-2 border-b w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {diasProdDistintos.map((p, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-3 py-2">{localNameById.get(p.localId) ?? `Local ${p.localId}`}</td>
                          <td className="px-3 py-2 font-mono">{p.fecha}</td>
                          <td className="px-3 py-2 text-right font-mono">{p.count}</td>
                          <td className="px-3 py-2 text-center">
                            <Button variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => { setDeleteProdFecha(p); setDeleteProdKw(""); }}>
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
              <CardHeader className="pb-3"><CardTitle className="text-base">Productos Shares cargados</CardTitle></CardHeader>
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
                        <th className="text-left px-3 py-2 font-medium border-b">Categoría</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Cantidad total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prodAgrupados.length === 0 ? (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No hay productos para el filtro seleccionado.</td></tr>
                      ) : (
                        prodAgrupados.map((p, i) => (
                          <tr key={i} className="border-b">
                            <td className="px-3 py-2">{p.producto}</td>
                            <td className="px-3 py-2 text-muted-foreground">{p.categoria}</td>
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

      {/* Dialog borrar día de productos */}
      <Dialog open={!!deleteProdFecha} onOpenChange={(o) => { if (!o) { setDeleteProdFecha(null); setDeleteProdKw(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar productos del día</DialogTitle>
            <DialogDescription>
              {deleteProdFecha && (
                <>Vas a eliminar todos los productos de <span className="font-medium">{localNameById.get(deleteProdFecha.localId) ?? `Local ${deleteProdFecha.localId}`}</span>{" "}del día <span className="font-mono">{deleteProdFecha.fecha}</span>. Esta acción no se puede deshacer.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Para confirmar, escribí <span className="font-mono font-semibold">{DELETE_KEYWORD}</span></Label>
            <Input value={deleteProdKw} onChange={(e) => setDeleteProdKw(e.target.value)} placeholder={DELETE_KEYWORD} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setDeleteProdFecha(null); setDeleteProdKw(""); }}>Cancelar</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteProdKw.trim().toUpperCase() !== DELETE_KEYWORD || deleteProdFechaMutation.isPending}
              onClick={() => deleteProdFecha && deleteProdFechaMutation.mutate(deleteProdFecha)}
            >
              {deleteProdFechaMutation.isPending ? "Eliminando..." : "Eliminar"}
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
