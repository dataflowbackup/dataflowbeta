import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { toISODate } from "@/lib/dateHelpers";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Settings2,
  AlertTriangle,
} from "lucide-react";
import type { Local, CmvCalculation } from "@shared/schema";
import { pickCmvForMonth } from "@shared/cmvMonthMatch";
import { buildCmvForBalance } from "@shared/balanceCmv";

const fullMonths = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const shortMonths = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];

interface CategoryData {
  id: number;
  name: string;
  isSpecial?: boolean;
  specialType?: string | null;
  monthlyTotals: Record<number, number>;
  signedMonthlyTotals?: Record<number, number>;
  yearTotal: number;
}

interface GroupData {
  id: number;
  name: string;
  type: string;
  isSpecial?: boolean;
  /** Grupo de mercadería: en modo CMV no computa en la rentabilidad (lo reemplaza el CMV). */
  isMerchandise?: boolean;
  specialType?: string | null;
  categories: CategoryData[];
  monthlyTotals: Record<number, number>;
  signedMonthlyTotals?: Record<number, number>;
  // Punto 7: firmado y categorías SOLO especiales de este grupo (para Movimientos Financieros).
  specialSignedMonthlyTotals?: Record<number, number>;
  specialCategories?: CategoryData[];
  yearTotal: number;
}

interface SpreadsheetData {
  groups: GroupData[];
  summary: {
    income: Record<number, number>;
    expenses: Record<number, number>;
    net: Record<number, number>;
    /** Otros Movimientos por mes (no afectan el neto). Signo informativo. */
    otrosMovimientos?: Record<number, number>;
    /** Punto 6: Traslados de Mercadería por mes (recibidos − enviados). Solo resta en el neto de caja. */
    traslados?: Record<number, number>;
    /** Ventas por local y mes: base para pasar el CMV% de cada local a pesos. */
    incomeByLocal?: Record<number, Record<number, number>>;
    totalIncome: number;
    totalExpenses: number;
    totalNet: number;
    totalOtrosMovimientos?: number;
    totalTraslados?: number;
  };
}

export default function BalancePage() {
  const { toast } = useToast();
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [selectedMonth, setSelectedMonth] = useState(currentMonth.toString());
  // Punto 19: selección libre de uno o varios locales. [] = todos.
  const [selectedLocalIds, setSelectedLocalIds] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<string>("monthly");
  /**
   * Criterio con el que se mide la rentabilidad:
   *  - "pagado": lo que efectivamente se pagó en el mes (como siempre).
   *  - "cmv": devengado. Los grupos de mercadería dejan de computar y su lugar lo toma el CMV
   *    calculado, así no pagarle a un proveedor deja de inflar la utilidad.
   * Arranca siempre en "pagado": nadie abre el balance y ve otros números sin haberlo pedido.
   */
  const [profitMode, setProfitMode] = useState<"pagado" | "cmv">("pagado");
  const [expandedExpenseGroupIds, setExpandedExpenseGroupIds] = useState<number[]>([]);
  const [expandedVentaGroupIds, setExpandedVentaGroupIds] = useState<number[]>([]);
  const [expandedMovFinGroupIds, setExpandedMovFinGroupIds] = useState<number[]>([]);

  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const localIdsParam = selectedLocalIds.length > 0 ? selectedLocalIds.join(",") : "";
  const spreadsheetUrl = localIdsParam
    ? `/api/balance-spreadsheet?year=${selectedYear}&localIds=${localIdsParam}`
    : `/api/balance-spreadsheet?year=${selectedYear}`;

  const { data: spreadsheet, isLoading } = useQuery<SpreadsheetData>({
    queryKey: ["/api/balance-spreadsheet", selectedYear, localIdsParam],
    queryFn: async () => {
      const res = await fetch(spreadsheetUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar datos");
      return res.json();
    },
  });

  // Punto 12: CMV guardados, para asentar uno en el balance cuando coincide mes completo + local.
  const { data: cmvList = [] } = useQuery<CmvCalculation[]>({
    queryKey: ["/api/finance/cmv-calculations"],
    queryFn: async () => {
      const res = await fetch("/api/finance/cmv-calculations", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const yearComboOptions = useMemo(
    () => years.map((y) => ({ value: String(y), label: String(y) })),
    [years],
  );

  const monthComboOptions = useMemo(
    () => fullMonths.map((m, i) => ({ value: String(i + 1), label: m })),
    [],
  );

  const balanceLocalComboOptions = useMemo(
    () => [
      { value: "all", label: "Todos los locales" },
      ...locals.map((l) => ({ value: String(l.id), label: l.name })),
    ],
    [locals],
  );

  const month = parseInt(selectedMonth);
  const year = parseInt(selectedYear, 10);
  const cmvMode = profitMode === "cmv";

  const monthlyVentas = spreadsheet?.summary.income[month] ?? 0;
  const monthlyGastosOperativos = spreadsheet?.summary.expenses[month] ?? 0;
  // Traslados de Mercadería del mes (recibidos − enviados).
  const monthlyTraslados = spreadsheet?.summary.traslados?.[month] ?? 0;
  const monthlyOtrosMov = spreadsheet?.summary.otrosMovimientos?.[month] ?? 0;
  const trasladosPercent = monthlyVentas > 0 ? (monthlyTraslados / monthlyVentas) * 100 : 0;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevVentas = spreadsheet?.summary.income[prevMonth] ?? 0;
  const evolucionVentas = prevVentas > 0 ? ((monthlyVentas - prevVentas) / prevVentas) * 100 : 0;

  const expenseGroups = useMemo(() => {
    if (!spreadsheet) return [];
    // Excluir grupos especiales (Otros Movimientos): no son gastos operativos.
    return spreadsheet.groups.filter(g => g.type === "expense" && !g.isSpecial);
  }, [spreadsheet]);

  // Otros Movimientos: Inicio de mes, Retiros, Préstamos, Otros Ingresos, Transferencias.
  // Quedan asentados y se muestran abajo, pero NO afectan la utilidad.
  // Punto 7: incluir TODO grupo que tenga categorías especiales (aunque sea mixto), no solo los
  // 100% especiales. Así el movimiento que antes sumaba al Total pero no se mostraba, ahora es fila.
  const otrosMovGroups = useMemo(() => {
    if (!spreadsheet) return [];
    return spreadsheet.groups.filter(g => (g.specialCategories?.length ?? 0) > 0 || g.isSpecial);
  }, [spreadsheet]);

  // Punto 4: grupos de Ventas (ingresos no especiales) para desglosar.
  const ventaGroups = useMemo(() => {
    if (!spreadsheet) return [];
    return spreadsheet.groups.filter(g => g.type === "income" && !g.isSpecial);
  }, [spreadsheet]);

  // Punto 12: CMV a asentar en el balance (mes elegido + un único local).
  const cmvMatch = useMemo(() => {
    if (selectedLocalIds.length !== 1) return { matched: null, nearby: [] as CmvCalculation[] };
    return pickCmvForMonth(cmvList, selectedLocalIds[0], parseInt(selectedYear, 10), parseInt(selectedMonth, 10));
  }, [cmvList, selectedLocalIds, selectedYear, selectedMonth]);

  const matchedCmv = cmvMatch.matched;

  // Grupos marcados como mercadería: en modo CMV dejan de computar en la rentabilidad.
  const merchandiseGroupIds = useMemo(
    () => new Set(expenseGroups.filter((g) => g.isMerchandise).map((g) => g.id)),
    [expenseGroups],
  );

  const ventasByLocal = spreadsheet?.summary.incomeByLocal ?? {};

  /**
   * Locales que entran al análisis: los elegidos (o todos si no hay filtro), pero solo los que
   * facturaron en el mes. Un local sin ventas no tiene rentabilidad que medir, así que tampoco
   * tiene sentido reclamarle un CMV.
   */
  const analyzedLocalIds = useMemo(() => {
    const base = selectedLocalIds.length > 0 ? selectedLocalIds : locals.map((l) => l.id);
    return base.filter((id) => Math.abs(ventasByLocal[id]?.[month] ?? 0) > 0.005);
  }, [selectedLocalIds, locals, ventasByLocal, month]);

  /**
   * CMV por local del mes, ya pasado a pesos contra la facturación del balance de cada local.
   * Los locales sin CMV NO se completan con lo pagado: quedan en `missing` y se avisan, porque
   * taparlos con otro criterio da una rentabilidad falsa.
   */
  const cmvBalance = useMemo(() => {
    const ventasMes: Record<number, number> = {};
    for (const id of analyzedLocalIds) ventasMes[id] = ventasByLocal[id]?.[month] ?? 0;
    return buildCmvForBalance(cmvList, analyzedLocalIds, year, month, ventasMes);
  }, [cmvList, analyzedLocalIds, ventasByLocal, year, month]);

  const localName = (id: number) => locals.find((l) => l.id === id)?.name ?? `Local #${id}`;

  /**
   * Ventas sin local asignado (clave 0). Entran a la facturación del balance pero ningún CMV las
   * puede respaldar, así que en modo CMV son otro agujero que infla la rentabilidad. Solo aplica
   * cuando se miran todos los locales: con filtro puesto, esas ventas ya quedaron afuera.
   */
  const ventasSinLocal = selectedLocalIds.length === 0 ? (ventasByLocal[0]?.[month] ?? 0) : 0;

  /** Importe del mes de un grupo: la suma de sus categorías, o su total si no tiene detalle. */
  const groupAmountOf = (group: GroupData) =>
    group.categories.length > 0
      ? group.categories.reduce((sum, cat) => sum + (cat.monthlyTotals[month] ?? 0), 0)
      : (group.monthlyTotals[month] ?? 0);

  // Mercadería efectivamente PAGADA en el mes (los grupos marcados). Sigue a la vista y sigue
  // computando en la caja; en modo CMV es lo único que deja de incidir en la rentabilidad.
  const merchandisePagado = useMemo(
    () => expenseGroups.filter((g) => merchandiseGroupIds.has(g.id)).reduce((s, g) => s + groupAmountOf(g), 0),
    [expenseGroups, merchandiseGroupIds, month],
  );
  const merchandisePagadoPct = monthlyVentas > 0 ? (merchandisePagado / monthlyVentas) * 100 : 0;
  const cmvAmount = cmvBalance.totalCmv;
  const cmvPercent = monthlyVentas > 0 ? (cmvAmount / monthlyVentas) * 100 : 0;
  const cmvVsPagado = cmvAmount - merchandisePagado;

  /**
   * Gastos que computan en la rentabilidad.
   *  - Pagado: gastos operativos + traslados (decisión jul-27).
   *  - CMV: gastos operativos − mercadería pagada + CMV. Los traslados salen porque el CMV ya los
   *    absorbe (`computeCmv` suma los recibidos y resta los enviados dentro de `compras`);
   *    dejarlos sería contarlos dos veces.
   */
  const monthlyGastos = cmvMode
    ? monthlyGastosOperativos - merchandisePagado + cmvAmount
    : monthlyGastosOperativos + monthlyTraslados;
  const monthlyUtilidad = monthlyVentas - monthlyGastos;

  /**
   * Caja del período: SIEMPRE sobre lo pagado, sin importar el modo. El CMV mide rentabilidad, no
   * plata que se movió. Ventas − Gastos pagados (todos, mercadería incluida) + Movimientos
   * Financieros. En modo CMV los traslados tampoco entran acá: nunca fueron plata.
   */
  const gastosPagados = cmvMode ? monthlyGastosOperativos : monthlyGastosOperativos + monthlyTraslados;
  const cajaNeta = monthlyVentas - gastosPagados + monthlyOtrosMov;

  const totalGastosPercent = monthlyVentas > 0 ? (monthlyGastos / monthlyVentas) * 100 : 0;
  const utilidadPercent = monthlyVentas > 0 ? (monthlyUtilidad / monthlyVentas) * 100 : 0;

  /**
   * Vista anual mes a mes con el mismo criterio que la mensual. En "pagado" reproduce exactamente
   * los números de siempre; en "cmv" reemplaza la mercadería pagada de cada mes por el CMV de ese
   * mes y marca los meses donde falta el CMV de algún local.
   */
  const annualRows = useMemo(() => {
    const merchandiseGroups = expenseGroups.filter((g) => merchandiseGroupIds.has(g.id));
    const baseLocalIds = selectedLocalIds.length > 0 ? selectedLocalIds : locals.map((l) => l.id);

    return Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
      const ventas = spreadsheet?.summary.income[m] ?? 0;
      const gastosOperativos = spreadsheet?.summary.expenses[m] ?? 0;
      let gastos = gastosOperativos;
      let missingCmv: string[] = [];

      if (cmvMode) {
        const merchPagado = merchandiseGroups.reduce((s, g) => s + (g.monthlyTotals[m] ?? 0), 0);
        const ids = baseLocalIds.filter((id) => Math.abs(ventasByLocal[id]?.[m] ?? 0) > 0.005);
        const ventasMes: Record<number, number> = {};
        for (const id of ids) ventasMes[id] = ventasByLocal[id]?.[m] ?? 0;
        const res = buildCmvForBalance(cmvList, ids, year, m, ventasMes);
        gastos = gastosOperativos - merchPagado + res.totalCmv;
        missingCmv = res.missing.map((x) => localName(x.localId));
      }

      const utilidad = ventas - gastos;
      return {
        month: m,
        ventas,
        gastos,
        utilidad,
        margen: ventas > 0 ? (utilidad / ventas) * 100 : 0,
        hasData: ventas !== 0 || gastos !== 0,
        missingCmv,
      };
    });
  }, [spreadsheet, cmvMode, expenseGroups, merchandiseGroupIds, selectedLocalIds, locals, ventasByLocal, cmvList, year]);

  const annualTotals = useMemo(() => {
    const ventas = annualRows.reduce((s, r) => s + r.ventas, 0);
    const gastos = annualRows.reduce((s, r) => s + r.gastos, 0);
    return { ventas, gastos, utilidad: ventas - gastos, margen: ventas > 0 ? ((ventas - gastos) / ventas) * 100 : 0 };
  }, [annualRows]);

  // Guarda el grupo como (o deja de ser) mercadería. Es configuración del cliente: se hace una vez.
  const merchandiseMutation = useMutation({
    mutationFn: async ({ id, isMerchandise }: { id: number; isMerchandise: boolean }) => {
      const res = await apiRequest("PATCH", `/api/financial-groups/${id}`, { isMerchandise });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/balance-spreadsheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/financial-groups"] });
    },
    onError: (e: any) => {
      toast({ title: "No se pudo guardar", description: e?.message ?? "Error", variant: "destructive" });
    },
  });

  // Líneas agrupadas (grupo → categorías) reutilizables por el render y por la exportación.
  const buildGroupedLines = (groups: GroupData[]) =>
    groups.map((group) => {
      const categories = group.categories.map((cat) => {
        const amount = cat.monthlyTotals[month] ?? 0;
        const percent = monthlyVentas > 0 ? (amount / monthlyVentas) * 100 : 0;
        return { name: cat.name, amount, percent };
      });
      const groupAmount = groupAmountOf(group);
      const groupPercent = monthlyVentas > 0 ? (groupAmount / monthlyVentas) * 100 : 0;
      return {
        groupId: group.id,
        groupName: group.name,
        groupAmount,
        groupPercent,
        categories,
        // En modo CMV este grupo no computa: se sigue viendo, atenuado, como "pagado".
        replacedByCmv: cmvMode && merchandiseGroupIds.has(group.id),
      };
    });

  const groupedExpenseLines = useMemo(
    () => buildGroupedLines(expenseGroups),
    [expenseGroups, month, monthlyVentas, cmvMode, merchandiseGroupIds],
  );
  const groupedVentaLines = useMemo(() => buildGroupedLines(ventaGroups), [ventaGroups, month, monthlyVentas]);

  const localsLabel = selectedLocalIds.length === 0
    ? "Todos los locales"
    : selectedLocalIds.map((id) => locals.find((l) => l.id === id)?.name ?? `#${id}`).join(", ");

  const num = (n: number) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  /**
   * Filas del reporte (para PDF y Excel), reflejando la pantalla + el CMV asentado (punto 12).
   * `expenseDetail` desglosa cada grupo de gasto en sus categorías: el Excel lo quiere (es para
   * analizar), el PDF no (es un resumen y con el desglose se hacía larguísimo). Los importes de
   * grupo salen de buildGroupedLines, así que omitir el detalle no cambia ningún total.
   */
  const buildReportRows = ({ expenseDetail = true }: { expenseDetail?: boolean } = {}) => {
    const rows: Array<{ label: string; value: string; indent?: boolean; bold?: boolean }> = [];
    rows.push({ label: "Local(es)", value: localsLabel, bold: true });
    rows.push({ label: "Período", value: `${fullMonths[month - 1]} ${selectedYear}`, bold: true });
    rows.push({
      label: "Criterio de rentabilidad",
      value: cmvMode ? "CMV (mercadería devengada)" : "Pagado",
      bold: true,
    });
    if (cmvMode && cmvBalance.hasMissing) {
      rows.push({
        label: "ATENCIÓN: falta el CMV de",
        value: cmvBalance.missing.map((m) => localName(m.localId)).join(", "),
        bold: true,
      });
    }
    rows.push({ label: "Ventas", value: formatCurrency(monthlyVentas), bold: true });
    for (const g of groupedVentaLines) {
      rows.push({ label: g.groupName, value: formatCurrency(g.groupAmount), indent: true });
    }
    rows.push({ label: "GASTOS", value: "" , bold: true });
    for (const g of groupedExpenseLines) {
      rows.push({
        label: g.replacedByCmv ? `${g.groupName} (no computa)` : g.groupName,
        value: formatCurrency(g.groupAmount),
        indent: true,
        bold: true,
      });
      if (expenseDetail) {
        for (const c of g.categories) rows.push({ label: `   ${c.name}`, value: formatCurrency(c.amount), indent: true });
      }
    }
    if (cmvMode) {
      rows.push({ label: "Costo de Mercadería (CMV)", value: formatCurrency(cmvAmount), indent: true, bold: true });
    } else {
      rows.push({ label: "Traslados de Mercadería (incluido en Gastos Totales)", value: formatCurrency(monthlyTraslados), indent: true });
    }
    rows.push({ label: "Gastos Totales", value: formatCurrency(monthlyGastos), bold: true });
    rows.push({ label: "Utilidad", value: formatCurrency(monthlyUtilidad), bold: true });
    rows.push({ label: "Utilidad %", value: `${utilidadPercent.toFixed(2)}%`, bold: true });
    if (cmvMode) {
      rows.push({ label: "MERCADERÍA PAGADA (no computa en la utilidad)", value: "", bold: true });
      rows.push({ label: "Total pagado en el período", value: formatCurrency(merchandisePagado), indent: true });
      rows.push({ label: "Costo real consumido (CMV)", value: formatCurrency(cmvAmount), indent: true });
      rows.push({ label: "Diferencia (deuda generada / cancelada)", value: formatCurrency(cmvVsPagado), indent: true, bold: true });
      for (const r of cmvBalance.rows) {
        rows.push({
          label: `   ${localName(r.localId)} · ${r.pct.toFixed(2)}%`,
          value: formatCurrency(r.cmvAmount),
          indent: true,
        });
      }
    }
    if (otrosMovGroups.length > 0) {
      rows.push({ label: "MOVIMIENTOS FINANCIEROS (no afectan rentabilidad)", value: "", bold: true });
      for (const g of otrosMovGroups) {
        const signed = g.specialSignedMonthlyTotals?.[month]
          ?? g.signedMonthlyTotals?.[month] ?? g.monthlyTotals[month] ?? 0;
        rows.push({ label: g.name, value: formatCurrency(signed), indent: true });
      }
      rows.push({ label: "Total Movimientos Financieros", value: formatCurrency(monthlyOtrosMov), bold: true });
    }
    rows.push({ label: "MOVIMIENTO NETO DEL PERÍODO (caja, siempre sobre lo pagado)", value: "", bold: true });
    rows.push({ label: "Ventas", value: formatCurrency(monthlyVentas), indent: true });
    rows.push({ label: `− Gastos pagados${cmvMode ? " (mercadería incluida)" : ""}`, value: formatCurrency(gastosPagados), indent: true });
    rows.push({ label: "+ Movimientos Financieros", value: formatCurrency(monthlyOtrosMov), indent: true });
    rows.push({ label: "Movimiento neto", value: formatCurrency(cajaNeta), bold: true });
    if (matchedCmv) {
      rows.push({ label: "CMV DEL PERÍODO (dato asentado)", value: "", bold: true });
      rows.push({ label: "Stock inicial", value: formatCurrency(parseFloat(String(matchedCmv.stockInicial)) || 0), indent: true });
      rows.push({ label: "+ Compras", value: formatCurrency(parseFloat(String(matchedCmv.compras)) || 0), indent: true });
      rows.push({ label: "− Stock final", value: formatCurrency(parseFloat(String(matchedCmv.stockFinal)) || 0), indent: true });
      rows.push({ label: "CMV", value: formatCurrency(parseFloat(String(matchedCmv.cmv)) || 0), bold: true, indent: true });
      rows.push({ label: "Venta base CMV", value: formatCurrency(parseFloat(String(matchedCmv.ventaNeta)) || 0), indent: true });
      rows.push({ label: "CMV %", value: `${(parseFloat(String(matchedCmv.cmvPct)) || 0).toFixed(2)}%`, bold: true, indent: true });
    }
    return rows;
  };

  const exportExcel = () => {
    if (!spreadsheet) return;
    const rows = buildReportRows().map((r) => ({ Concepto: (r.indent ? "  " : "") + r.label, Valor: r.value }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 48 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Balance");
    XLSX.writeFile(wb, `balance_${selectedYear}_${String(selectedMonth).padStart(2, "0")}.xlsx`);
  };

  /**
   * Filas para el PDF cuadriculado (puntos 3 y 11, jul-27): tabla con grilla y 3 columnas
   * Concepto | Importe | % (sobre ventas), a nivel grupos de gasto/venta y totales — sin
   * desglose por categoría. `section` = encabezado de bloque (fila sombreada a todo el ancho).
   */
  const buildPdfRows = () => {
    type PdfRow = { label: string; importe?: string; pct?: string; bold?: boolean; section?: boolean; indent?: boolean };
    const rows: PdfRow[] = [];
    const pct = (n: number) => `${n.toFixed(2)}%`;

    if (cmvMode && cmvBalance.hasMissing) {
      rows.push({
        label: `ATENCIÓN: sin CMV de ${cmvBalance.missing.map((m) => localName(m.localId)).join(", ")} — la utilidad está inflada`,
        section: true,
        bold: true,
      });
    }
    rows.push({ label: "Ventas", importe: formatCurrency(monthlyVentas), pct: pct(100), bold: true });
    for (const g of groupedVentaLines) {
      rows.push({ label: g.groupName, importe: formatCurrency(g.groupAmount), pct: pct(g.groupPercent), indent: true });
    }
    rows.push({ label: "GASTOS", section: true, bold: true });
    for (const g of groupedExpenseLines) {
      rows.push({
        label: g.replacedByCmv ? `${g.groupName} (no computa)` : g.groupName,
        importe: formatCurrency(g.groupAmount),
        pct: pct(g.groupPercent),
        indent: true,
        bold: true,
      });
    }
    if (cmvMode) {
      rows.push({ label: "Costo de Mercadería (CMV)", importe: formatCurrency(cmvAmount), pct: pct(cmvPercent), indent: true, bold: true });
    } else {
      rows.push({ label: "Traslados de Mercadería", importe: formatCurrency(monthlyTraslados), pct: pct(trasladosPercent), indent: true });
    }
    rows.push({ label: "Gastos Totales", importe: formatCurrency(monthlyGastos), pct: pct(totalGastosPercent), bold: true });
    rows.push({ label: "Utilidad", importe: formatCurrency(monthlyUtilidad), pct: pct(utilidadPercent), bold: true });

    if (cmvMode) {
      rows.push({ label: "MERCADERÍA PAGADA (no computa en la utilidad)", section: true, bold: true });
      rows.push({ label: "Total pagado en el período", importe: formatCurrency(merchandisePagado), pct: pct(merchandisePagadoPct), indent: true });
      rows.push({ label: "Costo real consumido (CMV)", importe: formatCurrency(cmvAmount), pct: pct(cmvPercent), indent: true });
      rows.push({
        label: "Diferencia (deuda generada / cancelada)",
        importe: formatCurrency(cmvVsPagado),
        pct: `${(cmvPercent - merchandisePagadoPct).toFixed(2)} pts`,
        indent: true,
        bold: true,
      });
      for (const r of cmvBalance.rows) {
        rows.push({
          label: localName(r.localId),
          importe: formatCurrency(r.cmvAmount),
          pct: pct(r.pct),
          indent: true,
        });
      }
    }

    if (otrosMovGroups.length > 0) {
      rows.push({ label: "MOVIMIENTOS FINANCIEROS (no afectan rentabilidad)", section: true, bold: true });
      for (const g of otrosMovGroups) {
        const signed = g.specialSignedMonthlyTotals?.[month]
          ?? g.signedMonthlyTotals?.[month] ?? g.monthlyTotals[month] ?? 0;
        rows.push({ label: g.name, importe: formatCurrency(signed), indent: true });
      }
      rows.push({ label: "Total Movimientos Financieros", importe: formatCurrency(monthlyOtrosMov), bold: true });
    }

    rows.push({ label: "MOVIMIENTO NETO DEL PERÍODO (caja, siempre sobre lo pagado)", section: true, bold: true });
    rows.push({ label: "Ventas", importe: formatCurrency(monthlyVentas), indent: true });
    rows.push({ label: `− Gastos pagados${cmvMode ? " (mercadería incluida)" : ""}`, importe: formatCurrency(gastosPagados), indent: true });
    rows.push({ label: "+ Movimientos Financieros", importe: formatCurrency(monthlyOtrosMov), indent: true });
    rows.push({ label: "Movimiento neto", importe: formatCurrency(cajaNeta), bold: true });

    if (matchedCmv) {
      rows.push({ label: "CMV DEL PERÍODO (dato asentado)", section: true, bold: true });
      rows.push({ label: "Stock inicial", importe: formatCurrency(parseFloat(String(matchedCmv.stockInicial)) || 0), indent: true });
      rows.push({ label: "+ Compras", importe: formatCurrency(parseFloat(String(matchedCmv.compras)) || 0), indent: true });
      rows.push({ label: "− Stock final", importe: formatCurrency(parseFloat(String(matchedCmv.stockFinal)) || 0), indent: true });
      rows.push({ label: "CMV", importe: formatCurrency(parseFloat(String(matchedCmv.cmv)) || 0), indent: true, bold: true });
      rows.push({ label: "Venta base CMV", importe: formatCurrency(parseFloat(String(matchedCmv.ventaNeta)) || 0), indent: true });
      rows.push({ label: "CMV %", pct: pct(parseFloat(String(matchedCmv.cmvPct)) || 0), indent: true, bold: true });
    }
    return rows;
  };

  const exportPdf = () => {
    if (!spreadsheet) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 40;
    const tableLeft = marginX;
    const tableRight = 555;
    // Columnas: Concepto [40..380] | Importe [380..470] | % [470..555].
    const xConcepto = marginX;
    const divConceptoImporte = 380;
    const divImportePct = 470;
    const xImporteR = divImportePct - 6;  // texto Importe alineado a la derecha dentro de su columna
    const xPctR = tableRight - 4;          // texto % alineado a la derecha
    const rowH = 18;
    const pageBottom = 800;

    let y = 50;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Balance Financiero", marginX, y);
    doc.text(`${fullMonths[month - 1]} ${selectedYear}`, tableRight, y, { align: "right" });
    y += 18;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(localsLabel, marginX, y);
    doc.text(
      cmvMode ? "Rentabilidad: CMV (mercadería devengada)" : "Rentabilidad: Pagado",
      tableRight,
      y,
      { align: "right" },
    );
    y += 18;

    // Encabezado de la tabla (repetible por página).
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
      doc.text("%", xPctR, y + 12, { align: "right" });
      doc.setTextColor(0, 0, 0);
      y += rowH;
    };

    drawTableHeader();
    doc.setFontSize(9);

    for (const r of buildPdfRows()) {
      if (y + rowH > pageBottom) { doc.addPage(); y = 50; drawTableHeader(); }
      // Fondo: encabezados de bloque en gris medio, filas bold en gris claro.
      if (r.section) doc.setFillColor(225, 225, 225);
      else if (r.bold) doc.setFillColor(243, 243, 243);
      else doc.setFillColor(255, 255, 255);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.rect(tableLeft, y, tableRight - tableLeft, rowH, "FD");
      // Divisorias de columnas (solo en filas de datos, no en las secciones a todo el ancho).
      if (!r.section) {
        doc.line(divConceptoImporte, y, divConceptoImporte, y + rowH);
        doc.line(divImportePct, y, divImportePct, y + rowH);
      }
      doc.setFont("helvetica", r.bold ? "bold" : "normal");
      doc.text((r.indent ? "   " : "") + r.label, xConcepto + 4, y + 12);
      if (r.importe) doc.text(r.importe, xImporteR, y + 12, { align: "right" });
      if (r.pct) doc.text(r.pct, xPctR, y + 12, { align: "right" });
      y += rowH;
    }
    doc.save(`balance_${selectedYear}_${String(selectedMonth).padStart(2, "0")}.pdf`);
  };

  const renderMonthlyView = () => {
    if (isLoading) {
      return (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }

    if (!spreadsheet) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos para mostrar. Importa extractos bancarios y categoriza los movimientos.
          </CardContent>
        </Card>
      );
    }

    return (
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-5">
            {cmvMode && merchandiseGroupIds.size === 0 && (
              <div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="alert-sin-grupos-mercaderia">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  No hay ningún grupo marcado como mercadería, así que el CMV se suma a los gastos sin reemplazar
                  nada. Elegí los grupos con <strong>Mercadería</strong>, arriba.
                </span>
              </div>
            )}

            {/* Un local sin CMV no se completa con lo pagado: sus ventas quedan en el total sin
                costo de mercadería que las respalde, y eso infla la rentabilidad. Se avisa fuerte. */}
            {cmvMode && Math.abs(ventasSinLocal) > 0.005 && (
              <div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="alert-ventas-sin-local">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <span>
                  Hay {formatCurrency(ventasSinLocal)} de ventas sin local asignado. Ningún CMV las puede
                  respaldar, así que esa parte queda sin costo de mercadería. Asignales local para que entren
                  al cálculo.
                </span>
              </div>
            )}

            {cmvMode && cmvBalance.hasMissing && (
              <div className="flex gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm" data-testid="alert-cmv-faltante">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">
                    Rentabilidad no confiable: falta el CMV de {cmvBalance.missing.length === 1 ? "un local" : `${cmvBalance.missing.length} locales`}.
                  </p>
                  <p>
                    {cmvBalance.missing.map((m) => localName(m.localId)).join(", ")} — sus ventas
                    ({formatCurrency(cmvBalance.ventasSinCmv)}, {monthlyVentas > 0 ? ((cmvBalance.ventasSinCmv / monthlyVentas) * 100).toFixed(1) : "0"}% del total)
                    entran al balance sin costo de mercadería, así que la utilidad de arriba está inflada.
                    Calculá y guardá el CMV de {fullMonths[month - 1]} {selectedYear} de {cmvBalance.missing.length === 1 ? "ese local" : "esos locales"} para que el número cierre.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <span className="font-semibold uppercase tracking-wide">Empresa</span>
              <span className="font-mono text-right font-semibold">{fullMonths[month - 1]} {selectedYear}</span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
              <span className="font-medium">Evolucion de Ventas</span>
              <span className="font-mono text-right">
                {prevVentas > 0 ? `${evolucionVentas >= 0 ? "+" : ""}${evolucionVentas.toFixed(2)}%` : "N/A"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-b pb-3">
              <span className="font-bold uppercase">Ventas</span>
              <span className="font-mono text-right font-bold text-green-600" data-testid="text-ventas">
                {formatCurrency(monthlyVentas)}
              </span>
            </div>

            {/* Punto 4: desglose de Ventas por grupo → categoría */}
            {groupedVentaLines.length > 0 && (
              <div className="space-y-1">
                {groupedVentaLines.map((group, idx) => (
                  <div key={`venta-${group.groupId}-${idx}`} className="space-y-1">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-left"
                        onClick={() =>
                          setExpandedVentaGroupIds((prev) =>
                            prev.includes(group.groupId)
                              ? prev.filter((id) => id !== group.groupId)
                              : [...prev, group.groupId],
                          )
                        }
                      >
                        {expandedVentaGroupIds.includes(group.groupId) ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-muted-foreground">{group.groupName}</span>
                      </button>
                      <span className="font-mono text-right text-muted-foreground">{formatCurrency(group.groupAmount)}</span>
                    </div>
                    {expandedVentaGroupIds.includes(group.groupId) &&
                      group.categories.map((cat, catIdx) => (
                        <div key={`venta-${group.groupId}-${cat.name}-${catIdx}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                          <span className="pl-6 text-muted-foreground">{cat.name}</span>
                          <span className="font-mono text-right text-muted-foreground">{formatCurrency(cat.amount)}</span>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <span className="font-bold uppercase">Gastos</span>
              <span />
            </div>

            <div className="space-y-2">
              {groupedExpenseLines.map((group, idx) => (
                <div key={`${group.groupName}-${idx}`} className="space-y-1">
                  <div className={`grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold ${group.replacedByCmv ? "text-muted-foreground" : ""}`}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-left"
                      onClick={() =>
                        setExpandedExpenseGroupIds((prev) =>
                          prev.includes(group.groupId)
                            ? prev.filter((id) => id !== group.groupId)
                            : [...prev, group.groupId],
                        )
                      }
                    >
                      {expandedExpenseGroupIds.includes(group.groupId) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={group.replacedByCmv ? "line-through decoration-1" : ""}>{group.groupName}</span>
                      {group.replacedByCmv && (
                        <Badge variant="outline" className="ml-1 text-[10px] font-normal">no computa</Badge>
                      )}
                    </button>
                    <span className={`font-mono text-right ${group.replacedByCmv ? "line-through decoration-1" : ""}`}>
                      {formatCurrency(group.groupAmount)}
                    </span>
                  </div>
                  {expandedExpenseGroupIds.includes(group.groupId) &&
                    group.categories.map((cat, catIdx) => (
                      <div key={`${group.groupName}-${cat.name}-${catIdx}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                        <span className="pl-6 text-muted-foreground">{cat.name}</span>
                        <span className="font-mono text-right text-muted-foreground">{formatCurrency(cat.amount)}</span>
                      </div>
                    ))}
                </div>
              ))}
              {cmvMode ? (
                /* El costo de mercadería devengado toma el lugar de los grupos reemplazados. */
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold border-t pt-2">
                  <span className="inline-flex items-center gap-2">
                    Costo de Mercadería (CMV)
                    <Badge className="text-[10px] font-normal">computa</Badge>
                  </span>
                  <span className="font-mono text-right" data-testid="text-cmv-computado">{formatCurrency(cmvAmount)}</span>
                </div>
              ) : (
                /* Punto 7 (jul-27): Traslados de Mercadería — integran Gastos Totales y afectan la utilidad.
                   En modo CMV no se muestran: ya están adentro del CMV. */
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold border-t pt-2">
                  <span className="inline-flex items-center gap-2">
                    Traslados de Mercadería
                    <span className="text-[10px] font-normal text-muted-foreground">(incluido en Gastos Totales)</span>
                  </span>
                  <span className="font-mono text-right" data-testid="text-traslados-mercaderia">{formatCurrency(monthlyTraslados)}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-3">
              <span className="font-bold uppercase">Gastos Totales</span>
              <span className="font-mono text-right font-bold text-red-600" data-testid="text-gastos-totales">
                {formatCurrency(monthlyGastos)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-3">
              <span className="font-bold">Utilidad</span>
              <span className={`font-mono text-right font-bold ${monthlyUtilidad >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-utilidad">
                {formatCurrency(monthlyUtilidad)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-4">
              <span className="font-bold uppercase">Gastos / UT en %</span>
              <span />
            </div>

            <div className="space-y-2">
              {groupedExpenseLines.map((group, idx) => (
                <div key={`pct-${group.groupName}-${idx}`} className="space-y-1">
                  <div className={`grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold ${group.replacedByCmv ? "text-muted-foreground" : ""}`}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-left"
                      onClick={() =>
                        setExpandedExpenseGroupIds((prev) =>
                          prev.includes(group.groupId)
                            ? prev.filter((id) => id !== group.groupId)
                            : [...prev, group.groupId],
                        )
                      }
                    >
                      {expandedExpenseGroupIds.includes(group.groupId) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className={group.replacedByCmv ? "line-through decoration-1" : ""}>{group.groupName}</span>
                      {group.replacedByCmv && (
                        <Badge variant="outline" className="ml-1 text-[10px] font-normal">no computa</Badge>
                      )}
                    </button>
                    <span className={`font-mono text-right ${group.replacedByCmv ? "line-through decoration-1" : ""}`}>
                      {group.groupPercent.toFixed(2)}%
                    </span>
                  </div>
                  {expandedExpenseGroupIds.includes(group.groupId) &&
                    group.categories.map((cat, catIdx) => (
                      <div key={`pct-${group.groupName}-${cat.name}-${catIdx}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                        <span className="pl-6 text-muted-foreground">{cat.name}</span>
                        <span className="font-mono text-right text-muted-foreground">{cat.percent.toFixed(2)}%</span>
                      </div>
                    ))}
                </div>
              ))}
              {cmvMode ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold border-t pt-2">
                  <span className="inline-flex items-center gap-2">
                    Costo de Mercadería (CMV)
                    <Badge className="text-[10px] font-normal">computa</Badge>
                  </span>
                  <span className="font-mono text-right" data-testid="text-cmv-percent">{cmvPercent.toFixed(2)}%</span>
                </div>
              ) : (
                /* Punto 7 (jul-27): Traslados de Mercadería en % (sobre ventas), ya dentro de Gastos Totales. */
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold border-t pt-2">
                  <span className="inline-flex items-center gap-2">
                    Traslados de Mercadería
                    <span className="text-[10px] font-normal text-muted-foreground">(incluido en Gastos Totales)</span>
                  </span>
                  <span className="font-mono text-right">{trasladosPercent.toFixed(2)}%</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-3">
              <span className="font-bold uppercase">Total</span>
              <span />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
              <span className="font-bold">Utilidad</span>
              <span className={`font-mono text-right font-bold ${utilidadPercent >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-utilidad-percent">
                {utilidadPercent.toFixed(2)}%
              </span>
            </div>

            {/* Conciliación mercadería: qué se pagó vs qué se consumió. La diferencia es deuda
                generada con proveedores (o pago adelantado / stockeo si da al revés). */}
            {cmvMode && (
              <div className="space-y-2 border-t-2 pt-4" data-testid="section-conciliacion-mercaderia">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <span className="font-bold uppercase">Mercadería pagada</span>
                  <span className="text-xs text-muted-foreground self-center sm:text-right">
                    No computa en la utilidad
                  </span>
                </div>
                {groupedExpenseLines
                  .filter((g) => g.replacedByCmv)
                  .map((g) => (
                    <div key={`conc-${g.groupId}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] text-sm">
                      <span className="text-muted-foreground">{g.groupName}</span>
                      <span className="font-mono text-right text-muted-foreground w-36">{formatCurrency(g.groupAmount)}</span>
                      <span className="font-mono text-right text-muted-foreground w-20">{g.groupPercent.toFixed(2)}%</span>
                    </div>
                  ))}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] border-t pt-2 text-sm">
                  <span className="font-semibold">Total pagado en el período</span>
                  <span className="font-mono text-right font-semibold w-36" data-testid="text-mercaderia-pagada">{formatCurrency(merchandisePagado)}</span>
                  <span className="font-mono text-right font-semibold w-20">{merchandisePagadoPct.toFixed(2)}%</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] text-sm">
                  <span className="font-semibold">Costo real consumido (CMV)</span>
                  <span className="font-mono text-right font-semibold w-36">{formatCurrency(cmvAmount)}</span>
                  <span className="font-mono text-right font-semibold w-20">{cmvPercent.toFixed(2)}%</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] border-t pt-2 text-sm">
                  <span className="font-bold">Diferencia</span>
                  <span className={`font-mono text-right font-bold w-36 ${cmvVsPagado >= 0 ? "text-red-600" : "text-green-600"}`} data-testid="text-diferencia-cmv">
                    {formatCurrency(cmvVsPagado)}
                  </span>
                  <span className="font-mono text-right font-bold w-20">
                    {(cmvPercent - merchandisePagadoPct).toFixed(2)} pts
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {cmvVsPagado >= 0
                    ? "Consumiste más mercadería de la que pagaste: la diferencia es deuda generada con proveedores en el período."
                    : "Pagaste más mercadería de la que consumiste: la diferencia es cancelación de deuda previa, pago adelantado o stockeo."}
                </p>

                {/* De dónde sale el CMV de cada local: el % es por local y se aplica sobre las
                    ventas de ese local, recién después se suma. */}
                {cmvBalance.rows.length > 0 && (
                  <div className="pt-2">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-cmv-por-local">
                        <thead>
                          <tr className="text-xs text-muted-foreground">
                            <th className="text-left font-medium py-1">Local</th>
                            <th className="text-right font-medium py-1">CMV %</th>
                            <th className="text-right font-medium py-1">Ventas del balance</th>
                            <th className="text-right font-medium py-1">CMV $</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cmvBalance.rows.map((r) => (
                            <tr key={`cmvrow-${r.localId}`} className="border-t">
                              <td className="py-1">
                                <span>{localName(r.localId)}</span>
                                <span className="block text-[10px] text-muted-foreground">
                                  {r.periodFrom} → {r.periodTo} · ventas base: {r.salesSource}
                                  {r.computedWithoutIva ? " · calculado sin IVA" : ""}
                                </span>
                              </td>
                              <td className="text-right font-mono py-1">{r.pct.toFixed(2)}%</td>
                              <td className="text-right font-mono py-1">{formatCurrency(r.ventas)}</td>
                              <td className="text-right font-mono py-1">{formatCurrency(r.cmvAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-muted-foreground pt-2">
                      El CMV % de cada local es el que quedó guardado en su cálculo, aplicado sobre la facturación
                      del balance de ese local.
                    </p>
                  </div>
                )}
              </div>
            )}

            {otrosMovGroups.length > 0 && (
              <div className="space-y-2 border-t-2 pt-4" data-testid="section-movimientos-financieros">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <span className="font-bold uppercase">Movimientos Financieros</span>
                  <span className="text-xs text-muted-foreground self-center sm:text-right">
                    No afectan la rentabilidad
                  </span>
                </div>
                {otrosMovGroups.map((group, idx) => {
                  // Punto 7: mostrar SOLO la parte especial del grupo (por si es mixto), con el
                  // mismo firmado que compone el Total.
                  const specialCats = group.specialCategories ?? group.categories;
                  const signed = group.specialSignedMonthlyTotals?.[month]
                    ?? group.signedMonthlyTotals?.[month] ?? group.monthlyTotals[month] ?? 0;
                  const expanded = expandedMovFinGroupIds.includes(group.id);
                  const hasCats = specialCats.length > 0;
                  return (
                    <div key={`movfin-${group.id}-${idx}`} className="space-y-1">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                        {hasCats ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-left"
                            onClick={() =>
                              setExpandedMovFinGroupIds((prev) =>
                                prev.includes(group.id) ? prev.filter((id) => id !== group.id) : [...prev, group.id],
                              )
                            }
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className="text-muted-foreground">{group.name}</span>
                          </button>
                        ) : (
                          <span className="text-muted-foreground">{group.name}</span>
                        )}
                        <span className="font-mono text-right text-muted-foreground">{formatCurrency(signed)}</span>
                      </div>
                      {expanded &&
                        specialCats.map((cat, catIdx) => (
                          <div key={`movfin-${group.id}-${cat.name}-${catIdx}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                            <span className="pl-6 text-muted-foreground">{cat.name}</span>
                            <span className="font-mono text-right text-muted-foreground">
                              {formatCurrency(cat.signedMonthlyTotals?.[month] ?? cat.monthlyTotals[month] ?? 0)}
                            </span>
                          </div>
                        ))}
                    </div>
                  );
                })}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-2 text-sm">
                  <span className="font-semibold">Total Movimientos Financieros</span>
                  <span className="font-mono text-right font-semibold" data-testid="text-total-movimientos-financieros">
                    {formatCurrency(spreadsheet.summary.otrosMovimientos?.[month] ?? 0)}
                  </span>
                </div>

              </div>
            )}

            {/* Caja del período: SIEMPRE sobre lo pagado, en los dos modos. El CMV mide
                rentabilidad, no plata que se movió, así que acá entra la mercadería pagada real. */}
            <div className="space-y-2 border-t-2 pt-4" data-testid="section-caja-periodo">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <span className="font-bold uppercase">Movimiento neto del período (caja)</span>
                <span className="text-xs text-muted-foreground self-center sm:text-right">
                  Siempre sobre lo pagado
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                <span className="text-muted-foreground">Ventas</span>
                <span className="font-mono text-right text-muted-foreground">{formatCurrency(monthlyVentas)}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                <span className="text-muted-foreground">
                  − Gastos pagados{cmvMode ? " (mercadería incluida)" : ""}
                </span>
                <span className="font-mono text-right text-muted-foreground">{formatCurrency(gastosPagados)}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                <span className="text-muted-foreground">+ Movimientos Financieros</span>
                <span className="font-mono text-right text-muted-foreground">{formatCurrency(monthlyOtrosMov)}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t-2 pt-2">
                <span className="font-bold uppercase">Movimiento neto</span>
                <span
                  className={`font-mono text-right font-bold ${cajaNeta >= 0 ? "text-green-600" : "text-red-600"}`}
                  data-testid="text-movimiento-neto-caja"
                >
                  {formatCurrency(cajaNeta)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {cmvMode
                  ? "La utilidad de arriba usa el CMV (criterio devengado); esta caja usa la mercadería efectivamente pagada. La diferencia entre ambas es exactamente la deuda generada o cancelada en el período."
                  : "Ventas − Gastos pagados (traslados incluidos) + Movimientos Financieros: la variación de caja del período."}
              </p>
            </div>

            {/* Punto 12: CMV asentado (dato informativo, no pisa el balance) */}
            {selectedLocalIds.length === 1 && (
              <div className="space-y-2 border-t-2 pt-4" data-testid="section-cmv-balance">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <span className="font-bold uppercase">CMV del período</span>
                  <span className="text-xs text-muted-foreground self-center sm:text-right">
                    {matchedCmv
                      ? `Período CMV: ${String(matchedCmv.periodFrom).slice(0, 10)} → ${String(matchedCmv.periodTo).slice(0, 10)}`
                      : "Dato asentado (no afecta el balance)"}
                  </span>
                </div>
                {matchedCmv ? (
                  <>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                      <span className="text-muted-foreground">Stock inicial</span>
                      <span className="font-mono text-right text-muted-foreground">{formatCurrency(parseFloat(String(matchedCmv.stockInicial)) || 0)}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                      <span className="text-muted-foreground">+ Compras</span>
                      <span className="font-mono text-right text-muted-foreground">{formatCurrency(parseFloat(String(matchedCmv.compras)) || 0)}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                      <span className="text-muted-foreground">− Stock final</span>
                      <span className="font-mono text-right text-muted-foreground">{formatCurrency(parseFloat(String(matchedCmv.stockFinal)) || 0)}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-2 text-sm">
                      <span className="font-semibold">CMV</span>
                      <span className="font-mono text-right font-semibold" data-testid="text-cmv-balance">{formatCurrency(parseFloat(String(matchedCmv.cmv)) || 0)}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                      <span className="text-muted-foreground">Venta base CMV</span>
                      <span className="font-mono text-right text-muted-foreground">{formatCurrency(parseFloat(String(matchedCmv.ventaNeta)) || 0)}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                      <span className="font-semibold">CMV %</span>
                      <span className="font-mono text-right font-semibold">{(parseFloat(String(matchedCmv.cmvPct)) || 0).toFixed(2)}%</span>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      No hay un CMV guardado que cubra {fullMonths[month - 1]} {selectedYear} para este local.
                      Calculalo y guardalo desde el módulo CMV para que aparezca acá.
                    </p>
                    {cmvMatch.nearby.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Hay {cmvMatch.nearby.length === 1 ? "un CMV" : `${cmvMatch.nearby.length} CMV`} de este local que
                        {cmvMatch.nearby.length === 1 ? " toca" : " tocan"} el mes pero no
                        {cmvMatch.nearby.length === 1 ? " lo representa" : " lo representan"} (
                        {cmvMatch.nearby
                          .slice(0, 3)
                          .map((c) => `${String(c.periodFrom).slice(0, 10)} → ${String(c.periodTo).slice(0, 10)}`)
                          .join(" · ")}
                        {cmvMatch.nearby.length > 3 ? " · …" : ""}). Solo se asienta el que va de punta a punta del mes.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderAnnualView = () => {
    if (isLoading) {
      return (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      );
    }

    if (!spreadsheet || spreadsheet.groups.length === 0) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos de balance para mostrar.
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Ventas Anuales</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-green-600" data-testid="stat-annual-income">
                {formatCurrency(annualTotals.ventas)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Gastos Anuales</CardTitle>
              <TrendingDown className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-red-600" data-testid="stat-annual-expenses">
                {formatCurrency(annualTotals.gastos)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Utilidad Anual</CardTitle>
              <DollarSign className={`h-4 w-4 ${annualTotals.utilidad >= 0 ? "text-green-600" : "text-red-600"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold font-mono ${annualTotals.utilidad >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="stat-annual-net">
                {formatCurrency(annualTotals.utilidad)}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2">
              Resumen Anual por Mes
              <Badge variant={cmvMode ? "default" : "outline"} className="text-[10px] font-normal">
                {cmvMode ? "Rentabilidad por CMV" : "Rentabilidad por lo pagado"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 md:p-6">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" data-testid="balance-annual-table">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="sticky left-0 z-10 bg-muted/50 text-left px-3 py-2 font-medium border-b min-w-[80px]">
                      Mes
                    </th>
                    <th className="text-right px-3 py-2 font-medium border-b min-w-[120px]">Ventas</th>
                    <th className="text-right px-3 py-2 font-medium border-b min-w-[120px]">Gastos</th>
                    <th className="text-right px-3 py-2 font-medium border-b min-w-[120px]">Utilidad</th>
                    <th className="text-right px-3 py-2 font-medium border-b min-w-[80px]">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {annualRows.map((r) => (
                    <tr
                      key={r.month}
                      className={`border-b hover-elevate cursor-pointer ${r.month === parseInt(selectedMonth) ? "bg-primary/5" : ""}`}
                      onClick={() => { setSelectedMonth(r.month.toString()); setViewMode("monthly"); }}
                      data-testid={`row-month-${r.month}`}
                    >
                      <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium border-b">
                        <span className="inline-flex items-center gap-1">
                          {fullMonths[r.month - 1]}
                          {r.hasData && r.missingCmv.length > 0 && (
                            <AlertTriangle
                              className="h-3.5 w-3.5 text-red-600"
                              aria-label={`Sin CMV: ${r.missingCmv.join(", ")}`}
                            />
                          )}
                        </span>
                      </td>
                      <td className="text-right px-3 py-2 font-mono border-b text-green-600 dark:text-green-400">
                        {r.hasData ? formatCurrency(r.ventas) : "-"}
                      </td>
                      <td className="text-right px-3 py-2 font-mono border-b text-red-600 dark:text-red-400">
                        {r.hasData ? formatCurrency(r.gastos) : "-"}
                      </td>
                      <td className={`text-right px-3 py-2 font-mono font-medium border-b ${r.utilidad >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        {r.hasData ? formatCurrency(r.utilidad) : "-"}
                      </td>
                      <td className={`text-right px-3 py-2 font-mono border-b ${r.margen >= 0 ? "" : "text-red-600"}`}>
                        {r.hasData ? `${r.margen.toFixed(1)}%` : "-"}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/50 font-bold">
                    <td className="sticky left-0 z-10 bg-muted/50 px-3 py-3 border-t-2">TOTAL</td>
                    <td className="text-right px-3 py-3 font-mono border-t-2 text-green-600 dark:text-green-400">
                      {formatCurrency(annualTotals.ventas)}
                    </td>
                    <td className="text-right px-3 py-3 font-mono border-t-2 text-red-600 dark:text-red-400">
                      {formatCurrency(annualTotals.gastos)}
                    </td>
                    <td className={`text-right px-3 py-3 font-mono border-t-2 ${annualTotals.utilidad >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      {formatCurrency(annualTotals.utilidad)}
                    </td>
                    <td className="text-right px-3 py-3 font-mono border-t-2">
                      {annualTotals.ventas > 0 ? `${annualTotals.margen.toFixed(1)}%` : "-"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balances Financieros"
        description="Estado de resultados mensual y anual"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" data-testid="button-export-pdf" onClick={exportPdf} disabled={!spreadsheet}>
              <Download className="h-4 w-4 mr-2" />
              Exportar PDF
            </Button>
            <Button variant="outline" data-testid="button-export-excel" onClick={exportExcel} disabled={!spreadsheet}>
              <Download className="h-4 w-4 mr-2" />
              Exportar Excel
            </Button>
          </div>
        }
      />

      <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-start sm:items-center">
        <DataEntryCombobox
          options={yearComboOptions}
          value={selectedYear}
          onValueChange={setSelectedYear}
          placeholder="Año"
          searchPlaceholder="Buscar año…"
          triggerClassName="w-32"
          data-testid="select-year"
        />

        {viewMode === "monthly" && (
          <DataEntryCombobox
            options={monthComboOptions}
            value={selectedMonth}
            onValueChange={setSelectedMonth}
            placeholder="Mes"
            searchPlaceholder="Buscar mes…"
            triggerClassName="w-44"
            data-testid="select-month"
          />
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" className="w-56 justify-between font-normal" data-testid="select-local">
              <span className="truncate text-left">{localsLabel}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="start">
            <div className="space-y-1 max-h-72 overflow-y-auto">
              <button
                type="button"
                className="flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm hover:bg-muted text-left"
                onClick={() => setSelectedLocalIds([])}
              >
                <Checkbox checked={selectedLocalIds.length === 0} />
                <span>Todos los locales</span>
              </button>
              {locals.map((l) => {
                const checked = selectedLocalIds.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className="flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm hover:bg-muted text-left"
                    onClick={() =>
                      setSelectedLocalIds((prev) =>
                        prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id],
                      )
                    }
                  >
                    <Checkbox checked={checked} />
                    <span className="truncate">{l.name}</span>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {/* Criterio de rentabilidad. "Pagado" es lo de siempre; "CMV" reemplaza los grupos de
            mercadería por el costo devengado para que no pagar a un proveedor no infle la utilidad. */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rentabilidad:</span>
            <div className="inline-flex rounded-md border p-0.5" role="group">
              <Button
                type="button"
                size="sm"
                variant={cmvMode ? "ghost" : "default"}
                className="h-7 px-3"
                onClick={() => setProfitMode("pagado")}
                data-testid="button-mode-pagado"
              >
                Pagado
              </Button>
              <Button
                type="button"
                size="sm"
                variant={cmvMode ? "default" : "ghost"}
                className="h-7 px-3"
                onClick={() => setProfitMode("cmv")}
                data-testid="button-mode-cmv"
              >
                CMV
              </Button>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 font-normal" data-testid="button-config-mercaderia">
                  <Settings2 className="h-4 w-4 mr-2" />
                  Mercadería ({merchandiseGroupIds.size})
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" align="start">
                <p className="text-sm font-medium mb-1">Grupos de mercadería</p>
                <p className="text-xs text-muted-foreground mb-3">
                  En modo CMV estos grupos dejan de computar en la rentabilidad y su lugar lo toma el costo
                  de mercadería calculado. Siguen a la vista y siguen contando en la caja.
                </p>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {expenseGroups.length === 0 && (
                    <p className="text-sm text-muted-foreground">No hay grupos de gasto.</p>
                  )}
                  {expenseGroups.map((g) => (
                    <button
                      key={`merch-${g.id}`}
                      type="button"
                      className="flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm hover:bg-muted text-left disabled:opacity-50"
                      disabled={merchandiseMutation.isPending}
                      onClick={() =>
                        merchandiseMutation.mutate({ id: g.id, isMerchandise: !g.isMerchandise })
                      }
                    >
                      <Checkbox checked={!!g.isMerchandise} />
                      <span className="truncate">{g.name}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
        </div>
      </div>

      <Tabs value={viewMode} onValueChange={setViewMode}>
        <TabsList>
          <TabsTrigger value="monthly" data-testid="tab-monthly">
            Vista Mensual
          </TabsTrigger>
          <TabsTrigger value="annual" data-testid="tab-annual">
            Vista Anual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="monthly" className="mt-4">
          {renderMonthlyView()}
        </TabsContent>

        <TabsContent value="annual" className="mt-4">
          {renderAnnualView()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
