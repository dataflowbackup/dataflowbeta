import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
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
  ArrowUpRight,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Receipt,
  Store,
  Upload,
  XCircle,
} from "lucide-react";
import {
  parseComprobantesRows,
  parseComprobantesCsv,
  decodeAfipCsv,
  readCsvFileNameHints,
  type ParseComprobantesResult,
} from "@shared/afipComprobantesParser";
import type { Local, Supplier } from "@shared/schema";

type Tab = "recibidos" | "emitidos";

interface ReconRow {
  id: number;
  voucherDate: string;
  voucherTypeName: string;
  voucherSystemType: string | null;
  salePoint: number;
  numberFrom: number;
  issuerCuit: string;
  issuerName: string;
  supplierId: number | null;
  supplierName: string | null;
  total: number;
  totalIva: number;
  status: "ok" | "importe" | "probable" | "faltante";
  matchLevel: "exacta" | "probable" | null;
  invoiceId: number | null;
  invoiceTotal: number | null;
  invoiceDate: string | null;
  amountDiff: number | null;
  dateDiff: number | null;
  localId: number | null;
  localName: string | null;
}

interface SobranteRow {
  invoiceId: number;
  invoiceDate: string;
  invoiceType: string;
  salePoint: string | null;
  number: string;
  supplierName: string | null;
  supplierCuit: string | null;
  total: number;
  localName: string | null;
  reason: "no_informado" | "proveedor_sin_cuit";
}

interface ReconResponse {
  rows: ReconRow[];
  sobrantes: SobranteRow[];
  resumen: {
    totalComprobantes: number;
    totalAfip: number;
    ok: number;
    okTotal: number;
    probable: number;
    probableTotal: number;
    importe: number;
    importeTotal: number;
    importeDiff: number;
    faltante: number;
    faltanteTotal: number;
    sobrante: number;
    sobranteTotal: number;
    sinProveedor: number;
    sinLocal: number;
  };
}

const STATUS_META: Record<ReconRow["status"], { label: string; className: string; icon: typeof CheckCircle2 }> = {
  ok: { label: "Cargada", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  probable: { label: "Probable", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30", icon: HelpCircle },
  importe: { label: "Difiere el importe", className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30", icon: AlertCircle },
  faltante: { label: "Falta cargar", className: "bg-destructive/10 text-destructive border-destructive/30", icon: XCircle },
};

const firstDayOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Modulo "Mis Comprobantes" (punto 1, ago-26).
 *
 * Trae lo que AFIP tiene registrado a nombre de la empresa y lo cruza contra lo cargado en el
 * sistema. La solapa de Recibidos compara contra Facturas: que comprobante informa AFIP que no
 * esta cargado, cual esta cargado con otro importe y cual esta en el sistema pero AFIP no informa.
 *
 * El local de un comprobante de AFIP sale de la factura que le matchea (AFIP no informa local),
 * por eso el filtro por local solo alcanza a los que ya cruzaron.
 */
export default function MisComprobantesPage() {
  const [tab, setTab] = useState<Tab>("recibidos");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="Comprobantes recibidos o emitidos">
        {([
          { id: "recibidos" as const, label: "Comprobantes Recibidos", icon: Receipt },
          { id: "emitidos" as const, label: "Comprobantes Emitidos", icon: FileText },
        ]).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              data-testid={`tab-comprobantes-${t.id}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "recibidos" ? <ComprobantesRecibidos /> : <ComprobantesEmitidos />}
    </div>
  );
}

// ==========================================
// COMPROBANTES RECIBIDOS
// ==========================================

function ComprobantesRecibidos() {
  const [dateFrom, setDateFrom] = useState(firstDayOfYear());
  const [dateTo, setDateTo] = useState(today());
  const [localId, setLocalId] = useState("all");
  const [supplierId, setSupplierId] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ReconRow["status"]>("all");
  const [importOpen, setImportOpen] = useState(false);

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const params = new URLSearchParams({ dateFrom, dateTo });
  if (localId !== "all") params.set("localId", localId);
  if (supplierId !== "all") params.set("supplierId", supplierId);
  const url = `/api/afip/received/reconciliation?${params.toString()}`;

  const { data, isLoading } = useQuery<ReconResponse>({
    queryKey: ["/api/afip/received/reconciliation", dateFrom, dateTo, localId, supplierId],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "No se pudo cargar el cruce");
      return res.json();
    },
  });

  const resumen = data?.resumen;
  const rows = useMemo(
    () => (statusFilter === "all" ? (data?.rows ?? []) : (data?.rows ?? []).filter((r) => r.status === statusFilter)),
    [data?.rows, statusFilter],
  );

  const localOptions = useMemo(
    () => [{ value: "all", label: "Todos los locales" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );
  const supplierOptions = useMemo(
    () => [
      { value: "all", label: "Todos los proveedores" },
      ...suppliers.map((s) => ({ value: String(s.id), label: s.tradeName })),
    ],
    [suppliers],
  );

  const columns: Column<ReconRow>[] = [
    {
      key: "voucherDate",
      header: "Fecha",
      cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{formatDate(r.voucherDate)}</span>,
    },
    {
      key: "voucherTypeName",
      header: "Comprobante",
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm truncate">{r.voucherTypeName}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {String(r.salePoint).padStart(4, "0")}-{String(r.numberFrom).padStart(8, "0")}
          </p>
        </div>
      ),
    },
    {
      key: "issuerName",
      header: "Proveedor",
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-sm truncate">{r.supplierName ?? r.issuerName}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {r.issuerCuit}
            {!r.supplierId && <span className="ml-1 text-amber-600 dark:text-amber-400">· sin dar de alta</span>}
          </p>
        </div>
      ),
    },
    {
      key: "localName",
      header: "Local",
      cell: (r) =>
        r.localName ? (
          <span className="text-sm">{r.localName}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "total",
      header: "Importe AFIP",
      cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{formatCurrency(r.total)}</span>,
    },
    {
      key: "status",
      header: "Estado",
      cell: (r) => {
        const meta = STATUS_META[r.status];
        const Icon = meta.icon;
        return (
          <div className="space-y-0.5">
            <Badge variant="outline" className={cn("gap-1 whitespace-nowrap", meta.className)}>
              <Icon className="h-3 w-3" />
              {meta.label}
            </Badge>
            {r.status === "importe" && r.amountDiff != null && (
              <p className="text-xs text-muted-foreground">
                sistema {formatCurrency(r.invoiceTotal ?? 0)} · dif {formatCurrency(r.amountDiff)}
              </p>
            )}
            {r.dateDiff != null && r.dateDiff !== 0 && (
              <p className="text-xs text-muted-foreground">
                {Math.abs(r.dateDiff)} día{Math.abs(r.dateDiff) === 1 ? "" : "s"} de diferencia en la fecha
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "acciones",
      header: "",
      cell: (r) =>
        r.invoiceId ? (
          <Link
            href={`/facturas/${r.invoiceId}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap"
            data-testid={`link-ver-factura-${r.id}`}
          >
            Ver factura
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        ) : (
          <Link
            href="/facturas/nueva"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline whitespace-nowrap"
            data-testid={`link-cargar-factura-${r.id}`}
          >
            Cargar
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        ),
    },
  ];

  const kpis: Array<{ key: "all" | ReconRow["status"] | "sobrante"; label: string; count: number; amount: number; hint?: string; tone: string }> = [
    { key: "all", label: "Comprobantes en AFIP", count: resumen?.totalComprobantes ?? 0, amount: resumen?.totalAfip ?? 0, tone: "" },
    { key: "ok", label: "Cargados y coinciden", count: resumen?.ok ?? 0, amount: resumen?.okTotal ?? 0, tone: "text-emerald-600 dark:text-emerald-400" },
    { key: "faltante", label: "Faltan cargar", count: resumen?.faltante ?? 0, amount: resumen?.faltanteTotal ?? 0, tone: "text-destructive" },
    { key: "importe", label: "Difieren en importe", count: resumen?.importe ?? 0, amount: resumen?.importeDiff ?? 0, hint: "diferencia", tone: "text-orange-600 dark:text-orange-400" },
    { key: "probable", label: "Coincidencia probable", count: resumen?.probable ?? 0, amount: resumen?.probableTotal ?? 0, hint: "sin punto de venta cargado", tone: "text-amber-600 dark:text-amber-400" },
    { key: "sobrante", label: "En el sistema, no en AFIP", count: resumen?.sobrante ?? 0, amount: resumen?.sobranteTotal ?? 0, tone: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comprobantes Recibidos"
        description="Lo que AFIP tiene registrado a nombre de la empresa, cruzado contra las facturas cargadas"
        actions={
          <Button onClick={() => setImportOpen(true)} data-testid="button-import-recibidos">
            <Upload className="h-4 w-4 mr-2" />
            Importar Comprobantes Recibidos
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Desde</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-40 text-sm" data-testid="input-recibidos-desde" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Hasta</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-40 text-sm" data-testid="input-recibidos-hasta" />
          </div>
          <div className="space-y-1 min-w-[200px]">
            <Label className="text-xs text-muted-foreground">Local</Label>
            <DataEntryCombobox options={localOptions} value={localId} onValueChange={setLocalId} placeholder="Todos los locales" />
          </div>
          <div className="space-y-1 min-w-[220px]">
            <Label className="text-xs text-muted-foreground">Proveedor</Label>
            <DataEntryCombobox options={supplierOptions} value={supplierId} onValueChange={setSupplierId} placeholder="Todos los proveedores" />
          </div>
        </CardContent>
      </Card>

      {localId !== "all" && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            AFIP no informa el local: el local de un comprobante sale de la factura que le cruzó. Con este
            filtro puesto no vas a ver los comprobantes que todavía no están cargados.
          </AlertDescription>
        </Alert>
      )}

      {/* Dashboard: responde a los filtros y hace de filtro por estado al clickear. */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => {
          const clickable = k.key !== "sobrante";
          const active = statusFilter === k.key;
          return (
            <Card
              key={k.key}
              onClick={() => clickable && setStatusFilter(k.key as any)}
              className={cn(clickable && "cursor-pointer transition-colors hover:bg-muted/40", active && "ring-2 ring-primary")}
              data-testid={`kpi-${k.key}`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">{k.label}</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <p className={cn("text-2xl font-bold", k.tone)}>{k.count}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {k.hint ? `${k.hint}: ` : ""}
                      {formatCurrency(k.amount)}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {resumen && (resumen.sinProveedor > 0 || resumen.sinLocal > 0) && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {resumen.sinProveedor > 0 && (
            <Badge variant="outline" className="gap-1">
              <Store className="h-3 w-3" />
              {resumen.sinProveedor} de proveedores que no están dados de alta
            </Badge>
          )}
          {statusFilter !== "all" && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setStatusFilter("all")}>
              Quitar el filtro por estado
            </Button>
          )}
        </div>
      )}

      <DataTable
        data={rows}
        columns={columns}
        isLoading={isLoading}
        emptyMessage={
          (data?.rows.length ?? 0) === 0
            ? "No hay comprobantes importados para este período. Usá 'Importar Comprobantes Recibidos'."
            : "Ningún comprobante coincide con el filtro."
        }
      />

      {(data?.sobrantes.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Facturas cargadas que AFIP no informa</CardTitle>
            <p className="text-sm text-muted-foreground">
              Están en el sistema dentro del período pero no aparecen en el archivo de AFIP. Puede ser una
              carga de más, un dato mal tipeado, o que el proveedor no tenga CUIT cargado.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {data!.sobrantes.map((s) => (
              <div key={s.invoiceId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <div className="min-w-0">
                  <p className="text-sm truncate">
                    {s.supplierName ?? "Sin proveedor"} · {s.invoiceType}{" "}
                    <span className="font-mono text-xs">
                      {s.salePoint ? `${s.salePoint}-` : ""}
                      {s.number}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(s.invoiceDate)} · {s.localName ?? "sin local"} ·{" "}
                    {s.reason === "proveedor_sin_cuit" ? (
                      <span className="text-amber-600 dark:text-amber-400">el proveedor no tiene CUIT cargado, no puede cruzar</span>
                    ) : (
                      "AFIP no lo informa"
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm">{formatCurrency(s.total)}</span>
                  <Link href={`/facturas/${s.invoiceId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    Ver factura
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <ImportRecibidosDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

// ==========================================
// IMPORTACION
// ==========================================

function ImportRecibidosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseComprobantesResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [error, setError] = useState("");

  const { data: sociedad } = useQuery<{ id: number; name: string; cuit: string } | null>({
    queryKey: ["/api/afip/business-name-by-cuit", parsed?.cuitPropio],
    queryFn: async () => {
      const res = await fetch(`/api/afip/business-name-by-cuit/${parsed!.cuitPropio}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!parsed?.cuitPropio,
  });

  const reset = () => {
    setParsed(null);
    setFileName("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const importMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/afip/received/import", {
        businessNameId: sociedad?.id ?? null,
        cuit: parsed?.cuitPropio ?? null,
        fileName,
        format,
        vouchers: parsed!.comprobantes,
      });
      return res.json();
    },
    onSuccess: (r: { insertados: number; actualizados: number; proveedoresNoEncontrados: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/afip/received/reconciliation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/afip/batches"] });
      toast({
        title: "Comprobantes importados",
        description:
          `${r.insertados} nuevos, ${r.actualizados} actualizados.` +
          (r.proveedoresNoEncontrados > 0
            ? ` ${r.proveedoresNoEncontrados} son de proveedores que no están dados de alta.`
            : ""),
      });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "No se pudo importar", description: e.message, variant: "destructive" }),
  });

  /** Acepta el Excel, el CSV suelto y el .zip tal como lo entrega AFIP. */
  const handleFile = async (file: File) => {
    setError("");
    setParsed(null);
    setFileName(file.name);
    try {
      const lower = file.name.toLowerCase();
      const buffer = await file.arrayBuffer();

      if (lower.endsWith(".zip")) {
        const files = unzipSync(new Uint8Array(buffer));
        const csvName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".csv"));
        if (!csvName) throw new Error("El .zip no trae ningún CSV adentro");
        const hints = readCsvFileNameHints(csvName);
        const result = parseComprobantesCsv(decodeAfipCsv(files[csvName]), hints.kind ?? "recibidos");
        if (!result.cuitPropio && hints.cuit) result.cuitPropio = hints.cuit;
        setFormat("csv");
        finish(result);
        return;
      }

      if (lower.endsWith(".csv")) {
        const hints = readCsvFileNameHints(file.name);
        const result = parseComprobantesCsv(decodeAfipCsv(buffer), hints.kind ?? "recibidos");
        if (!result.cuitPropio && hints.cuit) result.cuitPropio = hints.cuit;
        setFormat("csv");
        finish(result);
        return;
      }

      const wb = XLSX.read(buffer, { type: "array" });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], {
        header: 1,
        raw: false,
        defval: "",
      });
      setFormat("xlsx");
      finish(parseComprobantesRows(rows));
    } catch (e: any) {
      setError(e?.message ?? "No se pudo leer el archivo");
    }
  };

  const finish = (result: ParseComprobantesResult) => {
    if (result.comprobantes.length === 0) {
      setError(result.warnings[0] ?? "El archivo no trae comprobantes");
      return;
    }
    if (result.kind === "emitidos") {
      setError("Este archivo es de comprobantes EMITIDOS. Subilo en la solapa Comprobantes Emitidos.");
      return;
    }
    setParsed(result);
  };

  const periodo = useMemo(() => {
    if (!parsed?.comprobantes.length) return null;
    const fechas = parsed.comprobantes.map((c) => c.fecha).sort();
    return { desde: fechas[0], hasta: fechas[fechas.length - 1] };
  }, [parsed]);

  const totalArchivo = useMemo(
    () => (parsed?.comprobantes ?? []).reduce((s, c) => s + c.total, 0),
    [parsed],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Comprobantes Recibidos</DialogTitle>
          <DialogDescription>
            Sirven los dos formatos que da AFIP: el Excel de "Mis Comprobantes" y el CSV que entrega
            cuando son muchos (podés subir el .zip sin descomprimir).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.zip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
              data-testid="input-file-recibidos"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {parsed && (
            <>
              <div className="rounded-lg border p-3 space-y-2">
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
                    <p className="font-semibold font-mono">{formatCurrency(totalArchivo)}</p>
                  </div>
                  {periodo && (
                    <div>
                      <p className="text-xs text-muted-foreground">Período</p>
                      <p className="font-semibold">
                        {formatDate(periodo.desde)} — {formatDate(periodo.hasta)}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Sociedad (CUIT {parsed.cuitPropio ?? "?"})</p>
                    <p className="font-semibold">
                      {sociedad ? (
                        sociedad.name
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">no reconocida</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {!sociedad && parsed.cuitPropio && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Ninguna sociedad cargada tiene el CUIT {parsed.cuitPropio}. Se puede importar igual, pero
                    conviene cargarlo en Configuración → Sociedades para que quede identificado.
                  </AlertDescription>
                </Alert>
              )}

              {parsed.warnings.map((w, i) => (
                <Alert key={i}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{w}</AlertDescription>
                </Alert>
              ))}

              <p className="text-xs text-muted-foreground">
                Volver a importar un período que ya cargaste no duplica nada: los comprobantes que ya
                estaban se actualizan.
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
            disabled={!parsed || importMut.isPending}
            data-testid="button-confirm-import-recibidos"
          >
            {importMut.isPending ? "Importando..." : `Importar ${parsed?.comprobantes.length ?? 0} comprobantes`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ==========================================
// COMPROBANTES EMITIDOS
// ==========================================

function ComprobantesEmitidos() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Comprobantes Emitidos"
        description="Lo que la empresa facturó, desglosado por punto de venta"
      />
      <Card>
        <CardContent className="py-10 text-center space-y-2">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium">En preparación</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Acá van a estar el alta de puntos de venta y la importación de los comprobantes emitidos,
            con el total desglosado por punto de venta.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
