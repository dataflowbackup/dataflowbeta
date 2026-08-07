import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
// Named export a propósito: el default de jspdf no es construible fuera del bundler, y así el mismo
// `buildCartaPdf` se puede generar y verificar con un script de Node.
import { jsPDF } from "jspdf";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercentage, formatDate } from "@/lib/formatters";

export interface CartaRow {
  id: number;
  name: string;
  totalCost?: string | number | null;
  salePrice?: string | number | null;
  salePriceWithTax?: string | number | null;
  cmvPercentage?: string | number | null;
  marginPercentage?: string | number | null;
  margin?: string | number | null;
  markup?: string | number | null;
  cmvIdeal?: string | number | null;
  ingredientCount?: number;
  createdAt?: string | Date | null;
  active?: boolean | null;
  category?: { name?: string | null } | null;
  subcategory?: { name?: string | null } | null;
}

export interface CartaKpis {
  totalRecipes: number;
  activeRecipes: number;
  inactiveRecipes: number;
  avgCmv: number;
  avgMargin: number;
  avgMarkup: number;
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

type Align = "left" | "right";

interface ColDef {
  key: string;
  label: string;
  align: Align;
  /** Peso relativo del ancho de la columna al repartir el espacio de la hoja. */
  weight: number;
  text: (r: CartaRow) => string;
  /** Valor crudo para el Excel: mejor un número que un string formateado. */
  raw: (r: CartaRow) => string | number;
}

const cmvDiffOf = (r: CartaRow): number | null =>
  r.cmvIdeal == null || String(r.cmvIdeal) === "" ? null : num(r.cmvPercentage) - num(r.cmvIdeal);

export const CARTA_COLUMNS: ColDef[] = [
  { key: "name", label: "Receta", align: "left", weight: 3.2, text: (r) => r.name ?? "", raw: (r) => r.name ?? "" },
  { key: "category", label: "Categoría", align: "left", weight: 1.8, text: (r) => r.category?.name ?? "-", raw: (r) => r.category?.name ?? "" },
  { key: "subcategory", label: "Subcategoría", align: "left", weight: 1.8, text: (r) => r.subcategory?.name ?? "-", raw: (r) => r.subcategory?.name ?? "" },
  { key: "totalCost", label: "Costo sin IVA", align: "right", weight: 1.3, text: (r) => formatCurrency(r.totalCost as any), raw: (r) => num(r.totalCost) },
  { key: "salePrice", label: "Precio Venta", align: "right", weight: 1.3, text: (r) => formatCurrency(r.salePrice as any), raw: (r) => num(r.salePrice) },
  { key: "salePriceWithTax", label: "Precio c/IVA", align: "right", weight: 1.3, text: (r) => (r.salePriceWithTax ? formatCurrency(r.salePriceWithTax as any) : "-"), raw: (r) => num(r.salePriceWithTax) },
  { key: "cmvPercentage", label: "CMV %", align: "right", weight: 1, text: (r) => formatPercentage(r.cmvPercentage as any), raw: (r) => num(r.cmvPercentage) },
  { key: "marginPercentage", label: "Margen %", align: "right", weight: 1, text: (r) => formatPercentage(r.marginPercentage as any), raw: (r) => num(r.marginPercentage) },
  { key: "margin", label: "Margen $", align: "right", weight: 1.3, text: (r) => formatCurrency(r.margin as any), raw: (r) => num(r.margin) },
  { key: "markup", label: "Mark Up %", align: "right", weight: 1.1, text: (r) => formatPercentage(r.markup as any), raw: (r) => num(r.markup) },
  { key: "cmvIdeal", label: "CMV Ideal %", align: "right", weight: 1.1, text: (r) => (r.cmvIdeal ? formatPercentage(r.cmvIdeal as any) : "-"), raw: (r) => num(r.cmvIdeal) },
  {
    key: "cmvDiff",
    label: "Dif CMV",
    align: "right",
    weight: 1,
    text: (r) => {
      const d = cmvDiffOf(r);
      return d == null ? "-" : `${d > 0 ? "+" : ""}${d.toFixed(2)}%`;
    },
    raw: (r) => cmvDiffOf(r) ?? "",
  },
  { key: "ingredientCount", label: "Ingred.", align: "right", weight: 0.8, text: (r) => String(r.ingredientCount ?? 0), raw: (r) => r.ingredientCount ?? 0 },
  { key: "createdAt", label: "Creado", align: "left", weight: 1.1, text: (r) => formatDate(r.createdAt as any), raw: (r) => formatDate(r.createdAt as any) },
  { key: "active", label: "Estado", align: "left", weight: 1, text: (r) => (r.active ? "Activo" : "Inactivo"), raw: (r) => (r.active ? "Activo" : "Inactivo") },
];

const DEFAULT_KEYS = [
  "name",
  "category",
  "subcategory",
  "totalCost",
  "salePrice",
  "cmvPercentage",
  "marginPercentage",
  "margin",
];

const STORAGE_KEY = "carta-export-columns";

/** Recetas agrupadas por categoría, ordenadas, con los promedios de cada grupo. */
export function groupCartaRows(rows: CartaRow[]) {
  const byCat = new Map<string, CartaRow[]>();
  for (const r of rows) {
    const cat = r.category?.name?.trim() || "Sin categoría";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(r);
  }
  return Array.from(byCat.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([name, items]) => ({
      name,
      items: [...items].sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
      avgCmv: items.length ? items.reduce((s, r) => s + num(r.cmvPercentage), 0) / items.length : 0,
      avgMargin: items.length ? items.reduce((s, r) => s + num(r.marginPercentage), 0) / items.length : 0,
    }));
}

/**
 * Arma el PDF de la Carta. Está fuera del componente para poder generarlo y verificarlo sin montar
 * React. Devuelve el documento; quien llama decide si lo guarda o lo inspecciona.
 */
export function buildCartaPdf(opts: {
  rows: CartaRow[];
  kpis: CartaKpis;
  filtersLabel: string;
  cols: ColDef[];
  includeDashboard: boolean;
}): jsPDF {
  const { rows, kpis, filtersLabel, cols, includeDashboard } = opts;
  const groups = groupCartaRows(rows);

  // Apaisado: con más de 6 columnas, en vertical no entra nada legible.
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 30;
  const tableLeft = marginX;
  const tableRight = pageW - marginX;
  const tableW = tableRight - tableLeft;
  const rowH = 16;
  const pageBottom = pageH - 34;

  // Anchos proporcionales al peso de cada columna.
  const totalWeight = cols.reduce((s, c) => s + c.weight, 0) || 1;
  const widths = cols.map((c) => (c.weight / totalWeight) * tableW);
  const xs: number[] = [];
  let acc = tableLeft;
  for (const w of widths) {
    xs.push(acc);
    acc += w;
  }

  let page = 1;
  let y = 0;

  const drawFooter = () => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(130, 130, 130);
    doc.text(`Página ${page}`, tableRight, pageH - 18, { align: "right" });
    doc.text("DataFlow · Carta, Costos y Recetas", tableLeft, pageH - 18);
    doc.setTextColor(0, 0, 0);
  };

  const drawTableHeader = () => {
    doc.setFillColor(45, 45, 45);
    doc.setDrawColor(45, 45, 45);
    doc.rect(tableLeft, y, tableW, rowH + 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    cols.forEach((c, i) => {
      const x = c.align === "right" ? xs[i] + widths[i] - 4 : xs[i] + 4;
      doc.text(c.label, x, y + 11, { align: c.align === "right" ? "right" : "left" });
    });
    doc.setTextColor(0, 0, 0);
    y += rowH + 2;
  };

  const newPage = () => {
    drawFooter();
    doc.addPage();
    page++;
    y = 40;
    drawTableHeader();
  };

  const ensure = (needed: number) => {
    if (y + needed > pageBottom) newPage();
  };

  // ---- Portada del reporte ----
  y = 44;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Carta, Costos y Recetas", tableLeft, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text(
    new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" }),
    tableRight,
    y,
    { align: "right" },
  );
  y += 15;
  doc.setFontSize(8.5);
  doc.text(filtersLabel, tableLeft, y);
  doc.setTextColor(0, 0, 0);
  y += 16;

  // ---- Tarjetas de KPIs (el dashboard superior) ----
  if (includeDashboard) {
    const cards = [
      { label: "Total Recetas", value: String(kpis.totalRecipes) },
      { label: "Activas", value: String(kpis.activeRecipes) },
      { label: "Inactivas", value: String(kpis.inactiveRecipes) },
      { label: "CMV Promedio", value: `${kpis.avgCmv.toFixed(2)}%` },
      { label: "Margen Promedio", value: `${kpis.avgMargin.toFixed(2)}%` },
      { label: "Markup Promedio", value: `${kpis.avgMarkup.toFixed(2)}%` },
    ];
    const gap = 8;
    const cardW = (tableW - gap * (cards.length - 1)) / cards.length;
    const cardH = 40;
    cards.forEach((c, i) => {
      const x = tableLeft + i * (cardW + gap);
      doc.setFillColor(247, 247, 249);
      doc.setDrawColor(224, 224, 228);
      doc.setLineWidth(0.5);
      doc.roundedRect(x, y, cardW, cardH, 3, 3, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(c.label, x + 7, y + 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(30, 30, 30);
      doc.text(c.value, x + 7, y + 31);
    });
    doc.setTextColor(0, 0, 0);
    y += cardH + 16;
  }

  drawTableHeader();

  // ---- Cuerpo: un bloque por categoría, con subtotal ----
  doc.setFontSize(7.5);
  for (const g of groups) {
    ensure(rowH * 3);

    // Título de categoría a todo el ancho.
    doc.setFillColor(232, 232, 236);
    doc.setDrawColor(210, 210, 214);
    doc.rect(tableLeft, y, tableW, rowH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(g.name.toUpperCase(), tableLeft + 4, y + 11);
    doc.text(`${g.items.length} receta${g.items.length === 1 ? "" : "s"}`, tableRight - 4, y + 11, {
      align: "right",
    });
    y += rowH;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    g.items.forEach((r, idx) => {
      ensure(rowH);
      // Cebrado suave: hace legible una tabla de muchas columnas.
      if (idx % 2 === 1) {
        doc.setFillColor(250, 250, 251);
        doc.rect(tableLeft, y, tableW, rowH, "F");
      }
      cols.forEach((c, i) => {
        const maxW = widths[i] - 8;
        const fitted = doc.splitTextToSize(c.text(r), maxW)[0] ?? "";
        const x = c.align === "right" ? xs[i] + widths[i] - 4 : xs[i] + 4;
        doc.text(fitted, x, y + 11, { align: c.align === "right" ? "right" : "left" });
      });
      y += rowH;
    });

    // Subtotal de la categoría: promedios de CMV% y Margen%.
    ensure(rowH);
    doc.setDrawColor(210, 210, 214);
    doc.setLineWidth(0.5);
    doc.line(tableLeft, y, tableRight, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(90, 90, 90);
    doc.text(`Promedio ${g.name}`, tableLeft + 4, y + 11);
    const cmvIdx = cols.findIndex((c) => c.key === "cmvPercentage");
    const marIdx = cols.findIndex((c) => c.key === "marginPercentage");
    if (cmvIdx >= 0) {
      doc.text(`${g.avgCmv.toFixed(2)}%`, xs[cmvIdx] + widths[cmvIdx] - 4, y + 11, { align: "right" });
    }
    if (marIdx >= 0) {
      doc.text(`${g.avgMargin.toFixed(2)}%`, xs[marIdx] + widths[marIdx] - 4, y + 11, { align: "right" });
    }
    // Si ninguna de las dos columnas fue elegida, el promedio se aclara al costado del nombre.
    if (cmvIdx < 0 && marIdx < 0) {
      doc.text(`CMV ${g.avgCmv.toFixed(2)}% · Margen ${g.avgMargin.toFixed(2)}%`, tableRight - 4, y + 11, {
        align: "right",
      });
    }
    doc.setTextColor(0, 0, 0);
    y += rowH + 6;
  }

  if (groups.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.text("No hay recetas que coincidan con los filtros aplicados.", tableLeft + 4, y + 11);
  }

  drawFooter();
  return doc;
}

/**
 * Exportación de la Carta a PDF o Excel (ago-2026).
 *
 * Antes de exportar se eligen las columnas, y el resultado respeta los filtros de la pantalla: lo
 * que se exporta es lo que se está viendo. Los filtros aplicados y los KPIs viajan impresos en el
 * PDF, para que el papel se explique solo sin tener que preguntar con qué filtros se sacó.
 */
export function CartaExportDialog({
  rows,
  kpis,
  filtersLabel,
  buttonClassName,
}: {
  rows: CartaRow[];
  kpis: CartaKpis;
  filtersLabel: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"pdf" | "excel">("pdf");
  const [includeDashboard, setIncludeDashboard] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(DEFAULT_KEYS);

  // Las columnas elegidas se recuerdan: quien exporta la carta suele querer siempre las mismas.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) setSelectedKeys(parsed);
      }
    } catch {
      /* si el storage falla, se usan las columnas por defecto */
    }
  }, []);

  const persist = (keys: string[]) => {
    setSelectedKeys(keys);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    } catch {
      /* no pasa nada si no se puede guardar */
    }
  };

  const toggleKey = (key: string) =>
    persist(selectedKeys.includes(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key]);

  /** Columnas elegidas, en el orden canónico de la tabla (no en el orden en que se tildaron). */
  const cols = useMemo(() => CARTA_COLUMNS.filter((c) => selectedKeys.includes(c.key)), [selectedKeys]);


  const exportExcel = () => {
    const data = rows.map((r) => {
      const o: Record<string, string | number> = {};
      for (const c of cols) o[c.label] = c.raw(r);
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: cols.map((c) => c.label) });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Carta");
    XLSX.writeFile(wb, `carta_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setOpen(false);
  };


  const exportPdf = () => {
    const doc = buildCartaPdf({ rows, kpis, filtersLabel, cols, includeDashboard });
    doc.save(`carta_${new Date().toISOString().slice(0, 10)}.pdf`);
    setOpen(false);
  };

  const canExport = cols.length > 0 && rows.length > 0;

  return (
    <>
      <Button
        variant="outline"
        className={buttonClassName}
        onClick={() => setOpen(true)}
        data-testid="button-export-recipes"
      >
        <Download className="h-4 w-4 mr-2" />
        Exportar Carta
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Exportar Carta</DialogTitle>
            <DialogDescription>
              Se exportan las {rows.length} receta(s) que estás viendo, con los filtros aplicados. Elegí el formato
              y qué columnas incluir.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Formato</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormat("pdf")}
                  data-testid="button-format-pdf"
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3 text-left transition-colors",
                    format === "pdf" ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <FileText className={cn("h-5 w-5", format === "pdf" && "text-primary")} />
                  <div>
                    <p className="text-sm font-medium">PDF</p>
                    <p className="text-xs text-muted-foreground">Agrupado por categoría</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFormat("excel")}
                  data-testid="button-format-excel"
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3 text-left transition-colors",
                    format === "excel" ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <FileSpreadsheet className={cn("h-5 w-5", format === "excel" && "text-primary")} />
                  <div>
                    <p className="text-sm font-medium">Excel</p>
                    <p className="text-xs text-muted-foreground">Una fila por receta</p>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Columnas ({cols.length} de {CARTA_COLUMNS.length})</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => persist(CARTA_COLUMNS.map((c) => c.key))}
                  >
                    Todas
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => persist(DEFAULT_KEYS)}
                  >
                    Por defecto
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3 sm:grid-cols-3">
                {CARTA_COLUMNS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 py-0.5">
                    <Checkbox checked={selectedKeys.includes(c.key)} onCheckedChange={() => toggleKey(c.key)} />
                    <span className="truncate text-sm">{c.label}</span>
                  </label>
                ))}
              </div>
              {cols.length === 0 && (
                <p className="text-xs text-destructive">Elegí al menos una columna.</p>
              )}
            </div>

            {format === "pdf" && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3">
                <Checkbox checked={includeDashboard} onCheckedChange={(v) => setIncludeDashboard(v === true)} />
                <div>
                  <p className="text-sm font-medium">Incluir el dashboard superior</p>
                  <p className="text-xs text-muted-foreground">
                    Total, activas, inactivas y los promedios de CMV, margen y markup.
                  </p>
                </div>
              </label>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => (format === "pdf" ? exportPdf() : exportExcel())}
              disabled={!canExport}
              data-testid="button-confirm-export"
            >
              <Download className="h-4 w-4 mr-2" />
              Exportar {format === "pdf" ? "PDF" : "Excel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
