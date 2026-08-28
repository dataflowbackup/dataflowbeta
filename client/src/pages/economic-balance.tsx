import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { useSalesSources } from "@/hooks/useSalesSources";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Settings2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
} from "lucide-react";
import type { Local, CmvCalculation, FinancialGroup } from "@shared/schema";
import { buildCmvForBalance } from "@shared/balanceCmv";
import {
  buildCmvProductosForBalance,
  compareCmvVsProductos,
  CMV_PRODUCTOS_MIN_COVERAGE,
  type CmvProductoCalculationLike,
} from "@shared/balanceCmvProductos";
import { MONTH_NAMES_ES } from "@shared/economicMonth";

const SHORT_MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type SalesSource = "datalive" | "fudo" | "shares";

const SALES_SOURCE_OPTIONS: { value: SalesSource; label: string }[] = [
  { value: "datalive", label: "Datalive" },
  { value: "fudo", label: "Fudo" },
  { value: "shares", label: "Shares" },
];

interface EconCategory {
  id: number;
  name: string;
  monthlyTotals: Record<number, number>;
  yearTotal: number;
}

interface EconGroup {
  id: number;
  name: string;
  type: string;
  isMerchandise: boolean;
  computes: boolean;
  categories: EconCategory[];
  monthlyTotals: Record<number, number>;
  yearTotal: number;
}

interface EconomicBalanceData {
  salesSources: SalesSource[];
  ventas: {
    monthly: Record<number, number>;
    byLocal: Record<number, Record<number, number>>;
    composition: { label: string; monthlyTotals: Record<number, number>; yearTotal: number }[];
    /** Locales que facturan en más de una fuente elegida: ahí sí se estaría duplicando la venta. */
    overlappingLocalIds: number[];
    yearTotal: number;
  };
  groups: EconGroup[];
  summary: { gastos: Record<number, number>; totalGastos: number };
}

/**
 * BALANCE ECONÓMICO (ago-2026).
 *
 * Mide rentabilidad devengada, a diferencia del Balance Financiero que mide el flujo de dinero:
 *  - las VENTAS salen del sistema de gestión (Datalive / Fudo / Shares), no de los movimientos;
 *  - los GASTOS se agrupan por MES ECONÓMICO, no por la fecha de acreditación;
 *  - el costo de mercadería es el CMV (mismo criterio que el Financiero), no lo pagado a proveedores;
 *  - los Movimientos Financieros quedan afuera: no son economía del período.
 *
 * Por eso sus ventas NO coinciden con las del Balance Financiero, y no tienen por qué: son ventas
 * brutas del sistema contra dinero efectivamente acreditado.
 */
export default function EconomicBalancePage() {
  const { toast } = useToast();
  const now = new Date();
  const currentYear = now.getFullYear();

  const [selectedYear, setSelectedYear] = usePersistentFilter("balanceEconomico.year", String(currentYear));
  const [selectedMonth, setSelectedMonth] = usePersistentFilter("balanceEconomico.month", String(now.getMonth() + 1));
  const [selectedLocalIds, setSelectedLocalIds] = usePersistentFilter<number[]>("balanceEconomico.localIds", []);
  /** Varias fuentes a la vez: cada local suele facturar con un sistema distinto. */
  const [salesSources, setSalesSources] = usePersistentFilter<SalesSource[]>("balanceEconomico.salesSources", ["datalive"]);
  // Punto 6 (ago-26): solo se ofrecen los sistemas encendidos en Preferencias.
  const { enabled: enabledSalesSources } = useSalesSources();
  const availableSourceOptions = SALES_SOURCE_OPTIONS.filter((o) =>
    (enabledSalesSources as readonly string[]).includes(o.value),
  );

  // Si alguna fuente elegida quedo deshabilitada, se la saca de la seleccion; si no
  // queda ninguna, se toma la primera habilitada para no dejar la pantalla sin ventas.
  useEffect(() => {
    if (enabledSalesSources.length === 0) return;
    setSalesSources((prev) => {
      const kept = prev.filter((v) => (enabledSalesSources as readonly string[]).includes(v));
      if (kept.length === prev.length) return prev;
      return kept.length > 0 ? kept : [enabledSalesSources[0] as SalesSource];
    });
  }, [enabledSalesSources.join(",")]);
  const [viewMode, setViewMode] = usePersistentFilter("balanceEconomico.viewMode", "monthly");
  const [expandedGroupIds, setExpandedGroupIds] = useState<number[]>([]);
  const [ventasOpen, setVentasOpen] = useState(false);

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: financialGroups = [] } = useQuery<FinancialGroup[]>({ queryKey: ["/api/financial-groups"] });
  const { data: cmvList = [] } = useQuery<CmvCalculation[]>({
    queryKey: ["/api/finance/cmv-calculations"],
    queryFn: async () => {
      const res = await fetch("/api/finance/cmv-calculations", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  // CMV Productos (teorico, por producto vendido). Se lee aparte del CMV por stock: son dos
  // caminos distintos al mismo costo y el valor esta justamente en compararlos.
  const { data: cmvProductosList = [] } = useQuery<CmvProductoCalculationLike[]>({
    queryKey: ["/api/finance/cmv-producto-calculations"],
    queryFn: async () => {
      const res = await fetch("/api/finance/cmv-producto-calculations", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const localIdsParam = selectedLocalIds.length > 0 ? selectedLocalIds.join(",") : "";
  const sourcesParam = salesSources.join(",");
  const { data, isLoading } = useQuery<EconomicBalanceData>({
    queryKey: ["/api/economic-balance", selectedYear, localIdsParam, sourcesParam],
    queryFn: async () => {
      const qs = new URLSearchParams({ year: selectedYear, salesSources: sourcesParam });
      if (localIdsParam) qs.set("localIds", localIdsParam);
      const res = await fetch(`/api/economic-balance?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar el balance económico");
      return res.json();
    },
    enabled: salesSources.length > 0,
  });

  const computesMut = useMutation({
    mutationFn: async ({ id, computes }: { id: number; computes: boolean }) => {
      await apiRequest("PATCH", `/api/financial-groups/${id}/economic-computes`, { computes });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/financial-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/economic-balance"] });
    },
    onError: (e: Error) =>
      toast({ title: "No se pudo cambiar el grupo", description: e.message, variant: "destructive" }),
  });

  const month = parseInt(selectedMonth, 10);
  const year = parseInt(selectedYear, 10);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const yearOptions = years.map((y) => ({ value: String(y), label: String(y) }));
  const monthOptions = MONTH_NAMES_ES.map((m, i) => ({ value: String(i + 1), label: m }));
  const toggleSource = (s: SalesSource) =>
    setSalesSources((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      // Sin ninguna fuente no hay balance que mostrar: se deja al menos la que se quiso sacar.
      return next.length === 0 ? prev : next;
    });

  const sourcesLabel =
    salesSources.length === 0
      ? "Ninguna"
      : salesSources.map((s) => SALES_SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? s).join(" + ");

  const ventasMes = data?.ventas.monthly[month] ?? 0;
  const prevMonth = month === 1 ? 12 : month - 1;
  const ventasPrev = data?.ventas.monthly[prevMonth] ?? 0;
  const evolucion = ventasPrev > 0 ? ((ventasMes - ventasPrev) / ventasPrev) * 100 : 0;

  /** Grupos que suman: TODOS los tildados. El tilde es el único criterio. */
  const computingGroups = useMemo(() => (data?.groups ?? []).filter((g) => g.computes), [data]);
  const excludedGroups = useMemo(() => (data?.groups ?? []).filter((g) => !g.computes), [data]);
  /** Tildados Y de mercadería: si además hay CMV, ese costo se está contando dos veces. */
  const merchandiseComputing = useMemo(
    () => (data?.groups ?? []).filter((g) => g.computes && g.isMerchandise && g.yearTotal !== 0),
    [data],
  );

  const ventasByLocal = data?.ventas.byLocal ?? {};

  /** Locales con facturación en el mes: los que no facturaron no tienen rentabilidad que medir. */
  const analyzedLocalIds = useMemo(() => {
    const base = selectedLocalIds.length > 0 ? selectedLocalIds : locals.map((l) => l.id);
    return base.filter((id) => Math.abs(ventasByLocal[id]?.[month] ?? 0) > 0.005);
  }, [selectedLocalIds, locals, ventasByLocal, month]);

  /**
   * CMV del mes, pasado a pesos contra las ventas DEL SISTEMA de cada local. Los locales sin CMV
   * cargado no se completan con lo pagado: quedan reportados en `missing`, porque taparlos con otro
   * criterio daría una rentabilidad falsa.
   */
  const cmvBalance = useMemo(() => {
    const ventasMesByLocal: Record<number, number> = {};
    for (const id of analyzedLocalIds) ventasMesByLocal[id] = ventasByLocal[id]?.[month] ?? 0;
    return buildCmvForBalance(cmvList, analyzedLocalIds, year, month, ventasMesByLocal);
  }, [cmvList, analyzedLocalIds, ventasByLocal, year, month]);

  /** CMV Productos del mes, con el MISMO criterio que el CMV por stock (% sobre facturacion). */
  const cmvProductosBalance = useMemo(() => {
    const ventasMesByLocal: Record<number, number> = {};
    for (const id of analyzedLocalIds) ventasMesByLocal[id] = ventasByLocal[id]?.[month] ?? 0;
    return buildCmvProductosForBalance(cmvProductosList, analyzedLocalIds, year, month, ventasMesByLocal);
  }, [cmvProductosList, analyzedLocalIds, ventasByLocal, year, month]);

  /** Diferencia entre los dos CMV. Solo sobre los locales que tienen los DOS calculos. */
  const cmvComparison = useMemo(
    () => compareCmvVsProductos(cmvBalance.rows, cmvProductosBalance.rows),
    [cmvBalance.rows, cmvProductosBalance.rows],
  );

  /**
   * Locales que están en la vista pero NO facturaron en la fuente elegida. Importa avisarlo: sus
   * gastos SÍ computan, así que aparecen restando sin ninguna venta que los respalde y la utilidad
   * sale falsamente negativa. Pasa de verdad cuando cada local usa un sistema de gestión distinto.
   */
  const localsSinVentas = useMemo(() => {
    const base = selectedLocalIds.length > 0 ? selectedLocalIds : locals.map((l) => l.id);
    return base.filter((id) => Math.abs(ventasByLocal[id]?.[month] ?? 0) <= 0.005);
  }, [selectedLocalIds, locals, ventasByLocal, month]);

  const gastosMes = data?.summary.gastos[month] ?? 0;
  const cmvMes = cmvBalance.totalCmv;
  const utilidadMes = ventasMes - cmvMes - gastosMes;
  const margenPct = ventasMes > 0 ? (utilidadMes / ventasMes) * 100 : 0;

  const localName = (id: number) => locals.find((l) => l.id === id)?.name ?? `Local #${id}`;

  const localsLabel =
    selectedLocalIds.length === 0
      ? "Todos los locales"
      : selectedLocalIds.map(localName).join(", ");

  /**
   * Filas del PDF. Mismo criterio y mismo orden que la pantalla, para que el PDF no cuente una
   * historia distinta: si en pantalla hay un aviso que cambia cómo leer la utilidad, va también acá.
   */
  const buildPdfRows = () => {
    const rows: { label: string; importe?: string; pct?: string; bold?: boolean; section?: boolean; indent?: boolean }[] = [];
    const pct = (v: number) => `${v.toFixed(1)}%`;

    rows.push({ label: `VENTAS (${sourcesLabel})`, importe: formatCurrency(ventasMes), bold: true });
    for (const c of data?.ventas.composition ?? []) {
      const v = c.monthlyTotals[month] ?? 0;
      if (v === 0) continue;
      rows.push({
        label: c.label,
        importe: formatCurrency(v),
        pct: ventasMes > 0 ? pct((v / ventasMes) * 100) : "",
        indent: true,
      });
    }

    rows.push({ label: "GASTOS", importe: formatCurrency(gastosMes), bold: true });
    for (const g of computingGroups
      .filter((g) => (g.monthlyTotals[month] ?? 0) !== 0)
      .sort((a, b) => (b.monthlyTotals[month] ?? 0) - (a.monthlyTotals[month] ?? 0))) {
      const v = g.monthlyTotals[month] ?? 0;
      rows.push({
        label: g.name,
        importe: formatCurrency(v),
        pct: ventasMes > 0 ? pct((v / ventasMes) * 100) : "",
        indent: true,
      });
    }

    rows.push({ label: "CMV", importe: formatCurrency(cmvMes), bold: true });

    // Informativos: no restan en la utilidad, igual que en pantalla.
    if (cmvProductosBalance.rows.length > 0) {
      rows.push({
        label: "CMV Productos (teorico, no resta)",
        importe: formatCurrency(cmvProductosBalance.totalCmv),
        indent: true,
      });
    }
    if (cmvComparison.locals.length > 0) {
      rows.push({
        label: `Diferencia CMV - CMV Productos${cmvComparison.difPp != null ? ` (${cmvComparison.difPp >= 0 ? "+" : ""}${cmvComparison.difPp.toFixed(2)} pp)` : ""}`,
        importe: formatCurrency(cmvComparison.difMonto),
        indent: true,
      });
    }

    rows.push({
      label: "UTILIDAD ECONÓMICA",
      importe: formatCurrency(utilidadMes),
      pct: pct(margenPct),
      bold: true,
      section: true,
    });

    // El detalle del CMV va abajo de todo el análisis, igual que en pantalla.
    rows.push({ label: "CMV POR LOCAL", importe: formatCurrency(cmvMes), section: true, bold: true });
    for (const r of cmvBalance.rows) {
      rows.push({
        label: `${localName(r.localId)} · ${r.pct.toFixed(2)}%`,
        importe: formatCurrency(r.cmvAmount),
        indent: true,
      });
    }
    if (cmvBalance.hasMissing) {
      rows.push({
        label: `Sin CMV: ${cmvBalance.missing.map((m) => localName(m.localId)).join(", ")} — ${formatCurrency(cmvBalance.ventasSinCmv)} de ventas sin costo`,
        indent: true,
      });
    }

    if (cmvComparison.locals.length > 0) {
      rows.push({ label: "CMV REAL vs CMV PRODUCTOS", section: true, bold: true });
      for (const c of cmvComparison.locals) {
        rows.push({
          label: `${localName(c.localId)} · real ${c.pctReal?.toFixed(2)}% vs teorico ${c.pctTeorico?.toFixed(2)}%${c.coberturaPct != null ? ` · cobertura ${c.coberturaPct.toFixed(0)}%` : ""}`,
          importe: c.difMonto == null ? "" : formatCurrency(c.difMonto),
          pct: c.difPp == null ? "" : `${c.difPp >= 0 ? "+" : ""}${c.difPp.toFixed(2)} pp`,
          indent: true,
        });
      }
      if (cmvComparison.hasLowCoverage) {
        rows.push({
          label: `ATENCION: hay locales con menos del ${CMV_PRODUCTOS_MIN_COVERAGE}% de unidades con costo asignado; su CMV Productos esta subvaluado y la diferencia sale inflada.`,
        });
      }
      if (cmvComparison.soloReal.length > 0 || cmvComparison.soloTeorico.length > 0) {
        rows.push({
          label: `Fuera de la comparacion: ${[...cmvComparison.soloReal, ...cmvComparison.soloTeorico].map(localName).join(", ")}.`,
        });
      }
    }

    if (merchandiseComputing.length > 0 && cmvMes > 0) {
      rows.push({
        label: `ATENCION: ${merchandiseComputing.map((g) => g.name).join(", ")} suma(n) en GASTOS y ademas esta el CMV: el costo de mercaderia se cuenta dos veces.`,
      });
    }
    if ((data?.ventas.overlappingLocalIds ?? []).length > 0) {
      rows.push({
        label: `ATENCION: ${(data?.ventas.overlappingLocalIds ?? []).map(localName).join(", ")} factura(n) en mas de una fuente: su venta se suma dos veces.`,
      });
    }
    if (localsSinVentas.length > 0) {
      rows.push({
        label: `Sin ventas de ${sourcesLabel}: ${localsSinVentas.map(localName).join(", ")}. Sus gastos igual computan.`,
      });
    }
    if (excludedGroups.length > 0) {
      rows.push({ label: `No computan: ${excludedGroups.map((g) => g.name).join(", ")}.` });
    }
    return rows;
  };

  const exportPdf = () => {
    if (!data) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 40;
    const tableLeft = marginX;
    const tableRight = 555;
    const xConcepto = marginX;
    const divConceptoImporte = 380;
    const divImportePct = 470;
    const xImporteR = divImportePct - 6;
    const xPctR = tableRight - 4;
    const rowH = 18;
    const pageBottom = 800;

    let y = 50;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Estado de Resultado Económico", marginX, y);
    doc.text(`${MONTH_NAMES_ES[month - 1]} ${year}`, tableRight, y, { align: "right" });
    y += 18;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(localsLabel, marginX, y);
    doc.text(`Ventas: ${sourcesLabel} · Gastos por mes económico`, tableRight, y, { align: "right" });
    y += 18;

    const drawTableHeader = () => {
      doc.setFillColor(60, 60, 60);
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.5);
      doc.rect(tableLeft, y, tableRight - tableLeft, rowH, "FD");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Concepto", xConcepto + 4, y + 12);
      doc.text("Importe", xImporteR, y + 12, { align: "right" });
      doc.text("% s/ventas", xPctR, y + 12, { align: "right" });
      doc.setTextColor(0, 0, 0);
      y += rowH;
    };

    drawTableHeader();
    doc.setFontSize(9);

    for (const r of buildPdfRows()) {
      if (y + rowH > pageBottom) {
        doc.addPage();
        y = 50;
        drawTableHeader();
      }
      if (r.section) doc.setFillColor(225, 225, 225);
      else if (r.bold) doc.setFillColor(243, 243, 243);
      else doc.setFillColor(255, 255, 255);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.rect(tableLeft, y, tableRight - tableLeft, rowH, "FD");
      if (!r.section) {
        doc.line(divConceptoImporte, y, divConceptoImporte, y + rowH);
        doc.line(divImportePct, y, divImportePct, y + rowH);
      }
      doc.setFont("helvetica", r.bold ? "bold" : "normal");
      // El label se recorta al ancho de su columna para que no pise la de Importe.
      doc.text(
        doc.splitTextToSize((r.indent ? "   " : "") + r.label, divConceptoImporte - xConcepto - 10)[0] ?? "",
        xConcepto + 4,
        y + 12,
      );
      if (r.importe) doc.text(r.importe, xImporteR, y + 12, { align: "right" });
      if (r.pct) doc.text(r.pct, xPctR, y + 12, { align: "right" });
      y += rowH;
    }

    doc.save(`balance_economico_${year}_${String(month).padStart(2, "0")}.pdf`);
  };

  const toggleGroup = (id: number) =>
    setExpandedGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));

  const toggleLocal = (id: number) =>
    setSelectedLocalIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));

  const expenseGroupsForConfig = useMemo(
    () =>
      [...financialGroups]
        .filter((g) => g.active !== false && String(g.type) === "expense")
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
    [financialGroups],
  );
  const computingCount = expenseGroupsForConfig.filter((g) => (g as any).economicComputes ?? true).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estado de Resultado Económico"
        description="Rentabilidad devengada: ventas del sistema y gastos por mes económico"
        actions={
          <Button variant="outline" onClick={exportPdf} disabled={!data} data-testid="button-econ-export-pdf">
            <Download className="h-4 w-4 mr-2" />
            Exportar PDF
          </Button>
        }
      />

      {/* ---------- Filtros ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <DataEntryCombobox
          options={yearOptions}
          value={selectedYear}
          onValueChange={setSelectedYear}
          placeholder="Año"
          searchPlaceholder="Buscar…"
          triggerClassName="w-28"
        />
        <DataEntryCombobox
          options={monthOptions}
          value={selectedMonth}
          onValueChange={setSelectedMonth}
          placeholder="Mes"
          searchPlaceholder="Buscar…"
          triggerClassName="w-40"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2" data-testid="button-econ-locals">
              <ChevronsUpDown className="h-4 w-4" />
              {selectedLocalIds.length === 0
                ? "Todos los locales"
                : selectedLocalIds.length === 1
                  ? localName(selectedLocalIds[0])
                  : `${selectedLocalIds.length} locales`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="start">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Locales</p>
              <Button variant="ghost" size="sm" onClick={() => setSelectedLocalIds([])}>
                Todos
              </Button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {locals.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
                  <Checkbox checked={selectedLocalIds.includes(l.id)} onCheckedChange={() => toggleLocal(l.id)} />
                  <span className="text-sm">{l.name}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Ventas de:</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-econ-sources">
                <ChevronsUpDown className="h-4 w-4" />
                {sourcesLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-2" align="start">
              <div>
                <p className="text-sm font-medium">Sistemas de venta</p>
                <p className="text-xs text-muted-foreground">
                  Se suman. Cada local suele facturar con un solo sistema, así que combinándolos entra la venta de
                  todos los locales.
                </p>
              </div>
              <div className="space-y-1">
                {availableSourceOptions.map((s) => (
                  <label
                    key={s.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                  >
                    <Checkbox checked={salesSources.includes(s.value)} onCheckedChange={() => toggleSource(s.value)} />
                    <span className="text-sm">{s.label}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2" data-testid="button-econ-groups-config">
              <Settings2 className="h-4 w-4" />
              Grupos que computan ({computingCount} de {expenseGroupsForConfig.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-2" align="start">
            <div>
              <p className="text-sm font-medium">Grupos que computan</p>
              <p className="text-xs text-muted-foreground">
                Todo grupo tildado suma en los gastos. Destildá los que no son gasto económico del período (ej.
                compra de bienes, que es inversión, o la mercadería si ya la estás midiendo por CMV). Se guarda
                para este cliente y vale para todos los meses.
              </p>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {expenseGroupsForConfig.map((g) => {
                const computes = (g as any).economicComputes ?? true;
                return (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                  >
                    <Checkbox
                      checked={computes}
                      disabled={computesMut.isPending}
                      onCheckedChange={(v) => computesMut.mutate({ id: g.id, computes: v === true })}
                    />
                    <span className="flex-1 truncate text-sm">{g.name}</span>
                  </label>
                );
              })}
              {expenseGroupsForConfig.length === 0 && (
                <p className="py-3 text-center text-sm text-muted-foreground">No hay grupos de gasto.</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Tabs value={viewMode} onValueChange={setViewMode}>
        <TabsList>
          <TabsTrigger value="monthly">Vista Mensual</TabsTrigger>
          <TabsTrigger value="annual">Vista Anual</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ) : viewMode === "monthly" ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b pb-3">
            <CardTitle className="text-base font-semibold tracking-wide">EMPRESA</CardTitle>
            <span className="text-sm font-semibold">
              {MONTH_NAMES_ES[month - 1]} {year}
            </span>
          </CardHeader>
          <CardContent className="pt-4">
            {/* Evolución */}
            <div className="flex items-center justify-between border-b py-2 text-sm">
              <span className="text-muted-foreground">Evolución de Ventas</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-medium",
                  evolucion > 0 && "text-green-600",
                  evolucion < 0 && "text-red-600",
                  evolucion === 0 && "text-muted-foreground",
                )}
              >
                {ventasPrev > 0 ? (
                  <>
                    {evolucion > 0 ? <TrendingUp className="h-4 w-4" /> : evolucion < 0 ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    {evolucion.toFixed(1)}%
                  </>
                ) : (
                  "N/A"
                )}
              </span>
            </div>

            {/* VENTAS */}
            <div className="flex items-center justify-between pt-4">
              <span className="text-sm font-bold tracking-wide">VENTAS</span>
              <span className="font-mono font-bold text-green-600">{formatCurrency(ventasMes)}</span>
            </div>
            <button
              type="button"
              onClick={() => setVentasOpen((v) => !v)}
              className="mt-1 flex w-full items-center justify-between py-1.5 text-sm hover:bg-muted/50"
            >
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {ventasOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Composición ({sourcesLabel})
              </span>
              <span className="font-mono text-sm">{formatCurrency(ventasMes)}</span>
            </button>
            {ventasOpen && (
              <div className="ml-5 border-l pl-3">
                {(data?.ventas.composition ?? []).filter((c) => (c.monthlyTotals[month] ?? 0) !== 0).length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">
                    {sourcesLabel} no trae desglose de la venta para este mes.
                  </p>
                ) : (
                  (data?.ventas.composition ?? [])
                    .filter((c) => (c.monthlyTotals[month] ?? 0) !== 0)
                    .map((c) => (
                      <div key={c.label} className="flex items-center justify-between py-1 text-sm">
                        <span className="text-muted-foreground">{c.label}</span>
                        <span className="font-mono">{formatCurrency(c.monthlyTotals[month] ?? 0)}</span>
                      </div>
                    ))
                )}
              </div>
            )}

            {ventasMes === 0 ? (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  No hay ventas de {sourcesLabel} cargadas para {MONTH_NAMES_ES[month - 1]} {year} en los locales
                  seleccionados. Probá con otra fuente.
                </span>
              </div>
            ) : (
              localsSinVentas.length > 0 && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Sin ventas de {sourcesLabel} en {localsSinVentas.map(localName).join(", ")}. Sus gastos igual
                    computan más abajo, así que la utilidad queda subestimada. Si esos locales facturan con otro
                    sistema, sumá esa fuente arriba o filtrá por local.
                  </span>
                </div>
              )
            )}

            {(data?.ventas.overlappingLocalIds ?? []).length > 0 && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>Venta duplicada:</strong>{" "}
                  {(data?.ventas.overlappingLocalIds ?? []).map(localName).join(", ")} factura(n) en más de una de
                  las fuentes elegidas, así que su venta se está sumando dos veces. Dejá una sola fuente para esos
                  locales.
                </span>
              </div>
            )}

            {/* GASTOS */}
            <div className="mt-5 flex items-center justify-between border-t pt-3">
              <span className="text-sm font-bold tracking-wide">GASTOS</span>
              <span className="font-mono font-bold text-red-600">{formatCurrency(gastosMes)}</span>
            </div>
            <div className="mt-1">
              {computingGroups.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No hay gastos en este mes económico.</p>
              ) : (
                computingGroups
                  .filter((g) => (g.monthlyTotals[month] ?? 0) !== 0)
                  .sort((a, b) => (b.monthlyTotals[month] ?? 0) - (a.monthlyTotals[month] ?? 0))
                  .map((g) => {
                    const expanded = expandedGroupIds.includes(g.id);
                    const amount = g.monthlyTotals[month] ?? 0;
                    return (
                      <div key={g.id}>
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.id)}
                          className="flex w-full items-center justify-between py-1.5 text-sm hover:bg-muted/50"
                        >
                          <span className="inline-flex items-center gap-1">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {g.name}
                          </span>
                          <span className="font-mono">{formatCurrency(amount)}</span>
                        </button>
                        {expanded && (
                          <div className="ml-5 border-l pl-3">
                            {g.categories
                              .filter((c) => (c.monthlyTotals[month] ?? 0) !== 0)
                              .sort((a, b) => (b.monthlyTotals[month] ?? 0) - (a.monthlyTotals[month] ?? 0))
                              .map((c) => (
                                <div key={c.id} className="flex items-center justify-between py-1 text-sm">
                                  <span className="text-muted-foreground">{c.name}</span>
                                  <span className="font-mono">{formatCurrency(c.monthlyTotals[month] ?? 0)}</span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>

            {excludedGroups.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                No computan: {excludedGroups.map((g) => g.name).join(", ")}.
              </p>
            )}

            {/* CMV — resta en la utilidad; el detalle por local va abajo de todo el análisis. */}
            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="text-sm font-bold tracking-wide">CMV</span>
              <span className="font-mono font-bold text-red-600">{formatCurrency(cmvMes)}</span>
            </div>

            {merchandiseComputing.length > 0 && cmvMes > 0 && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>El costo de mercadería se está contando dos veces:</strong>{" "}
                  {merchandiseComputing.map((g) => g.name).join(", ")} suma(n) en GASTOS y además está el CMV.
                  Destildá esos grupos en "Grupos que computan" para medir la mercadería solo por CMV.
                </span>
              </div>
            )}


            {/*
              CMV Productos y la diferencia: INFORMATIVOS. No restan en la utilidad — el costo de
              mercadería ya lo pone el CMV por stock, y restar los dos contaría el costo dos veces.
              Acá el valor está en la comparación, no en el importe.
            */}
            {(cmvProductosBalance.rows.length > 0 || cmvProductosList.length > 0) && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    CMV Productos (teórico)
                    <Badge variant="outline" className="ml-2 text-[10px]">no resta</Badge>
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">
                    {cmvProductosBalance.rows.length > 0 ? formatCurrency(cmvProductosBalance.totalCmv) : "—"}
                  </span>
                </div>

                {cmvComparison.locals.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Diferencia CMV − CMV Productos
                      {cmvComparison.difPp != null && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {cmvComparison.difPp >= 0 ? "+" : ""}
                          {cmvComparison.difPp.toFixed(2)} pp
                        </Badge>
                      )}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-sm font-medium",
                        cmvComparison.difMonto > 0 ? "text-red-600" : cmvComparison.difMonto < 0 ? "text-green-600" : "",
                      )}
                    >
                      {formatCurrency(cmvComparison.difMonto)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* UTILIDAD */}
            <div className="mt-4 flex items-center justify-between border-t-2 pt-3">
              <span className="text-base font-bold tracking-wide">UTILIDAD ECONÓMICA</span>
              <div className="text-right">
                <span
                  className={cn(
                    "font-mono text-lg font-bold",
                    utilidadMes > 0 ? "text-green-600" : utilidadMes < 0 ? "text-red-600" : "",
                  )}
                >
                  {formatCurrency(utilidadMes)}
                </span>
                <p className="text-xs text-muted-foreground">{margenPct.toFixed(1)}% sobre ventas</p>
              </div>
            </div>

            {/* ---- Detalle del CMV: abajo de todo el análisis ---- */}
            <div className="mt-6 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold tracking-wide">CMV POR LOCAL</span>
                <span className="font-mono text-sm font-semibold">{formatCurrency(cmvMes)}</span>
              </div>
              {cmvBalance.rows.length > 0 ? (
                <div className="mt-2 divide-y">
                  {cmvBalance.rows.map((r) => (
                    <div key={r.localId} className="flex items-center justify-between py-1 text-sm">
                      <span className="text-muted-foreground">
                        {localName(r.localId)}{" "}
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          {r.pct.toFixed(2)}%
                        </Badge>
                      </span>
                      <span className="font-mono">{formatCurrency(r.cmvAmount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  No hay CMV cargado para {MONTH_NAMES_ES[month - 1]} {year} en los locales con ventas.
                </p>
              )}
              {cmvBalance.hasMissing && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Sin CMV de {MONTH_NAMES_ES[month - 1]} en{" "}
                    {cmvBalance.missing.map((m) => localName(m.localId)).join(", ")}:{" "}
                    {formatCurrency(cmvBalance.ventasSinCmv)} de ventas quedan sin costo de mercadería, así que la
                    utilidad de arriba está sobrestimada.
                  </span>
                </div>
              )}
            </div>

            {/* ---- CMV real vs CMV Productos, local por local ---- */}
            {(cmvProductosBalance.rows.length > 0 || cmvProductosBalance.hasMissing) && (
              <div className="mt-4 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold tracking-wide">CMV REAL vs CMV PRODUCTOS</span>
                  <span className="font-mono text-sm font-semibold">
                    {formatCurrency(cmvProductosBalance.totalCmv)}
                  </span>
                </div>

                {cmvComparison.locals.length > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="py-1 text-left font-medium">Local</th>
                          <th className="px-2 py-1 text-right font-medium">CMV real</th>
                          <th className="px-2 py-1 text-right font-medium">CMV Productos</th>
                          <th className="px-2 py-1 text-right font-medium">Dif. pp</th>
                          <th className="px-2 py-1 text-right font-medium">Dif. $</th>
                          <th className="px-2 py-1 text-right font-medium">Cobertura</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cmvComparison.locals.map((c) => (
                          <tr key={c.localId} className="border-b last:border-0">
                            <td className="py-1 text-muted-foreground">{localName(c.localId)}</td>
                            <td className="px-2 py-1 text-right font-mono">
                              {c.pctReal?.toFixed(2)}%
                              <span className="block text-[11px] text-muted-foreground">
                                {formatCurrency(c.montoReal)}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-right font-mono">
                              {c.pctTeorico?.toFixed(2)}%
                              <span className="block text-[11px] text-muted-foreground">
                                {formatCurrency(c.montoTeorico)}
                              </span>
                            </td>
                            <td
                              className={cn(
                                "px-2 py-1 text-right font-mono font-medium",
                                (c.difPp ?? 0) > 0 ? "text-red-600" : (c.difPp ?? 0) < 0 ? "text-green-600" : "",
                              )}
                            >
                              {c.difPp == null ? "—" : `${c.difPp >= 0 ? "+" : ""}${c.difPp.toFixed(2)}`}
                            </td>
                            <td
                              className={cn(
                                "px-2 py-1 text-right font-mono",
                                (c.difMonto ?? 0) > 0 ? "text-red-600" : (c.difMonto ?? 0) < 0 ? "text-green-600" : "",
                              )}
                            >
                              {c.difMonto == null ? "—" : formatCurrency(c.difMonto)}
                            </td>
                            <td className="px-2 py-1 text-right font-mono text-xs">
                              {c.coberturaPct == null ? (
                                "—"
                              ) : (
                                <span
                                  className={
                                    c.coberturaPct < CMV_PRODUCTOS_MIN_COVERAGE
                                      ? "text-amber-700 dark:text-amber-500"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {c.coberturaPct.toFixed(0)}%
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No hay ningún local con los DOS cálculos de {MONTH_NAMES_ES[month - 1]} {year}, así que no hay
                    diferencia que medir. Cruzar el CMV de un local contra el CMV Productos de otro daría un número
                    sin sentido.
                  </p>
                )}

                <p className="mt-2 text-xs text-muted-foreground">
                  La diferencia positiva es consumo que el costeo no explica: merma, desperdicio o faltante. El CMV
                  Productos no resta en la utilidad de arriba — el costo de mercadería ya lo pone el CMV por stock.
                </p>

                {/*
                  Cobertura baja = el CMV Productos está subvaluado por construcción y la diferencia
                  aparece inflada. Sin este aviso, un 51% de cobertura se lee como una merma enorme.
                */}
                {cmvComparison.hasLowCoverage && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Hay locales con menos del {CMV_PRODUCTOS_MIN_COVERAGE}% de las unidades con costo asignado. Su
                      CMV Productos está subvaluado y la diferencia sale más grande de lo que es. Completá los costos
                      en "CMV Productos" antes de leer este desvío.
                    </span>
                  </div>
                )}

                {(cmvComparison.soloReal.length > 0 || cmvComparison.soloTeorico.length > 0) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Fuera de la comparación:
                    {cmvComparison.soloReal.length > 0 && (
                      <> {cmvComparison.soloReal.map(localName).join(", ")} (sin CMV Productos).</>
                    )}
                    {cmvComparison.soloTeorico.length > 0 && (
                      <> {cmvComparison.soloTeorico.map(localName).join(", ")} (sin CMV por stock).</>
                    )}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* ---------- Vista Anual ---------- */
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-base font-semibold tracking-wide">EMPRESA — {year}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Concepto</th>
                  {SHORT_MONTHS.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-medium">
                      {m}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b font-semibold">
                  <td className="py-2">VENTAS ({sourcesLabel})</td>
                  {SHORT_MONTHS.map((_, i) => (
                    <td key={i} className="px-2 py-2 text-right font-mono text-green-600">
                      {formatCurrency(data?.ventas.monthly[i + 1] ?? 0)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-mono font-bold text-green-600">
                    {formatCurrency(data?.ventas.yearTotal ?? 0)}
                  </td>
                </tr>
                {computingGroups
                  .filter((g) => g.yearTotal !== 0)
                  .sort((a, b) => b.yearTotal - a.yearTotal)
                  .map((g) => (
                    <tr key={g.id} className="border-b">
                      <td className="py-1.5">{g.name}</td>
                      {SHORT_MONTHS.map((_, i) => (
                        <td key={i} className="px-2 py-1.5 text-right font-mono">
                          {formatCurrency(g.monthlyTotals[i + 1] ?? 0)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-mono font-medium">{formatCurrency(g.yearTotal)}</td>
                    </tr>
                  ))}
                <tr className="border-b font-semibold">
                  <td className="py-2">GASTOS</td>
                  {SHORT_MONTHS.map((_, i) => (
                    <td key={i} className="px-2 py-2 text-right font-mono text-red-600">
                      {formatCurrency(data?.summary.gastos[i + 1] ?? 0)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-mono font-bold text-red-600">
                    {formatCurrency(data?.summary.totalGastos ?? 0)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              La vista anual no incluye el CMV: se calcula mes a mes contra el CMV% cargado de cada local. Mirá la
              Vista Mensual para la utilidad económica del período.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
