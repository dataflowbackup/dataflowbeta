import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";
import type { Local, CmvCalculation } from "@shared/schema";
import { pickCmvForMonth } from "@shared/cmvMonthMatch";

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

  const monthlyVentas = spreadsheet?.summary.income[month] ?? 0;
  const monthlyGastos = spreadsheet?.summary.expenses[month] ?? 0;
  const monthlyUtilidad = monthlyVentas - monthlyGastos;
  // Punto 6: Traslados de Mercadería del mes (recibidos − enviados). No afecta Utilidad ni saldos;
  // solo se resta en el "Movimiento neto (caja)".
  const monthlyTraslados = spreadsheet?.summary.traslados?.[month] ?? 0;
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

  const totalGastosPercent = monthlyVentas > 0 ? (monthlyGastos / monthlyVentas) * 100 : 0;
  const utilidadPercent = monthlyVentas > 0 ? (monthlyUtilidad / monthlyVentas) * 100 : 0;

  // Líneas agrupadas (grupo → categorías) reutilizables por el render y por la exportación.
  const buildGroupedLines = (groups: GroupData[]) =>
    groups.map((group) => {
      const categories = group.categories.map((cat) => {
        const amount = cat.monthlyTotals[month] ?? 0;
        const percent = monthlyVentas > 0 ? (amount / monthlyVentas) * 100 : 0;
        return { name: cat.name, amount, percent };
      });
      const amountFromCategories = categories.reduce((sum, cat) => sum + cat.amount, 0);
      const amountFromGroup = group.monthlyTotals[month] ?? 0;
      const groupAmount = group.categories.length > 0 ? amountFromCategories : amountFromGroup;
      const groupPercent = monthlyVentas > 0 ? (groupAmount / monthlyVentas) * 100 : 0;
      return { groupId: group.id, groupName: group.name, groupAmount, groupPercent, categories };
    });

  const groupedExpenseLines = useMemo(() => buildGroupedLines(expenseGroups), [expenseGroups, month, monthlyVentas]);
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
    rows.push({ label: "Ventas", value: formatCurrency(monthlyVentas), bold: true });
    for (const g of groupedVentaLines) {
      rows.push({ label: g.groupName, value: formatCurrency(g.groupAmount), indent: true });
    }
    rows.push({ label: "GASTOS", value: "" , bold: true });
    for (const g of groupedExpenseLines) {
      rows.push({ label: g.groupName, value: formatCurrency(g.groupAmount), indent: true, bold: true });
      if (expenseDetail) {
        for (const c of g.categories) rows.push({ label: `   ${c.name}`, value: formatCurrency(c.amount), indent: true });
      }
    }
    rows.push({ label: "Traslados de Mercadería (no afecta utilidad)", value: formatCurrency(monthlyTraslados), indent: true });
    rows.push({ label: "Gastos Totales", value: formatCurrency(monthlyGastos), bold: true });
    rows.push({ label: "Utilidad", value: formatCurrency(monthlyUtilidad), bold: true });
    rows.push({ label: "Utilidad %", value: `${utilidadPercent.toFixed(2)}%`, bold: true });
    if (otrosMovGroups.length > 0 || monthlyTraslados !== 0) {
      rows.push({ label: "MOVIMIENTOS FINANCIEROS (no afectan rentabilidad)", value: "", bold: true });
      for (const g of otrosMovGroups) {
        const signed = g.specialSignedMonthlyTotals?.[month]
          ?? g.signedMonthlyTotals?.[month] ?? g.monthlyTotals[month] ?? 0;
        rows.push({ label: g.name, value: formatCurrency(signed), indent: true });
      }
      rows.push({ label: "Total Movimientos Financieros", value: formatCurrency(spreadsheet?.summary.otrosMovimientos?.[month] ?? 0), bold: true });
      if (monthlyTraslados !== 0) {
        rows.push({ label: "− Traslados de Mercadería", value: formatCurrency(monthlyTraslados), indent: true });
      }
      rows.push({ label: "Movimiento neto del período (caja)", value: formatCurrency(monthlyUtilidad + (spreadsheet?.summary.otrosMovimientos?.[month] ?? 0) - monthlyTraslados), bold: true });
    }
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

  const exportPdf = () => {
    if (!spreadsheet) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 40;
    const rightX = 555;
    let y = 50;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Balance Financiero", marginX, y);
    doc.text(`${fullMonths[month - 1]} ${selectedYear}`, rightX, y, { align: "right" });
    y += 18;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(localsLabel, marginX, y);
    y += 16;
    doc.setFontSize(10);
    // Sin desglose de categorías: en el PDF solo los totales por grupo de gasto.
    for (const r of buildReportRows({ expenseDetail: false })) {
      if (y > 800) { doc.addPage(); y = 50; }
      doc.setFont("helvetica", r.bold ? "bold" : "normal");
      doc.text((r.indent ? "    " : "") + r.label, marginX, y);
      if (r.value) doc.text(r.value, rightX, y, { align: "right" });
      y += 15;
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
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold">
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
                      <span>{group.groupName}</span>
                    </button>
                    <span className="font-mono text-right">{formatCurrency(group.groupAmount)}</span>
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
              {/* Punto 6: Traslados de Mercadería — última fila, debajo del último grupo (RRHH).
                  No suma a Gastos Totales ni a la Utilidad; solo se resta del neto de caja. */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold border-t pt-2">
                <span className="inline-flex items-center gap-2">
                  Traslados de Mercadería
                  <span className="text-[10px] font-normal text-muted-foreground">(no afecta la utilidad)</span>
                </span>
                <span className="font-mono text-right" data-testid="text-traslados-mercaderia">{formatCurrency(monthlyTraslados)}</span>
              </div>
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
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold">
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
                      <span>{group.groupName}</span>
                    </button>
                    <span className="font-mono text-right">{group.groupPercent.toFixed(2)}%</span>
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
              {/* Punto 6: Traslados de Mercadería en % (sobre ventas). */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold border-t pt-2">
                <span className="inline-flex items-center gap-2">
                  Traslados de Mercadería
                  <span className="text-[10px] font-normal text-muted-foreground">(no afecta la utilidad)</span>
                </span>
                <span className="font-mono text-right">{trasladosPercent.toFixed(2)}%</span>
              </div>
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

            {(otrosMovGroups.length > 0 || monthlyTraslados !== 0) && (
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

                {monthlyTraslados !== 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                    <span className="font-semibold">− Traslados de Mercadería</span>
                    <span className="font-mono text-right font-semibold">{formatCurrency(monthlyTraslados)}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t-2 pt-2">
                  <span className="font-bold uppercase">Movimiento neto del período (caja)</span>
                  <span
                    className="font-mono text-right font-bold"
                    data-testid="text-movimiento-neto-caja"
                  >
                    {formatCurrency(monthlyUtilidad + (spreadsheet.summary.otrosMovimientos?.[month] ?? 0) - monthlyTraslados)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Utilidad (rentabilidad) + Movimientos Financieros − Traslados de Mercadería. Los traslados
                  ajustan la rentabilidad final (mercadería que un local pagó pero no usó, o usó pero no pagó)
                  sin tocar los saldos de caja/cuentas.
                </p>
              </div>
            )}

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

    const { summary } = spreadsheet;

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
                {formatCurrency(summary.totalIncome)}
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
                {formatCurrency(summary.totalExpenses)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Utilidad Anual</CardTitle>
              <DollarSign className={`h-4 w-4 ${summary.totalNet >= 0 ? "text-green-600" : "text-red-600"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold font-mono ${summary.totalNet >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="stat-annual-net">
                {formatCurrency(summary.totalNet)}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Resumen Anual por Mes</CardTitle>
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
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                    const inc = summary.income[m] ?? 0;
                    const exp = summary.expenses[m] ?? 0;
                    const net = inc - exp;
                    const margin = inc > 0 ? (net / inc) * 100 : 0;
                    const hasData = inc > 0 || exp > 0;

                    return (
                      <tr
                        key={m}
                        className={`border-b hover-elevate cursor-pointer ${m === parseInt(selectedMonth) ? "bg-primary/5" : ""}`}
                        onClick={() => { setSelectedMonth(m.toString()); setViewMode("monthly"); }}
                        data-testid={`row-month-${m}`}
                      >
                        <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium border-b">
                          {fullMonths[m - 1]}
                        </td>
                        <td className="text-right px-3 py-2 font-mono border-b text-green-600 dark:text-green-400">
                          {hasData ? formatCurrency(inc) : "-"}
                        </td>
                        <td className="text-right px-3 py-2 font-mono border-b text-red-600 dark:text-red-400">
                          {hasData ? formatCurrency(exp) : "-"}
                        </td>
                        <td className={`text-right px-3 py-2 font-mono font-medium border-b ${net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {hasData ? formatCurrency(net) : "-"}
                        </td>
                        <td className={`text-right px-3 py-2 font-mono border-b ${margin >= 0 ? "" : "text-red-600"}`}>
                          {hasData ? `${margin.toFixed(1)}%` : "-"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/50 font-bold">
                    <td className="sticky left-0 z-10 bg-muted/50 px-3 py-3 border-t-2">TOTAL</td>
                    <td className="text-right px-3 py-3 font-mono border-t-2 text-green-600 dark:text-green-400">
                      {formatCurrency(summary.totalIncome)}
                    </td>
                    <td className="text-right px-3 py-3 font-mono border-t-2 text-red-600 dark:text-red-400">
                      {formatCurrency(summary.totalExpenses)}
                    </td>
                    <td className={`text-right px-3 py-3 font-mono border-t-2 ${summary.totalNet >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      {formatCurrency(summary.totalNet)}
                    </td>
                    <td className="text-right px-3 py-3 font-mono border-t-2">
                      {summary.totalIncome > 0 ? `${((summary.totalNet / summary.totalIncome) * 100).toFixed(1)}%` : "-"}
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
