import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  FileSpreadsheet,
  FileText,
  Pencil,
  Plus,
  Store,
  Trash2,
  Upload,
} from "lucide-react";
import {
  parseComprobantesRows,
  parseComprobantesCsv,
  decodeAfipCsv,
  readCsvFileNameHints,
  aggregateEmitidos,
  type EmitidoAggregate,
  type ParseComprobantesResult,
} from "@shared/afipComprobantesParser";
import type { Local, BusinessName } from "@shared/schema";

interface SalePoint {
  id: number;
  businessNameId: number;
  number: number;
  fantasyName: string | null;
  localId: number | null;
  salesSystem: string | null;
  active: boolean;
  local: Local | null;
  businessNameLabel: string | null;
  businessNameCuit: string | null;
}

interface IssuedRow {
  id: number;
  voucherDate: string;
  salePoint: number;
  voucherTypeCode: number;
  voucherTypeName: string;
  quantity: number;
  netGravado: number;
  totalIva: number;
  total: number;
  salePointName: string | null;
  salesSystem: string | null;
  localName: string | null;
}

interface IssuedSummary {
  rows: IssuedRow[];
  porPuntoVenta: Array<{
    salePoint: number;
    salePointId: number | null;
    salePointName: string | null;
    localName: string | null;
    salesSystem: string | null;
    cantidad: number;
    neto: number;
    iva: number;
    total: number;
  }>;
  resumen: {
    cantidad: number;
    neto: number;
    iva: number;
    total: number;
    puntosDeVenta: number;
    sinDarDeAlta: number[];
    sinLocal: number[];
  };
}

const SALES_SYSTEM_LABELS: Record<string, string> = {
  fudo: "Fudo",
  shares: "Shares",
  datalive: "Datalive",
  none: "No factura por sistema",
};

const firstDayOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Solapa "Comprobantes Emitidos" (punto 1, ago-26).
 *
 * Muestra lo facturado por la empresa, con el total desglosado por punto de venta. AFIP no
 * informa el local: el local sale del punto de venta dado de alta, por eso el alta de puntos
 * de venta es lo que habilita el filtro por local.
 *
 * Los emitidos se guardan resumidos por dia + punto de venta + tipo (ver el parser): una sola
 * sociedad emite ~11.000 comprobantes por mes y al detalle no aportarian nada que se use.
 */
export function ComprobantesEmitidos() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [localId, setLocalId] = useState("all");
  const [salePointFilter, setSalePointFilter] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [salePointsOpen, setSalePointsOpen] = useState(false);
  const [editing, setEditing] = useState<SalePoint | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: salePoints = [] } = useQuery<SalePoint[]>({ queryKey: ["/api/afip/sale-points"] });

  const params = new URLSearchParams({ dateFrom, dateTo });
  if (localId !== "all") params.set("localId", localId);
  if (salePointFilter !== "all") params.set("salePoint", salePointFilter);

  const { data, isLoading } = useQuery<IssuedSummary>({
    queryKey: ["/api/afip/issued", dateFrom, dateTo, localId, salePointFilter],
    queryFn: async () => {
      const res = await fetch(`/api/afip/issued?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "No se pudo cargar");
      return res.json();
    },
  });

  const resumen = data?.resumen;

  const localOptions = useMemo(
    () => [{ value: "all", label: "Todos los locales" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );

  // Los puntos de venta que se pueden filtrar salen de lo importado, no del catalogo: asi
  // tambien se puede filtrar uno que todavia no se dio de alta.
  const salePointOptions = useMemo(() => {
    const nums = new Set<number>((data?.porPuntoVenta ?? []).map((p) => p.salePoint));
    salePoints.forEach((sp) => nums.add(sp.number));
    const byNumber = new Map(salePoints.map((sp) => [sp.number, sp]));
    return [
      { value: "all", label: "Todos los puntos de venta" },
      ...[...nums]
        .sort((a, b) => a - b)
        .map((n) => {
          const sp = byNumber.get(n);
          return { value: String(n), label: sp?.fantasyName ? `${n} · ${sp.fantasyName}` : String(n) };
        }),
    ];
  }, [data?.porPuntoVenta, salePoints]);

  const columns: Column<IssuedRow>[] = [
    {
      key: "voucherDate",
      header: "Fecha",
      cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{formatDate(r.voucherDate)}</span>,
    },
    {
      key: "salePoint",
      header: "Punto de venta",
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm">{String(r.salePoint).padStart(4, "0")}</p>
          {r.salePointName && <p className="text-xs text-muted-foreground truncate">{r.salePointName}</p>}
        </div>
      ),
    },
    { key: "voucherTypeName", header: "Comprobante", cell: (r) => <span className="text-sm">{r.voucherTypeName}</span> },
    {
      key: "localName",
      header: "Local",
      cell: (r) => (r.localName ? <span className="text-sm">{r.localName}</span> : <span className="text-xs text-muted-foreground">—</span>),
    },
    { key: "quantity", header: "Cantidad", cell: (r) => <span className="font-mono text-sm">{r.quantity}</span> },
    {
      key: "netGravado",
      header: "Neto",
      cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{formatCurrency(r.netGravado)}</span>,
    },
    {
      key: "totalIva",
      header: "IVA",
      cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{formatCurrency(r.totalIva)}</span>,
    },
    {
      key: "total",
      header: "Total",
      cell: (r) => <span className="font-mono text-sm font-semibold whitespace-nowrap">{formatCurrency(r.total)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comprobantes Emitidos"
        description="Lo que la empresa facturó, con el total desglosado por punto de venta"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setSalePointsOpen(true)} data-testid="button-sale-points">
              <Store className="h-4 w-4 mr-2" />
              Puntos de Venta
              {salePoints.length > 0 && <Badge variant="secondary" className="ml-2">{salePoints.length}</Badge>}
            </Button>
            <Button onClick={() => setImportOpen(true)} data-testid="button-import-emitidos">
              <Upload className="h-4 w-4 mr-2" />
              Importar Comprobantes Emitidos
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Desde</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-40 text-sm" data-testid="input-emitidos-desde" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Hasta</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-40 text-sm" data-testid="input-emitidos-hasta" />
          </div>
          <div className="space-y-1 min-w-[200px]">
            <Label className="text-xs text-muted-foreground">Local</Label>
            <DataEntryCombobox options={localOptions} value={localId} onValueChange={setLocalId} placeholder="Todos los locales" />
          </div>
          <div className="space-y-1 min-w-[220px]">
            <Label className="text-xs text-muted-foreground">Punto de venta</Label>
            <DataEntryCombobox options={salePointOptions} value={salePointFilter} onValueChange={setSalePointFilter} placeholder="Todos los puntos de venta" />
          </div>
        </CardContent>
      </Card>

      {(resumen?.sinDarDeAlta.length ?? 0) > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Hay comprobantes de{" "}
            {resumen!.sinDarDeAlta.length === 1 ? "un punto de venta que no está" : "puntos de venta que no están"} dado
            {resumen!.sinDarDeAlta.length === 1 ? "" : "s"} de alta: <strong>{resumen!.sinDarDeAlta.join(", ")}</strong>. Sin
            darlos de alta no tienen local asociado y el filtro por local no los alcanza.
          </AlertDescription>
        </Alert>
      )}

      {/* Dashboard: se recalcula con los filtros de arriba. */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Total facturado", value: formatCurrency(resumen?.total ?? 0), hint: "las notas de crédito restan" },
          { label: "Neto gravado", value: formatCurrency(resumen?.neto ?? 0) },
          { label: "IVA", value: formatCurrency(resumen?.iva ?? 0) },
          { label: "Comprobantes", value: String(resumen?.cantidad ?? 0) },
          { label: "Puntos de venta", value: String(resumen?.puntosDeVenta ?? 0) },
        ].map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{k.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-28" /> : <p className="text-2xl font-bold">{k.value}</p>}
              {k.hint && <p className="text-xs text-muted-foreground mt-0.5">{k.hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {(data?.porPuntoVenta.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Desglose por punto de venta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data!.porPuntoVenta.map((p) => {
              const share = resumen && resumen.total !== 0 ? (p.total / resumen.total) * 100 : 0;
              return (
                <div
                  key={p.salePoint}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => setSalePointFilter(String(p.salePoint))}
                  data-testid={`desglose-pv-${p.salePoint}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Punto de venta {String(p.salePoint).padStart(4, "0")}
                      {p.salePointName ? ` · ${p.salePointName}` : ""}
                      {!p.salePointId && (
                        <Badge variant="outline" className="ml-2 text-xs text-amber-600 dark:text-amber-400 border-amber-500/30">
                          sin dar de alta
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.cantidad} comprobantes · {p.localName ?? "sin local"}
                      {p.salesSystem && p.salesSystem !== "none" ? ` · ${SALES_SYSTEM_LABELS[p.salesSystem] ?? p.salesSystem}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold">{formatCurrency(p.total)}</p>
                    <p className="text-xs text-muted-foreground">{share.toFixed(1)}% del total</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <DataTable
        data={data?.rows ?? []}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No hay comprobantes emitidos para este período. Usá 'Importar Comprobantes Emitidos'."
      />

      <SalePointsDialog
        open={salePointsOpen}
        onOpenChange={setSalePointsOpen}
        salePoints={salePoints}
        locals={locals}
        onCreate={() => setCreating(true)}
        onEdit={(sp) => setEditing(sp)}
      />
      <SalePointFormDialog
        open={creating || !!editing}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setEditing(null);
          }
        }}
        salePoint={editing}
        locals={locals}
      />
      <ImportEmitidosDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

// ==========================================
// PUNTOS DE VENTA
// ==========================================

function SalePointsDialog({
  open,
  onOpenChange,
  salePoints,
  locals,
  onCreate,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  salePoints: SalePoint[];
  locals: Local[];
  onCreate: () => void;
  onEdit: (sp: SalePoint) => void;
}) {
  const { toast } = useToast();

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/afip/sale-points/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/afip/sale-points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/afip/issued"] });
      toast({ title: "Punto de venta eliminado" });
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Puntos de Venta</DialogTitle>
          <DialogDescription>
            Cada punto de venta pertenece a una sociedad y a un local. El número es único por
            sociedad: dos sociedades distintas pueden tener las dos el 0001.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2">
          {salePoints.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Todavía no hay puntos de venta cargados.
            </p>
          )}
          {salePoints.map((sp) => (
            <div key={sp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {String(sp.number).padStart(4, "0")}
                  {sp.fantasyName ? ` · ${sp.fantasyName}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sp.businessNameLabel ?? "sin sociedad"} · {sp.local?.name ?? "sin local"} ·{" "}
                  {SALES_SYSTEM_LABELS[sp.salesSystem ?? "none"] ?? sp.salesSystem}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => onEdit(sp)} data-testid={`button-edit-sp-${sp.id}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMut.mutate(sp.id)}
                  disabled={deleteMut.isPending}
                  data-testid={`button-delete-sp-${sp.id}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button onClick={onCreate} data-testid="button-create-sale-point">
            <Plus className="h-4 w-4 mr-2" />
            Crear Punto de Venta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SalePointFormDialog({
  open,
  onOpenChange,
  salePoint,
  locals,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  salePoint: SalePoint | null;
  locals: Local[];
}) {
  const { toast } = useToast();
  const isEdit = !!salePoint;

  const { data: businessNames = [] } = useQuery<BusinessName[]>({ queryKey: ["/api/business-names"] });

  const [businessNameId, setBusinessNameId] = useState("");
  const [number, setNumber] = useState("");
  const [fantasyName, setFantasyName] = useState("");
  const [localId, setLocalId] = useState("none");
  const [salesSystem, setSalesSystem] = useState("none");
  const [touched, setTouched] = useState(false);

  // Al abrir se precargan los datos del punto de venta que se esta editando; una vez que el
  // usuario toco algo (`touched`), el formulario deja de seguir a la prop.
  useEffect(() => {
    if (!open || touched) return;
    setBusinessNameId(salePoint ? String(salePoint.businessNameId) : "");
    setNumber(salePoint ? String(salePoint.number) : "");
    setFantasyName(salePoint?.fantasyName ?? "");
    setLocalId(salePoint?.localId ? String(salePoint.localId) : "none");
    setSalesSystem(salePoint?.salesSystem ?? "none");
  }, [open, touched, salePoint?.id]);

  const close = () => {
    setTouched(false);
    setBusinessNameId("");
    setNumber("");
    setFantasyName("");
    setLocalId("none");
    setSalesSystem("none");
    onOpenChange(false);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        businessNameId: Number(businessNameId),
        number: Number(number),
        fantasyName: fantasyName.trim() || null,
        localId: localId === "none" ? null : Number(localId),
        salesSystem,
      };
      const res = isEdit
        ? await apiRequest("PUT", `/api/afip/sale-points/${salePoint!.id}`, payload)
        : await apiRequest("POST", "/api/afip/sale-points", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/afip/sale-points"] });
      queryClient.invalidateQueries({ queryKey: ["/api/afip/issued"] });
      toast({ title: isEdit ? "Punto de venta actualizado" : "Punto de venta creado" });
      close();
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const valid = businessNameId && Number(number) > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar punto de venta" : "Crear Punto de Venta"}</DialogTitle>
          <DialogDescription>
            El número es único por sociedad. El local es el que se usa después para filtrar los
            comprobantes emitidos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Sociedad *</Label>
            <DataEntryCombobox
              options={businessNames.map((b) => ({ value: String(b.id), label: b.cuit ? `${b.name} · ${b.cuit}` : b.name }))}
              value={businessNameId}
              onValueChange={(v) => {
                setTouched(true);
                setBusinessNameId(v);
              }}
              placeholder="Elegí la sociedad"
              data-testid="select-sp-business-name"
            />
          </div>

          <div className="space-y-1">
            <Label>Número de punto de venta *</Label>
            <Input
              type="number"
              min={1}
              value={number}
              onChange={(e) => {
                setTouched(true);
                setNumber(e.target.value);
              }}
              placeholder="Por ejemplo: 7"
              data-testid="input-sp-number"
            />
          </div>

          <div className="space-y-1">
            <Label>Nombre de fantasía</Label>
            <Input
              value={fantasyName}
              onChange={(e) => {
                setTouched(true);
                setFantasyName(e.target.value);
              }}
              placeholder="Con qué nombre lo reconocés"
              data-testid="input-sp-fantasy"
            />
          </div>

          <div className="space-y-1">
            <Label>Local asociado</Label>
            <DataEntryCombobox
              options={[{ value: "none", label: "Sin local" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))]}
              value={localId}
              onValueChange={(v) => {
                setTouched(true);
                setLocalId(v);
              }}
              placeholder="Elegí el local"
              data-testid="select-sp-local"
            />
          </div>

          <div className="space-y-1">
            <Label>¿Factura por algún sistema?</Label>
            <DataEntryCombobox
              options={[
                { value: "fudo", label: "Fudo" },
                { value: "datalive", label: "Datalive" },
                { value: "shares", label: "Shares" },
                { value: "none", label: "No" },
              ]}
              value={salesSystem}
              onValueChange={(v) => {
                setTouched(true);
                setSalesSystem(v);
              }}
              placeholder="Elegí el sistema"
              data-testid="select-sp-system"
            />
            <p className="text-xs text-muted-foreground">
              Un punto de venta factura por un solo sistema. Esto es lo que después permite comparar
              las ventas del sistema contra lo facturado en AFIP.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saveMut.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={!valid || saveMut.isPending} data-testid="button-save-sale-point">
            {saveMut.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==========================================
// IMPORTACION DE EMITIDOS
// ==========================================

function ImportEmitidosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseComprobantesResult | null>(null);
  const [aggregates, setAggregates] = useState<EmitidoAggregate[]>([]);
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [businessNameId, setBusinessNameId] = useState("");
  const [error, setError] = useState("");

  const { data: businessNames = [] } = useQuery<BusinessName[]>({ queryKey: ["/api/business-names"] });

  // El CUIT propio de un archivo de emitidos viene en el titulo del Excel o en el nombre del
  // CSV; si se reconoce, la sociedad queda preseleccionada, pero siempre se puede cambiar.
  const detected = useMemo(() => {
    if (!parsed?.cuitPropio) return null;
    const digits = parsed.cuitPropio.replace(/\D/g, "");
    return businessNames.find((b) => String(b.cuit ?? "").replace(/\D/g, "") === digits) ?? null;
  }, [parsed?.cuitPropio, businessNames]);

  useEffect(() => {
    if (detected && !businessNameId) setBusinessNameId(String(detected.id));
  }, [detected?.id, businessNameId]);

  const reset = () => {
    setParsed(null);
    setAggregates([]);
    setFileName("");
    setError("");
    setBusinessNameId("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const importMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/afip/issued/import", {
        businessNameId: Number(businessNameId),
        cuit: parsed?.cuitPropio ?? null,
        fileName,
        format,
        aggregates,
      });
      return res.json();
    },
    onSuccess: (r: { insertados: number; reemplazados: number; puntosDeVentaNuevos: number[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/afip/issued"] });
      queryClient.invalidateQueries({ queryKey: ["/api/afip/batches"] });
      toast({
        title: "Comprobantes emitidos importados",
        description:
          `${r.insertados} días nuevos, ${r.reemplazados} actualizados.` +
          (r.puntosDeVentaNuevos.length > 0
            ? ` Punto(s) de venta sin dar de alta: ${r.puntosDeVentaNuevos.join(", ")}.`
            : ""),
      });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "No se pudo importar", description: e.message, variant: "destructive" }),
  });

  const handleFile = async (file: File) => {
    setError("");
    setParsed(null);
    setAggregates([]);
    setFileName(file.name);
    try {
      const lower = file.name.toLowerCase();
      const buffer = await file.arrayBuffer();

      let result: ParseComprobantesResult;
      if (lower.endsWith(".zip")) {
        const files = unzipSync(new Uint8Array(buffer));
        const csvName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".csv"));
        if (!csvName) throw new Error("El .zip no trae ningún CSV adentro");
        const hints = readCsvFileNameHints(csvName);
        result = parseComprobantesCsv(decodeAfipCsv(files[csvName]), hints.kind ?? "emitidos");
        if (!result.cuitPropio && hints.cuit) result.cuitPropio = hints.cuit;
        setFormat("csv");
      } else if (lower.endsWith(".csv")) {
        const hints = readCsvFileNameHints(file.name);
        result = parseComprobantesCsv(decodeAfipCsv(buffer), hints.kind ?? "emitidos");
        if (!result.cuitPropio && hints.cuit) result.cuitPropio = hints.cuit;
        setFormat("csv");
      } else {
        const wb = XLSX.read(buffer, { type: "array" });
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
        result = parseComprobantesRows(rows, "emitidos");
        setFormat("xlsx");
      }

      if (result.comprobantes.length === 0) {
        setError(result.warnings[0] ?? "El archivo no trae comprobantes");
        return;
      }
      if (result.kind === "recibidos") {
        setError("Este archivo es de comprobantes RECIBIDOS. Subilo en la solapa Comprobantes Recibidos.");
        return;
      }
      setParsed(result);
      setAggregates(aggregateEmitidos(result.comprobantes));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo leer el archivo");
    }
  };

  const periodo = useMemo(() => {
    if (!aggregates.length) return null;
    const fechas = aggregates.map((a) => a.fecha).sort();
    return { desde: fechas[0], hasta: fechas[fechas.length - 1] };
  }, [aggregates]);

  const porPv = useMemo(() => {
    const map = new Map<number, { cantidad: number; total: number }>();
    for (const a of aggregates) {
      const acc = map.get(a.puntoVenta) ?? { cantidad: 0, total: 0 };
      acc.cantidad += a.cantidad;
      acc.total += a.total;
      map.set(a.puntoVenta, acc);
    }
    return [...map.entries()].sort((x, y) => x[0] - y[0]);
  }, [aggregates]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Comprobantes Emitidos</DialogTitle>
          <DialogDescription>
            Sirven los dos formatos de AFIP: el Excel de "Mis Comprobantes" y el CSV de cuando son
            muchos (podés subir el .zip sin descomprimir).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
            data-testid="input-file-emitidos"
          />

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {parsed && (
            <>
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {format === "csv" ? <FileText className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
                  {fileName}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Comprobantes</p>
                    <p className="font-semibold">{parsed.comprobantes.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total del archivo</p>
                    <p className="font-semibold font-mono">
                      {formatCurrency(aggregates.reduce((s, a) => s + a.total, 0))}
                    </p>
                  </div>
                  {periodo && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">Período</p>
                      <p className="font-semibold">
                        {formatDate(periodo.desde)} — {formatDate(periodo.hasta)}
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Por punto de venta</p>
                  {porPv.map(([pv, v]) => (
                    <div key={pv} className="flex justify-between text-sm">
                      <span>
                        Punto de venta {String(pv).padStart(4, "0")}{" "}
                        <span className="text-muted-foreground">· {v.cantidad} comprobantes</span>
                      </span>
                      <span className="font-mono">{formatCurrency(v.total)}</span>
                    </div>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground">
                  Se guardan {aggregates.length} filas: un resumen por día, punto de venta y tipo de
                  comprobante. Los totales y el desglose quedan exactos.
                </p>
              </div>

              <div className="space-y-1">
                <Label>Sociedad *</Label>
                <DataEntryCombobox
                  options={businessNames.map((b) => ({ value: String(b.id), label: b.cuit ? `${b.name} · ${b.cuit}` : b.name }))}
                  value={businessNameId}
                  onValueChange={setBusinessNameId}
                  placeholder="Elegí la sociedad del archivo"
                  data-testid="select-emitidos-business-name"
                />
                <p className="text-xs text-muted-foreground">
                  {detected
                    ? `Detectada por el CUIT ${parsed.cuitPropio} del archivo.`
                    : parsed.cuitPropio
                      ? `El archivo declara el CUIT ${parsed.cuitPropio}, que no coincide con ninguna sociedad cargada. Elegila a mano.`
                      : "El archivo no declara el CUIT: elegí a qué sociedad corresponde."}
                </p>
              </div>

              {parsed.warnings.map((w, i) => (
                <Alert key={i}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{w}</AlertDescription>
                </Alert>
              ))}

              <p className="text-xs text-muted-foreground">
                Volver a importar un período que ya cargaste no lo suma dos veces: reemplaza el
                resumen de esos días.
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMut.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => importMut.mutate()}
            disabled={!parsed || !businessNameId || importMut.isPending}
            data-testid="button-confirm-import-emitidos"
          >
            {importMut.isPending ? "Importando..." : `Importar ${parsed?.comprobantes.length ?? 0} comprobantes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
