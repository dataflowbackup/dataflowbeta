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
import { parseFudoReport, parseFudoAdiciones, parseFudoPagos, type ParsedFudoDay, type ParsedFudoAdicion, type ParsedFudoPago } from "@shared/fudoSalesParser";
import type { Local } from "@shared/schema";

const DELETE_KEYWORD = "BORRAR";

interface FudoVentaRow {
  id: number;
  localId: number;
  fecha: string;
  ventaTotal: string | number;
}

interface FudoProductoRow {
  id: number;
  localId: number;
  fecha: string;
  producto: string;
  categoria: string | null;
  cantidad: number;
}

export default function FudoVentasPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [localId, setLocalId] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedDays, setParsedDays] = useState<ParsedFudoDay[]>([]);
  const [parsedAdiciones, setParsedAdiciones] = useState<ParsedFudoAdicion[]>([]);
  const [parsedPagos, setParsedPagos] = useState<ParsedFudoPago[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [replaceSet, setReplaceSet] = useState<Set<string>>(new Set());

  const [filterLocalId, setFilterLocalId] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [filterProdLocalId, setFilterProdLocalId] = useState("all");
  const [filterProdFrom, setFilterProdFrom] = useState("");
  const [filterProdTo, setFilterProdTo] = useState("");

  const [deleteRow, setDeleteRow] = useState<FudoVentaRow | null>(null);
  const [deleteKeyword, setDeleteKeyword] = useState("");

  // Borrado de productos por día
  interface ProdDiaKey { localId: number; fecha: string }
  const [deleteProdDia, setDeleteProdDia] = useState<ProdDiaKey | null>(null);
  const [deleteProdDiaKw, setDeleteProdDiaKw] = useState("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: existing = [] } = useQuery<FudoVentaRow[]>({
    queryKey: ["/api/fudo-ventas"],
    queryFn: async () => {
      const res = await fetch(`/api/fudo-ventas`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar ventas");
      return res.json();
    },
  });
  const { data: productos = [] } = useQuery<FudoProductoRow[]>({
    queryKey: ["/api/fudo-productos"],
    queryFn: async () => {
      const res = await fetch(`/api/fudo-productos`, { credentials: "include" });
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

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      // Hoja 1: Ventas
      const ws0 = wb.Sheets[wb.SheetNames[0]];
      const rows0 = XLSX.utils.sheet_to_json(ws0, { header: 1, blankrows: false, defval: null }) as any[][];
      const res = parseFudoReport(rows0);
      setParsedDays(res.days);

      // Hoja 2: Adiciones (se le pasa ventasRows para cruzar Id.Venta → fecha)
      const adicionesWarnings: string[] = [];
      if (wb.SheetNames.length > 1) {
        const ws1 = wb.Sheets[wb.SheetNames[1]];
        const rows1 = XLSX.utils.sheet_to_json(ws1, { header: 1, blankrows: false, defval: null }) as any[][];
        const resAd = parseFudoAdiciones(rows1, rows0);
        setParsedAdiciones(resAd.items);
        adicionesWarnings.push(...resAd.warnings);
      } else {
        setParsedAdiciones([]);
        adicionesWarnings.push("El archivo no tiene solapa Adiciones.");
      }

      // Hoja 4: Pagos (índice 3)
      const pagosWarnings: string[] = [];
      if (wb.SheetNames.length > 3) {
        const ws3 = wb.Sheets[wb.SheetNames[3]];
        const rows3 = XLSX.utils.sheet_to_json(ws3, { header: 1, blankrows: false, defval: null }) as any[][];
        const resPagos = parseFudoPagos(rows3);
        setParsedPagos(resPagos.items);
        pagosWarnings.push(...resPagos.warnings);
      } else {
        setParsedPagos([]);
      }

      setWarnings([...res.warnings, ...adicionesWarnings, ...pagosWarnings]);
      setFileName(file.name);
      setReplaceSet(new Set());
      if (res.days.length === 0) {
        toast({ title: "No se leyeron ventas del archivo", description: res.warnings.join(" ") || undefined, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "No se pudo leer el archivo", description: e?.message, variant: "destructive" });
    }
  };

  /** Corte fiscal del archivo cargado. null = el archivo no trae la columna N. */
  const fiscalPreview = useMemo(() => {
    if (parsedDays.length === 0 || parsedDays[0].ventaFiscalizada == null) return null;
    return parsedDays.reduce(
      (acc, d) => ({
        fiscalizada: acc.fiscalizada + (d.ventaFiscalizada ?? 0),
        noFiscalizada: acc.noFiscalizada + (d.ventaNoFiscalizada ?? 0),
        sinDato: acc.sinDato + (d.ventaSinDatoFiscal ?? 0),
      }),
      { fiscalizada: 0, noFiscalizada: 0, sinDato: 0 },
    );
  }, [parsedDays]);

  const counts = useMemo(() => {
    let nuevos = 0;
    let yaImport = 0;
    let aReemplazar = 0;
    for (const d of parsedDays) {
      if (existingFechas.has(d.fecha)) {
        yaImport++;
        if (replaceSet.has(d.fecha)) aReemplazar++;
      } else nuevos++;
    }
    return { nuevos, yaImport, aReemplazar };
  }, [parsedDays, existingFechas, replaceSet]);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!localId) throw new Error("Elegí el local");
      const res = await apiRequest("POST", "/api/fudo-ventas/import", {
        localId: parseInt(localId, 10),
        sourceFile: fileName,
        days: parsedDays.map((d) => ({
          fecha: d.fecha,
          ventaTotal: d.ventaTotal,
          ticketCount: d.ticketCount,
          // Corte fiscalizado/no de la columna N. Va tal cual, null incluido: un archivo sin esa
          // columna deja el dia "sin dato" en vez de hacerlo pasar por no fiscalizado.
          ventaFiscalizada: d.ventaFiscalizada,
          ventaNoFiscalizada: d.ventaNoFiscalizada,
          ventaSinDatoFiscal: d.ventaSinDatoFiscal,
          ticketsFiscalizados: d.ticketsFiscalizados,
          ticketsNoFiscalizados: d.ticketsNoFiscalizados,
          ticketsSinDatoFiscal: d.ticketsSinDatoFiscal,
        })),
        replaceFechas: Array.from(replaceSet),
        adiciones: parsedAdiciones.map((a) => ({
          fecha: a.fecha,
          producto: a.producto,
          categoria: a.categoria,
          cantidad: a.cantidad,
        })),
        pagos: parsedPagos.map((p) => ({
          fecha: p.fecha,
          medioPago: p.medioPago,
          importe: p.importe,
        })),
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fudo-ventas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fudo-productos"] });
      const prodMsg = r.productos
        ? ` Productos: ${r.productos.insertados} nuevo(s), ${r.productos.reemplazados} reemplazado(s).`
        : "";
      toast({
        title: "Importación lista",
        description: `${r.insertados} nuevo(s), ${r.reemplazados} reemplazado(s), ${r.omitidos} omitido(s).${prodMsg}`,
      });
      setParsedDays([]);
      setParsedAdiciones([]);
      setFileName("");
      setReplaceSet(new Set());
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
    let total = 0;
    for (const e of filteredExisting) total += parseFloat(String(e.ventaTotal)) || 0;
    return { total, dias: filteredExisting.length };
  }, [filteredExisting]);

  const filteredProductos = useMemo(() => {
    return productos.filter((p) => {
      if (filterProdLocalId !== "all" && String(p.localId) !== filterProdLocalId) return false;
      const f = String(p.fecha);
      if (filterProdFrom && f < filterProdFrom) return false;
      if (filterProdTo && f > filterProdTo) return false;
      return true;
    });
  }, [productos, filterProdLocalId, filterProdFrom, filterProdTo]);

  const prodTotales = useMemo(() => {
    const byProd = new Map<string, { producto: string; categoria: string; cantidad: number }>();
    for (const p of filteredProductos) {
      const key = `${p.producto}||${p.categoria ?? ""}`;
      if (!byProd.has(key)) byProd.set(key, { producto: p.producto, categoria: p.categoria ?? "", cantidad: 0 });
      byProd.get(key)!.cantidad += p.cantidad;
    }
    return Array.from(byProd.values()).sort((a, b) => b.cantidad - a.cantidad);
  }, [filteredProductos]);

  const diasCargados = useMemo(() => {
    const seen = new Map<string, { localId: number; fecha: string; totalItems: number }>();
    for (const p of productos) {
      const key = `${p.localId}||${p.fecha}`;
      if (!seen.has(key)) seen.set(key, { localId: p.localId, fecha: p.fecha, totalItems: 0 });
      seen.get(key)!.totalItems++;
    }
    return Array.from(seen.values()).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.localId - b.localId);
  }, [productos]);

  const deleteProdDiaMutation = useMutation({
    mutationFn: async ({ localId, fecha }: { localId: number; fecha: string }) => {
      const res = await apiRequest("DELETE", "/api/fudo-productos/fecha", { localId, fecha });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fudo-productos"] });
      toast({ title: `${r.eliminados ?? 0} producto(s) eliminados` });
      setDeleteProdDia(null);
      setDeleteProdDiaKw("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/fudo-ventas/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fudo-ventas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fudo-productos"] });
      toast({ title: "Venta eliminada (y sus productos del día)" });
      setDeleteRow(null);
      setDeleteKeyword("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const closeDeleteDialog = () => { setDeleteRow(null); setDeleteKeyword(""); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas FUDO"
        description="Importá el reporte diario de FUDO por local (venta bruta: tickets cerrados agrupados por día)"
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
                    onValueChange={(v) => { setLocalId(v); setParsedDays([]); setParsedAdiciones([]); setFileName(""); setReplaceSet(new Set()); }}
                    placeholder="Elegí el local (manual)"
                    searchPlaceholder="Buscar local…"
                    triggerClassName="w-64"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reporte FUDO (.xlsx)</Label>
                  <div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".xls,.xlsx"
                      className="hidden"
                      onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
                    />
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
                  {/* Corte fiscal del archivo (col N): confirma antes de importar que el dato vino. */}
                  {fiscalPreview != null && (
                    <div className="rounded-md border px-3 py-2 text-sm flex flex-wrap gap-x-5 gap-y-1">
                      <span className="text-muted-foreground">Fiscalizado:</span>
                      <span className="font-mono font-medium">{formatCurrency(fiscalPreview.fiscalizada)}</span>
                      <span className="text-muted-foreground">No fiscalizado:</span>
                      <span className="font-mono font-medium">{formatCurrency(fiscalPreview.noFiscalizada)}</span>
                      {fiscalPreview.sinDato > 0 && (
                        <>
                          <span className="text-muted-foreground">Sin dato:</span>
                          <span className="font-mono font-medium text-amber-700 dark:text-amber-500">
                            {formatCurrency(fiscalPreview.sinDato)}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-3 py-2 font-medium border-b">Día</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Total</th>
                          <th className="text-right px-3 py-2 font-medium border-b">Tickets</th>
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
                              <td className="px-3 py-2 text-right text-muted-foreground">{d.ticketCount}</td>
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
                  {parsedAdiciones.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Solapa Adiciones: {parsedAdiciones.length} ítem(s) de productos detectados — se importan junto con las ventas.
                    </p>
                  )}
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
              <CardHeader className="pb-3"><CardTitle className="text-base">Ventas FUDO cargadas</CardTitle></CardHeader>
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

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-card p-3">
                    <p className="text-xs text-muted-foreground">Venta Total</p>
                    <p className="text-lg font-semibold font-mono">{formatCurrency(totals.total)}</p>
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
                        <th className="px-3 py-2 font-medium border-b w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExisting.length === 0 ? (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No hay ventas para el filtro seleccionado.</td></tr>
                      ) : (
                        filteredExisting.map((e) => (
                          <tr key={e.id} className="border-b">
                            <td className="px-3 py-2">{localNameById.get(e.localId) ?? `Local ${e.localId}`}</td>
                            <td className="px-3 py-2 font-mono">{e.fecha}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaTotal)) || 0)}</td>
                            <td className="px-3 py-2 text-center">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setDeleteRow(e); setDeleteKeyword(""); }}>
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
          {diasCargados.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Días cargados</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium border-b">Local</th>
                        <th className="text-left px-3 py-2 font-medium border-b">Fecha</th>
                        <th className="text-right px-3 py-2 font-medium border-b">Productos</th>
                        <th className="px-3 py-2 border-b"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {diasCargados.map((d) => (
                        <tr key={`${d.localId}||${d.fecha}`} className="border-b">
                          <td className="px-3 py-2">{localNameById.get(d.localId) ?? `Local ${d.localId}`}</td>
                          <td className="px-3 py-2 font-mono">{d.fecha}</td>
                          <td className="px-3 py-2 text-right font-mono">{d.totalItems}</td>
                          <td className="px-3 py-2 text-center">
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => { setDeleteProdDia({ localId: d.localId, fecha: d.fecha }); setDeleteProdDiaKw(""); }}
                            >
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

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Productos vendidos FUDO</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Los productos se importan automáticamente desde la solapa <span className="font-medium">Adiciones</span> al subir el reporte de ventas FUDO.
              </p>

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
                  <Label className="text-xs">Fecha</Label>
                  <DateRangePicker from={filterProdFrom} to={filterProdTo} onChange={(f, t) => { setFilterProdFrom(f); setFilterProdTo(t); }} placeholder="Todas las fechas" />
                </div>
                {(filterProdLocalId !== "all" || filterProdFrom || filterProdTo) && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setFilterProdLocalId("all"); setFilterProdFrom(""); setFilterProdTo(""); }}>
                    Limpiar filtros
                  </Button>
                )}
              </div>

              {productos.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Aún no hay productos cargados. Importá un reporte FUDO con solapa Adiciones.
                </p>
              ) : (
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
                      {prodTotales.length === 0 ? (
                        <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No hay productos para el filtro seleccionado.</td></tr>
                      ) : (
                        prodTotales.map((p, i) => (
                          <tr key={i} className="border-b">
                            <td className="px-3 py-2">{p.producto}</td>
                            <td className="px-3 py-2 text-muted-foreground">{p.categoria || "—"}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">{p.cantidad.toLocaleString("es-AR")}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!deleteProdDia} onOpenChange={(o) => { if (!o) { setDeleteProdDia(null); setDeleteProdDiaKw(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar productos del día</DialogTitle>
            <DialogDescription>
              {deleteProdDia && (
                <>Vas a eliminar todos los productos cargados de <span className="font-medium">{localNameById.get(deleteProdDia.localId) ?? `Local ${deleteProdDia.localId}`}</span>{" "}del <span className="font-mono">{deleteProdDia.fecha}</span>. Esta acción no se puede deshacer.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Para confirmar, escribí <span className="font-mono font-semibold">{DELETE_KEYWORD}</span></Label>
            <Input value={deleteProdDiaKw} onChange={(e) => setDeleteProdDiaKw(e.target.value)} placeholder={DELETE_KEYWORD} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setDeleteProdDia(null); setDeleteProdDiaKw(""); }}>Cancelar</Button>
            <Button
              type="button" variant="destructive"
              disabled={deleteProdDiaKw.trim().toUpperCase() !== DELETE_KEYWORD || deleteProdDiaMutation.isPending}
              onClick={() => deleteProdDia && deleteProdDiaMutation.mutate(deleteProdDia)}
            >
              {deleteProdDiaMutation.isPending ? "Eliminando..." : "Eliminar"}
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
