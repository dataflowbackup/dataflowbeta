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
import { parseDecomisosReport, type ParsedDecomiso } from "@shared/decomisosParser";
import type { Local } from "@shared/schema";

const DELETE_KEYWORD = "BORRAR";
const SIN_ASIGNAR = "none";

interface DecomisoRow {
  id: number;
  localId: number;
  supplyId: number | null;
  fecha: string;
  codDecomiso: string | null;
  codProducto: string | null;
  descripcionOriginal: string;
  sucursalOriginal: string | null;
  tipoDecomiso: string | null;
  cantidad: string | number;
  unitCost: string | number;
  valorizado: string | number;
}

interface SupplyLite {
  id: number;
  name: string;
  unitCost?: string | number | null;
  lastCost?: string | number | null;
}

interface MappingsResponse {
  locales: Array<{ sucursalOriginal: string; localId: number }>;
  productos: Array<{ codProducto: string; supplyId: number }>;
}

export default function DecomisosPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // ── estado importación ──
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedDecomiso[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  // mapeos que el usuario resuelve: sucursal→local y codProducto→insumo
  const [localMap, setLocalMap] = useState<Record<string, string>>({});
  const [prodMap, setProdMap] = useState<Record<string, string>>({});

  // ── estado filtros del listado ──
  const [filterLocalId, setFilterLocalId] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterTipo, setFilterTipo] = useState("all");

  // ── borrado ──
  const [deleteRow, setDeleteRow] = useState<DecomisoRow | null>(null);
  const [deleteKeyword, setDeleteKeyword] = useState("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: supplies = [] } = useQuery<SupplyLite[]>({ queryKey: ["/api/supplies"] });
  const { data: mappings } = useQuery<MappingsResponse>({
    queryKey: ["/api/decomisos/mappings"],
    queryFn: async () => {
      const res = await fetch(`/api/decomisos/mappings`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar mapeos");
      return res.json();
    },
  });
  const { data: existing = [] } = useQuery<DecomisoRow[]>({
    queryKey: ["/api/decomisos"],
    queryFn: async () => {
      const res = await fetch(`/api/decomisos`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar decomisos");
      return res.json();
    },
  });

  const localOptions = useMemo(() => locals.map((l) => ({ value: String(l.id), label: l.name })), [locals]);
  const localNameById = useMemo(() => new Map(locals.map((l) => [l.id, l.name])), [locals]);
  const supplyOptions = useMemo(
    () => [{ value: SIN_ASIGNAR, label: "— Sin asignar —" }, ...supplies.map((s) => ({ value: String(s.id), label: s.name }))],
    [supplies],
  );
  const supplyNameById = useMemo(() => new Map(supplies.map((s) => [s.id, s.name])), [supplies]);
  // costo de cada insumo (unitCost, fallback lastCost) para previsualizar el valorizado
  const costBySupply = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of supplies) {
      const uc = parseFloat(String(s.unitCost ?? 0)) || 0;
      const lc = parseFloat(String(s.lastCost ?? 0)) || 0;
      m.set(s.id, uc > 0 ? uc : lc);
    }
    return m;
  }, [supplies]);

  // sucursales distintas del archivo parseado
  const sucursales = useMemo(() => {
    const set = new Set<string>();
    for (const p of parsed) if (p.sucursal) set.add(p.sucursal);
    return Array.from(set).sort();
  }, [parsed]);

  // productos distintos (por codProducto) del archivo parseado
  const productos = useMemo(() => {
    const map = new Map<string, { codProducto: string; descripcion: string; cantidad: number }>();
    for (const p of parsed) {
      const key = p.codProducto || `__${p.descripcion}`;
      if (!map.has(key)) map.set(key, { codProducto: p.codProducto, descripcion: p.descripcion, cantidad: 0 });
      map.get(key)!.cantidad += p.cantidad;
    }
    return Array.from(map.values()).sort((a, b) => a.descripcion.localeCompare(b.descripcion));
  }, [parsed]);

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" }) as any[][];
      const res = parseDecomisosReport(rows);
      setParsed(res.items);
      setWarnings(res.warnings);
      setFileName(file.name);

      // pre-cargar mapeos guardados
      const lMap: Record<string, string> = {};
      const savedLocal = new Map((mappings?.locales ?? []).map((m) => [m.sucursalOriginal, m.localId]));
      for (const p of res.items) {
        if (p.sucursal && !lMap[p.sucursal]) {
          const saved = savedLocal.get(p.sucursal);
          lMap[p.sucursal] = saved != null ? String(saved) : "";
        }
      }
      const pMap: Record<string, string> = {};
      const savedProd = new Map((mappings?.productos ?? []).map((m) => [m.codProducto, m.supplyId]));
      for (const p of res.items) {
        const key = p.codProducto || `__${p.descripcion}`;
        if (!pMap[key]) {
          const saved = p.codProducto ? savedProd.get(p.codProducto) : undefined;
          pMap[key] = saved != null ? String(saved) : SIN_ASIGNAR;
        }
      }
      setLocalMap(lMap);
      setProdMap(pMap);

      if (res.items.length === 0) {
        toast({ title: "No se leyeron decomisos del archivo", description: res.warnings.join(" ") || undefined, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "No se pudo leer el archivo", description: e?.message, variant: "destructive" });
    }
  };

  // ¿faltan sucursales por mapear? (el local es obligatorio; el insumo es opcional)
  const sucursalesSinMapear = useMemo(
    () => sucursales.filter((s) => !localMap[s]),
    [sucursales, localMap],
  );

  // items listos para enviar (resuelven localId y supplyId desde los mapeos)
  const itemsToImport = useMemo(() => {
    return parsed.map((p) => {
      const localIdStr = p.sucursal ? localMap[p.sucursal] : "";
      const key = p.codProducto || `__${p.descripcion}`;
      const supplyStr = prodMap[key];
      const supplyId = supplyStr && supplyStr !== SIN_ASIGNAR ? parseInt(supplyStr, 10) : null;
      return {
        codDecomiso: p.codDecomiso,
        codProducto: p.codProducto,
        fecha: p.fecha,
        descripcion: p.descripcion,
        sucursal: p.sucursal,
        tipoDecomiso: p.tipoDecomiso,
        cantidad: p.cantidad,
        localId: localIdStr ? parseInt(localIdStr, 10) : 0,
        supplyId,
      };
    });
  }, [parsed, localMap, prodMap]);

  // total valorizado previsto de la importación
  const previewValorizado = useMemo(() => {
    let total = 0;
    for (const it of itemsToImport) {
      const cost = it.supplyId != null ? (costBySupply.get(it.supplyId) ?? 0) : 0;
      total += cost * it.cantidad;
    }
    return total;
  }, [itemsToImport, costBySupply]);

  const importMutation = useMutation({
    mutationFn: async () => {
      if (sucursalesSinMapear.length > 0) throw new Error("Asigná un local a todas las sucursales antes de importar.");
      const res = await apiRequest("POST", "/api/decomisos/import", {
        sourceFile: fileName,
        items: itemsToImport,
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/decomisos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decomisos/mappings"] });
      toast({ title: "Importación lista", description: `${r.insertados} nuevo(s), ${r.omitidos} ya cargado(s) omitido(s).` });
      setParsed([]); setFileName(""); setWarnings([]); setLocalMap({}); setProdMap({});
    },
    onError: (e: Error) => toast({ title: "No se pudo importar", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/decomisos/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decomisos"] });
      toast({ title: "Decomiso eliminado" });
      setDeleteRow(null); setDeleteKeyword("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const closeDeleteDialog = () => { setDeleteRow(null); setDeleteKeyword(""); };

  // tipos distintos para el filtro
  const tipos = useMemo(() => {
    const set = new Set<string>();
    for (const e of existing) if (e.tipoDecomiso) set.add(e.tipoDecomiso);
    return Array.from(set).sort();
  }, [existing]);

  const filtered = useMemo(() => {
    return existing.filter((e) => {
      if (filterLocalId !== "all" && String(e.localId) !== filterLocalId) return false;
      if (filterTipo !== "all" && (e.tipoDecomiso ?? "") !== filterTipo) return false;
      const f = String(e.fecha);
      if (filterFrom && f < filterFrom) return false;
      if (filterTo && f > filterTo) return false;
      return true;
    });
  }, [existing, filterLocalId, filterTipo, filterFrom, filterTo]);

  const totals = useMemo(() => {
    let cantidad = 0; let valorizado = 0;
    for (const e of filtered) {
      cantidad += parseFloat(String(e.cantidad)) || 0;
      valorizado += parseFloat(String(e.valorizado)) || 0;
    }
    return { cantidad, valorizado, lineas: filtered.length };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decomisos"
        description="Importá el reporte de decomisos de Datalive, asigná cada producto a un insumo y cada sucursal a un local para valorizar la mercadería decomisada"
      />
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Importar reporte de decomisos</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Reporte de decomisos (.xls)</Label>
            <div>
              <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }} />
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> {fileName || "Subir archivo"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">El archivo trae la sucursal y el producto; los asignás abajo a tus locales e insumos.</p>
          </div>

          {warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {warnings.map((w, i) => <div key={i}>• {w}</div>)}
            </div>
          )}

          {parsed.length > 0 && (
            <>
              {/* Mapeo sucursales → locales */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium">Sucursales → Locales</Label>
                  {sucursalesSinMapear.length > 0 && <Badge variant="destructive">{sucursalesSinMapear.length} sin asignar</Badge>}
                </div>
                <div className="rounded-md border divide-y">
                  {sucursales.map((s) => (
                    <div key={s} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-sm">{s}</span>
                      <DataEntryCombobox
                        options={localOptions}
                        value={localMap[s] ?? ""}
                        onValueChange={(v) => setLocalMap((prev) => ({ ...prev, [s]: v }))}
                        placeholder="Elegí el local"
                        searchPlaceholder="Buscar local…"
                        triggerClassName="w-64"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Mapeo productos → insumos */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Productos → Insumos <span className="text-xs text-muted-foreground font-normal">(opcional: sin insumo, el valorizado queda en $0)</span></Label>
                <div className="rounded-md border divide-y max-h-80 overflow-y-auto">
                  {productos.map((p) => {
                    const key = p.codProducto || `__${p.descripcion}`;
                    return (
                      <div key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm truncate">{p.descripcion}</p>
                          <p className="text-xs text-muted-foreground">Cód. {p.codProducto || "—"} · {p.cantidad.toLocaleString("es-AR")} u.</p>
                        </div>
                        <DataEntryCombobox
                          options={supplyOptions}
                          value={prodMap[key] ?? SIN_ASIGNAR}
                          onValueChange={(v) => setProdMap((prev) => ({ ...prev, [key]: v }))}
                          placeholder="Elegí el insumo"
                          searchPlaceholder="Buscar insumo…"
                          triggerClassName="w-64"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {parsed.length} decomiso(s) · valorizado previsto <span className="font-mono font-medium">{formatCurrency(previewValorizado)}</span>
                </div>
                <Button
                  onClick={() => importMutation.mutate()}
                  disabled={importMutation.isPending || sucursalesSinMapear.length > 0}
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
          <CardHeader className="pb-3"><CardTitle className="text-base">Decomisos cargados</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
              <div className="space-y-1">
                <Label className="text-xs">Local</Label>
                <DataEntryCombobox
                  options={[{ value: "all", label: "Todos los locales" }, ...localOptions]}
                  value={filterLocalId}
                  onValueChange={setFilterLocalId}
                  placeholder="Todos los locales"
                  searchPlaceholder="Buscar local…"
                  triggerClassName="w-56"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <DataEntryCombobox
                  options={[{ value: "all", label: "Todos los tipos" }, ...tipos.map((t) => ({ value: t, label: t }))]}
                  value={filterTipo}
                  onValueChange={setFilterTipo}
                  placeholder="Todos los tipos"
                  searchPlaceholder="Buscar tipo…"
                  triggerClassName="w-52"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fecha</Label>
                <DateRangePicker from={filterFrom} to={filterTo} onChange={(f, t) => { setFilterFrom(f); setFilterTo(t); }} placeholder="Todas las fechas" />
              </div>
              {(filterLocalId !== "all" || filterTipo !== "all" || filterFrom || filterTo) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setFilterLocalId("all"); setFilterTipo("all"); setFilterFrom(""); setFilterTo(""); }}>
                  Limpiar filtros
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Valorizado total</p>
                <p className="text-lg font-semibold font-mono">{formatCurrency(totals.valorizado)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Cantidad</p>
                <p className="text-lg font-semibold font-mono">{totals.cantidad.toLocaleString("es-AR")}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Líneas</p>
                <p className="text-lg font-semibold font-mono">{totals.lineas}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium border-b">Fecha</th>
                    <th className="text-left px-3 py-2 font-medium border-b">Local</th>
                    <th className="text-left px-3 py-2 font-medium border-b">Producto</th>
                    <th className="text-left px-3 py-2 font-medium border-b">Insumo</th>
                    <th className="text-left px-3 py-2 font-medium border-b">Tipo</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Cant.</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Valorizado</th>
                    <th className="px-3 py-2 font-medium border-b w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No hay decomisos para el filtro seleccionado.</td></tr>
                  ) : (
                    filtered.map((e) => (
                      <tr key={e.id} className="border-b">
                        <td className="px-3 py-2 font-mono">{e.fecha}</td>
                        <td className="px-3 py-2">{localNameById.get(e.localId) ?? `Local ${e.localId}`}</td>
                        <td className="px-3 py-2">{e.descripcionOriginal}</td>
                        <td className="px-3 py-2">{e.supplyId != null ? (supplyNameById.get(e.supplyId) ?? `Insumo ${e.supplyId}`) : <span className="text-muted-foreground">— sin asignar —</span>}</td>
                        <td className="px-3 py-2">{e.tipoDecomiso}</td>
                        <td className="px-3 py-2 text-right font-mono">{(parseFloat(String(e.cantidad)) || 0).toLocaleString("es-AR")}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.valorizado)) || 0)}</td>
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

      <Dialog open={!!deleteRow} onOpenChange={(o) => !o && closeDeleteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar decomiso</DialogTitle>
            <DialogDescription>
              {deleteRow && (
                <>Vas a eliminar el decomiso de <span className="font-medium">{deleteRow.descripcionOriginal}</span>{" "}del <span className="font-mono">{deleteRow.fecha}</span> en <span className="font-medium">{localNameById.get(deleteRow.localId) ?? `Local ${deleteRow.localId}`}</span>. Esta acción no se puede deshacer.</>
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

