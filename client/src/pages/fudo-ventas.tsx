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
import { parseFudoReport, type ParsedFudoDay } from "@shared/fudoSalesParser";
import type { Local } from "@shared/schema";

const DELETE_KEYWORD = "BORRAR";

interface FudoVentaRow {
  id: number;
  localId: number;
  fecha: string;
  ventaTotal: string | number;
}

export default function FudoVentasPage() {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [localId, setLocalId] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedDays, setParsedDays] = useState<ParsedFudoDay[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [replaceSet, setReplaceSet] = useState<Set<string>>(new Set());

  const [filterLocalId, setFilterLocalId] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [deleteRow, setDeleteRow] = useState<FudoVentaRow | null>(null);
  const [deleteKeyword, setDeleteKeyword] = useState("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: existing = [] } = useQuery<FudoVentaRow[]>({
    queryKey: ["/api/fudo-ventas"],
    queryFn: async () => {
      const res = await fetch(`/api/fudo-ventas`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar ventas");
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
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null }) as any[][];
      const res = parseFudoReport(rows);
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
        days: parsedDays.map((d) => ({ fecha: d.fecha, ventaTotal: d.ventaTotal })),
        replaceFechas: Array.from(replaceSet),
      });
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fudo-ventas"] });
      toast({
        title: "Importación lista",
        description: `${r.insertados} nuevo(s), ${r.reemplazados} reemplazado(s), ${r.omitidos} omitido(s).`,
      });
      setParsedDays([]);
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
    for (const e of filteredExisting) {
      total += parseFloat(String(e.ventaTotal)) || 0;
    }
    return { total, dias: filteredExisting.length };
  }, [filteredExisting]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/fudo-ventas/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fudo-ventas"] });
      toast({ title: "Venta eliminada" });
      setDeleteRow(null);
      setDeleteKeyword("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const closeDeleteDialog = () => {
    setDeleteRow(null);
    setDeleteKeyword("");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas FUDO"
        description="Importá el reporte diario de FUDO por local (venta bruta: tickets cerrados agrupados por día)"
      />

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
                data-testid="select-local"
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
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFile(e.target.files[0]);
                    e.target.value = "";
                  }}
                  data-testid="input-file"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!localId}
                  onClick={() => fileRef.current?.click()}
                  data-testid="button-upload"
                >
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
                                    setReplaceSet((prev) => {
                                      const next = new Set(prev);
                                      c ? next.add(d.fecha) : next.delete(d.fecha);
                                      return next;
                                    })
                                  }
                                  data-testid={`replace-${d.fecha}`}
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
                  data-testid="button-confirm-import"
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
                  data-testid="filter-local"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fecha</Label>
                <div>
                  <DateRangePicker
                    from={filterFrom}
                    to={filterTo}
                    onChange={(f, t) => { setFilterFrom(f); setFilterTo(t); }}
                    placeholder="Todas las fechas"
                  />
                </div>
              </div>
              {(filterLocalId !== "all" || filterFrom || filterTo) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setFilterLocalId("all"); setFilterFrom(""); setFilterTo(""); }}
                  data-testid="filter-clear"
                >
                  Limpiar filtros
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Venta Total</p>
                <p className="text-lg font-semibold font-mono" data-testid="total-venta">{formatCurrency(totals.total)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Días</p>
                <p className="text-lg font-semibold font-mono" data-testid="total-dias">{totals.dias}</p>
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
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                        No hay ventas para el filtro seleccionado.
                      </td>
                    </tr>
                  ) : (
                    filteredExisting.map((e) => (
                      <tr key={e.id} className="border-b">
                        <td className="px-3 py-2">{localNameById.get(e.localId) ?? `Local ${e.localId}`}</td>
                        <td className="px-3 py-2 font-mono">{e.fecha}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(e.ventaTotal)) || 0)}</td>
                        <td className="px-3 py-2 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => { setDeleteRow(e); setDeleteKeyword(""); }}
                            data-testid={`button-delete-${e.id}`}
                          >
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
            <DialogTitle>Eliminar venta</DialogTitle>
            <DialogDescription>
              {deleteRow && (
                <>
                  Vas a eliminar la venta de{" "}
                  <span className="font-medium">{localNameById.get(deleteRow.localId) ?? `Local ${deleteRow.localId}`}</span>{" "}
                  del <span className="font-mono">{deleteRow.fecha}</span>. Esta acción no se puede deshacer.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">
              Para confirmar, escribí <span className="font-mono font-semibold">{DELETE_KEYWORD}</span>
            </Label>
            <Input
              value={deleteKeyword}
              onChange={(e) => setDeleteKeyword(e.target.value)}
              placeholder={DELETE_KEYWORD}
              autoComplete="off"
              data-testid="input-delete-keyword"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDeleteDialog} data-testid="button-cancel-delete">
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteKeyword.trim().toUpperCase() !== DELETE_KEYWORD || deleteMutation.isPending}
              onClick={() => deleteRow && deleteMutation.mutate(deleteRow.id)}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
