import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate, formatEsArAmountInput, formatNumber, parseEsArAmount, normalizeName } from "@/lib/formatters";
import { toISODate } from "@/lib/dateHelpers";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Plus,
  Trash2,
  Pencil,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Check,
  ChevronsUpDown,
  Filter,
  Scale,
  CalendarDays,
  Download,
  Upload,
  FileSpreadsheet,
} from "lucide-react";
import type { Transaction, BankAccount, TransactionCategory, Local, FinancialGroup } from "@shared/schema";

interface TransactionWithRelations extends Transaction {
  bankAccount?: BankAccount | null;
  category?: TransactionCategory | null;
  local?: Local | null;
}

const CASH_BANK_SOURCE = "cash";

// Cuadre de caja: la fila de ajuste por diferencia usa esta clave fija (autogenerada).
const CASH_ADJUST_KEY = "cash-adjust-diff";
const CASH_ADJUST_FALTANTE = "Ajustes y diferencia de caja (faltante efec.)";
const CASH_ADJUST_SOBRANTE = "Ajustes y diferencia de caja (sobrante efec.)";

const CASH_FILTER_TYPE_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "income", label: "Ingresos" },
  { value: "expense", label: "Egresos" },
];

const CASH_MOVEMENT_TYPE_OPTIONS = [
  { value: "income", label: "Ingreso" },
  { value: "expense", label: "Egreso" },
];

function isoDateParts(s: string): { y: number; m: number; d: number } | null {
  const slice = String(s ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slice)) return null;
  const [y, m, d] = slice.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}

/** Días inclusivos entre dos ISO YYYY-MM-DD (consistente con inputs type=date). */
function inclusiveCalendarDays(fromStr: string, toStr: string): number {
  const pa = isoDateParts(fromStr);
  const pb = isoDateParts(toStr);
  if (!pa || !pb) return 1;
  const a = new Date(pa.y, pa.m, pa.d).getTime();
  const b = new Date(pb.y, pb.m, pb.d).getTime();
  const msDay = 86_400_000;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.max(1, Math.round((hi - lo) / msDay) + 1);
}

type DraftRow = {
  key: string;
  transactionDate: string;
  description: string;
  categoryId: string;
  localId: string;
  type: "income" | "expense";
  amount: string;
};

// ---- Importación por Excel ----
const CASH_IMPORT_HEADERS = ["Fecha", "Descripción", "Tipo", "Importe", "Categoría"] as const;

const pad2 = (s: string | number) => String(s).padStart(2, "0");

/** Celda de fecha → "YYYY-MM-DD" local. Acepta Date (cellDates), yyyy-mm-dd y dd/mm/aaaa. */
function parseCellDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) return toISODate(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
  }
  return null;
}

/** Celda de tipo → income | expense (acepta Ingreso/Egreso, income/expense, I/E). */
function parseCellType(v: unknown): "income" | "expense" | null {
  const s = normalizeName(String(v ?? ""));
  if (!s) return null;
  if (["ingreso", "ingresos", "income", "i", "credito", "credit"].includes(s)) return "income";
  if (["egreso", "egresos", "expense", "e", "gasto", "debito", "debit"].includes(s)) return "expense";
  return null;
}

/** Celda de importe → número. Number directo; string en formato es-AR. */
function parseCellAmount(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return NaN;
  return parseEsArAmount(s);
}

/** Lectura tolerante de columnas por nombre de encabezado (ignora acentos/mayúsculas). */
function cellByHeader(row: Record<string, unknown>, ...names: string[]): unknown {
  const wanted = names.map((n) => normalizeName(n));
  for (const k of Object.keys(row)) {
    if (wanted.includes(normalizeName(k))) return row[k];
  }
  return "";
}

type ImportRow = {
  idx: number;
  transactionDate: string | null;
  description: string;
  type: "income" | "expense" | null;
  amount: number;
  categoryName: string;
  categoryId: number | null;
  error: string | null;
};

function makeDraftKey(seqRef: { current: number }): string {
  seqRef.current += 1;
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `cash-draft-${seqRef.current}-${rnd}`;
}

function makeDraftRow(seqRef: { current: number }): DraftRow {
  return {
    key: makeDraftKey(seqRef),
    transactionDate: new Date().toISOString().slice(0, 10),
    description: "",
    categoryId: "",
    localId: "none",
    type: "expense",
    amount: "",
  };
}

function CategoryPicker({
  value,
  onChange,
  categories,
  placeholder = "Elegir categoría…",
  allowClear = false,
  clearLabel = "Sin categoría",
}: {
  value: string;
  onChange: (id: string) => void;
  categories: TransactionCategory[];
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? categories.find((c) => String(c.id) === value) : undefined;
  const label =
    selected?.name ?? (allowClear && !value ? clearLabel : placeholder);
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal min-h-9"
        >
          <span className="truncate text-left">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,28rem)] p-0 z-[200]" align="start">
        <Command>
          <CommandInput placeholder="Buscar categoría…" />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>No se encontró ninguna categoría.</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value={`__clear__ ${clearLabel}`}
                  onSelect={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", !value ? "opacity-100" : "opacity-0")} />
                  {clearLabel}
                </CommandItem>
              )}
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.id}`}
                  onSelect={() => {
                    onChange(String(c.id));
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === String(c.id) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Selector de categoría con filtro previo por grupo financiero. */
function GroupedCategoryPicker({
  value,
  onChange,
  categories,
  financialGroups,
  allowClear = false,
  clearLabel = "Sin categoría",
}: {
  value: string;
  onChange: (id: string) => void;
  categories: TransactionCategory[];
  financialGroups: FinancialGroup[];
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const [groupId, setGroupId] = useState("all");
  const [open, setOpen] = useState(false);
  const groupOpen = useState(false);
  const [gOpen, setGOpen] = groupOpen;

  const visibleCats = useMemo(() => {
    if (groupId === "all") return categories.filter((c) => c.active !== false);
    return categories.filter((c) => c.active !== false && String((c as any).financialGroupId) === groupId);
  }, [categories, groupId]);

  const selected = value ? categories.find((c) => String(c.id) === value) : undefined;
  const selectedGroup = groupId !== "all" ? financialGroups.find((g) => String(g.id) === groupId) : null;

  const groupOptions = useMemo(
    () => [...financialGroups].filter((g) => g.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
    [financialGroups],
  );

  return (
    <div className="space-y-2">
      <Popover open={gOpen} onOpenChange={setGOpen} modal={false}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal min-h-9 text-xs">
            <span className="truncate text-left text-muted-foreground">Grupo: {selectedGroup?.name ?? "Todos"}</span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(100vw-2rem,28rem)] p-0 z-[200]" align="start">
          <Command>
            <CommandInput placeholder="Buscar grupo…" />
            <CommandList className="max-h-[220px]">
              <CommandEmpty>Sin resultados.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="__all__ Todos los grupos" onSelect={() => { setGroupId("all"); setGOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", groupId === "all" ? "opacity-100" : "opacity-0")} />
                  Todos los grupos
                </CommandItem>
                {groupOptions.map((g) => (
                  <CommandItem key={g.id} value={`${g.name} ${g.id}`} onSelect={() => { setGroupId(String(g.id)); setGOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", groupId === String(g.id) ? "opacity-100" : "opacity-0")} />
                    {g.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal min-h-9">
            <span className="truncate text-left">{selected?.name ?? (allowClear && !value ? clearLabel : "Elegir categoría…")}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(100vw-2rem,28rem)] p-0 z-[200]" align="start">
          <Command>
            <CommandInput placeholder="Buscar categoría…" />
            <CommandList className="max-h-[280px]">
              <CommandEmpty>No se encontró ninguna categoría.</CommandEmpty>
              <CommandGroup>
                {allowClear && (
                  <CommandItem value={`__clear__ ${clearLabel}`} onSelect={() => { onChange(""); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", !value ? "opacity-100" : "opacity-0")} />
                    {clearLabel}
                  </CommandItem>
                )}
                {visibleCats.map((c) => (
                  <CommandItem key={c.id} value={`${c.name} ${c.id}`} onSelect={() => { onChange(String(c.id)); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", value === String(c.id) ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{c.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Filtro de listado: opción "todos" + lista con búsqueda (cmdk). */
function FilterSearchableSelect({
  value,
  onChange,
  allLabel,
  items,
  searchPlaceholder,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  items: { id: number; name: string }[];
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value === "all" ? null : items.find((x) => String(x.id) === value);
  const label = selected?.name ?? allLabel;
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal min-h-9"
        >
          <span className="truncate text-left">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,24rem)] p-0 z-[100]" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`__all__ ${allLabel}`}
                onSelect={() => {
                  onChange("all");
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4 shrink-0", value === "all" ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.name} ${item.id}`}
                  onSelect={() => {
                    onChange(String(item.id));
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === String(item.id) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{item.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function CashPage() {
  const { toast } = useToast();
  const draftRowSeqRef = useRef(0);
  const [batchOpen, setBatchOpen] = useState(false);
  const [draftRows, setDraftRows] = useState<DraftRow[]>(() => [makeDraftRow(draftRowSeqRef)]);
  const [netoRecibido, setNetoRecibido] = useState("");
  const [editRow, setEditRow] = useState<TransactionWithRelations | null>(null);
  const [editTransactionDate, setEditTransactionDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editType, setEditType] = useState<"income" | "expense">("income");
  const [editAmount, setEditAmount] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<string>("");
  const [editLocalId, setEditLocalId] = useState<string>("none");
  const [deleteTarget, setDeleteTarget] = useState<TransactionWithRelations | null>(null);

  const [filterSearch, setFilterSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense">("all");
  const [filterLocalId, setFilterLocalId] = useState<string>("all");
  const [filterCategoryId, setFilterCategoryId] = useState<string>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const { data: categories = [] } = useQuery<TransactionCategory[]>({
    queryKey: ["/api/transaction-categories"],
  });
  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });
  const { data: financialGroups = [] } = useQuery<FinancialGroup[]>({
    queryKey: ["/api/financial-groups"],
  });

  // Clasificación Masiva en Efectivo
  const [isMasivaOpen, setIsMasivaOpen] = useState(false);
  const [masivaDateFrom, setMasivaDateFrom] = useState("");
  const [masivaDateTo, setMasivaDateTo] = useState("");
  const [masivaLocalId, setMasivaLocalId] = useState("");
  const [masivaDescSearch, setMasivaDescSearch] = useState("");
  const [masivaSelectedDescs, setMasivaSelectedDescs] = useState<Set<string>>(new Set());
  const [masivaCategoryId, setMasivaCategoryId] = useState("");
  const [masivaNewLocalId, setMasivaNewLocalId] = useState("");

  const incomeCategories = useMemo(
    () => categories.filter((c) => c.active !== false && (c.type === "income" || c.type === "both")),
    [categories],
  );
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.active !== false && (c.type === "expense" || c.type === "both")),
    [categories],
  );
  const allCategoriesSorted = useMemo(
    () =>
      [...categories]
        .filter((c) => c.active !== false)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
    [categories],
  );

  const localsSorted = useMemo(
    () => [...locals].sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
    [locals],
  );

  const categoryFiltersItems = useMemo(
    () => allCategoriesSorted.map((c) => ({ id: c.id, name: c.name })),
    [allCategoriesSorted],
  );

  const localFiltersItems = useMemo(
    () => localsSorted.map((l) => ({ id: l.id, name: l.name })),
    [localsSorted],
  );

  const cashLocalPickComboOptions = useMemo(
    () => [
      { value: "none", label: "Sin asignar" },
      ...localsSorted.map((l) => ({ value: String(l.id), label: l.name })),
    ],
    [localsSorted],
  );

  const {
    data: transactions = [],
    isLoading,
    refetch,
  } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions", "cash"],
    queryFn: async () => {
      const PAGE_SIZE = 800;
      const MAX_PAGES = 250;
      const mergedById = new Map<number, TransactionWithRelations>();
      let afterDate: string | undefined;
      let afterId: number | undefined;
      let pageIdx = 0;

      const encodeCursorDate = (d: string | Date | null | undefined): string => {
        if (d == null) return "";
        if (typeof d === "string") return d.length >= 10 ? d.slice(0, 10) : d;
        try {
          return d.toISOString().slice(0, 10);
        } catch {
          return "";
        }
      };

      while (pageIdx < MAX_PAGES) {
        const qs = new URLSearchParams({ pageSize: String(PAGE_SIZE), bankSource: CASH_BANK_SOURCE });
        if (afterDate !== undefined && afterId !== undefined) {
          qs.set("afterDate", afterDate);
          qs.set("afterId", String(afterId));
        }
        const res = await fetch(`/api/transactions?${qs}`, { credentials: "include" });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status}: ${text || res.statusText}`);
        }
        const body = (await res.json()) as
          | TransactionWithRelations[]
          | { items: TransactionWithRelations[]; total?: number; page?: number; pageSize: number };

        if (Array.isArray(body)) return body;

        const prevSize = mergedById.size;
        for (const item of body.items) {
          mergedById.set(item.id, item);
        }
        const noNewIds = body.items.length > 0 && mergedById.size === prevSize;
        if (body.items.length === 0 || body.items.length < PAGE_SIZE || noNewIds) break;

        const last = body.items[body.items.length - 1]!;
        const nextAfter = encodeCursorDate(last.transactionDate);
        if (!nextAfter || last.id == null) break;
        afterDate = nextAfter;
        afterId = last.id;
        pageIdx += 1;
      }

      return Array.from(mergedById.values()).sort((a, b) => {
        const da = String(a.transactionDate ?? "").localeCompare(String(b.transactionDate ?? ""));
        if (da !== 0) return -da;
        return (b.id ?? 0) - (a.id ?? 0);
      });
    },
  });

  const filteredTransactions = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    return transactions.filter((t) => {
      if (filterType !== "all" && t.type !== filterType) return false;
      if (filterLocalId !== "all") {
        const lid = parseInt(filterLocalId, 10);
        if (!Number.isFinite(lid) || t.localId !== lid) return false;
      }
      if (filterCategoryId !== "all") {
        const cid = parseInt(filterCategoryId, 10);
        if (!Number.isFinite(cid) || t.categoryId !== cid) return false;
      }
      if (filterDateFrom && String(t.transactionDate) < filterDateFrom) return false;
      if (filterDateTo && String(t.transactionDate) > filterDateTo) return false;
      if (q && !String(t.description ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [
    transactions,
    filterSearch,
    filterType,
    filterLocalId,
    filterCategoryId,
    filterDateFrom,
    filterDateTo,
  ]);

  const totalIncome = useMemo(
    () =>
      filteredTransactions
        .filter((t) => t.type === "income")
        .reduce((s, t) => s + parseFloat(String(t.amount) || "0"), 0),
    [filteredTransactions],
  );
  const totalExpense = useMemo(
    () =>
      filteredTransactions
        .filter((t) => t.type === "expense")
        .reduce((s, t) => s + Math.abs(parseFloat(String(t.amount) || "0")), 0),
    [filteredTransactions],
  );

  const saldoFiltered = useMemo(() => totalIncome - totalExpense, [totalIncome, totalExpense]);

  /**
   * Promedio diario de ingresos: Σ ingresos en la vista ÷ días calendario entre la primera y última fecha
   * con ingreso (siempre usando solo ingresos; egresos no ensanchan el denominador aunque tengas rango desde/hasta amplio).
   */
  const dailyIncomeAverage = useMemo(() => {
    const incomeSortedDates = Array.from(
      new Set(
        filteredTransactions
          .filter((t) => t.type === "income")
          .map((t) => String(t.transactionDate ?? "").slice(0, 10))
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      ),
    ).sort();

    if (incomeSortedDates.length === 0) {
      return { amount: 0, days: 1, periodNote: "Sin ingresos en los filtros" };
    }

    const from = incomeSortedDates[0]!;
    const to = incomeSortedDates[incomeSortedDates.length - 1]!;
    const days = inclusiveCalendarDays(from, to);
    return {
      amount: totalIncome / days,
      days,
      periodNote: `${from} → ${to} · ${days} día${days === 1 ? "" : "s"} · promedio diario desde el primer al último ingreso (filtros aplicados; los egresos no alargan el período).`,
    };
  }, [filteredTransactions, totalIncome]);

  const openBatch = () => {
    draftRowSeqRef.current = 0;
    setDraftRows([makeDraftRow(draftRowSeqRef)]);
    setNetoRecibido("");
    setBatchOpen(true);
  };

  const addDraftRow = () => setDraftRows((r) => [...r, makeDraftRow(draftRowSeqRef)]);
  const removeDraftRow = (key: string) =>
    setDraftRows((r) => (r.length <= 1 ? r : r.filter((x) => x.key !== key)));

  const patchDraft = useCallback((key: string, patch: Partial<DraftRow>) => {
    setDraftRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }, []);

  const saveBatchMutation = useMutation({
    mutationFn: async (items: DraftRow[]) => {
      const payload = {
        items: items.map((r) => ({
          transactionDate: r.transactionDate,
          description: r.description.trim(),
          categoryId: r.categoryId ? parseInt(r.categoryId, 10) : null,
          localId: r.localId === "none" ? null : parseInt(r.localId, 10),
          type: r.type,
          amount: parseEsArAmount(String(r.amount)),
        })),
      };
      const res = await apiRequest("POST", "/api/transactions/cash-batch", payload);
      return res.json() as Promise<{ inserted: number }>;
    },
    onSuccess: async (data) => {
      toast({ title: "Movimientos registrados", description: `Se guardaron ${data.inserted} movimiento(s).` });
      setBatchOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      await refetch();
    },
    onError: (e: Error) => {
      toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" });
    },
  });

  const submitBatch = () => {
    const prepared = draftRows.filter((r) => r.description.trim() !== "" && r.amount !== "");
    if (prepared.length === 0) {
      toast({
        title: "Completá al menos un movimiento",
        description: "Descripción e importe son obligatorios.",
        variant: "destructive",
      });
      return;
    }
    for (const r of prepared) {
      const amt = parseEsArAmount(String(r.amount));
      if (!Number.isFinite(amt) || amt <= 0) {
        toast({ title: "Importe inválido", description: "Revisá los montos ingresados.", variant: "destructive" });
        return;
      }
    }
    saveBatchMutation.mutate(prepared);
  };

  // ---- Cuadre de caja (Neto recibido → fila de ajuste por diferencia) ----
  const faltanteCat = useMemo(
    () =>
      categories.find(
        (c) => c.active !== false && (c.type === "expense" || c.type === "both") && normalizeName(c.name) === normalizeName(CASH_ADJUST_FALTANTE),
      ),
    [categories],
  );
  const sobranteCat = useMemo(
    () =>
      categories.find(
        (c) => c.active !== false && (c.type === "income" || c.type === "both") && normalizeName(c.name) === normalizeName(CASH_ADJUST_SOBRANTE),
      ),
    [categories],
  );

  // Esperado = Σ ingresos − Σ egresos de las filas normales (excluye la fila de ajuste).
  const cuadreEsperado = useMemo(
    () =>
      draftRows
        .filter((r) => r.key !== CASH_ADJUST_KEY)
        .reduce((s, r) => {
          const a = parseEsArAmount(r.amount);
          if (!Number.isFinite(a)) return s;
          return s + (r.type === "income" ? a : -a);
        }, 0),
    [draftRows],
  );
  const cuadreNeto = parseEsArAmount(netoRecibido);
  const cuadreDiff = Number.isFinite(cuadreNeto) ? Math.round((cuadreNeto - cuadreEsperado) * 100) / 100 : null;
  const cuadreCatMissing =
    cuadreDiff != null && Math.abs(cuadreDiff) >= 0.005 && ((cuadreDiff < 0 && !faltanteCat) || (cuadreDiff > 0 && !sobranteCat));

  // Trigger del recálculo: cambios en netoRecibido o en las filas normales (no en la de ajuste).
  const cuadreInputsSig = useMemo(() => {
    const normal = draftRows.filter((r) => r.key !== CASH_ADJUST_KEY);
    const first = normal[0];
    return `${normal.map((r) => `${r.type}:${r.amount}`).join("|")}::${first?.transactionDate ?? ""}::${first?.localId ?? "none"}`;
  }, [draftRows]);

  useEffect(() => {
    const neto = parseEsArAmount(netoRecibido);
    setDraftRows((prev) => {
      const normal = prev.filter((r) => r.key !== CASH_ADJUST_KEY);
      const esperado = normal.reduce((s, r) => {
        const a = parseEsArAmount(r.amount);
        if (!Number.isFinite(a)) return s;
        return s + (r.type === "income" ? a : -a);
      }, 0);
      const diff = Number.isFinite(neto) ? Math.round((neto - esperado) * 100) / 100 : NaN;
      const hadAdjust = prev.some((r) => r.key === CASH_ADJUST_KEY);
      if (!netoRecibido.trim() || !Number.isFinite(diff) || Math.abs(diff) < 0.005) {
        return hadAdjust ? normal : prev;
      }
      const isFaltante = diff < 0;
      const cat = isFaltante ? faltanteCat : sobranteCat;
      const first = normal[0];
      const adjustRow: DraftRow = {
        key: CASH_ADJUST_KEY,
        transactionDate: first?.transactionDate || new Date().toISOString().slice(0, 10),
        description: isFaltante ? "Ajuste de caja (faltante efec.)" : "Ajuste de caja (sobrante efec.)",
        categoryId: cat ? String(cat.id) : "",
        localId: first?.localId ?? "none",
        type: isFaltante ? "expense" : "income",
        amount: formatEsArAmountInput(String(Math.abs(diff)).replace(".", ",")),
      };
      return [...normal, adjustRow];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netoRecibido, cuadreInputsSig, faltanteCat, sobranteCat]);

  // ---- Exportar / Importar Excel ----
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importLocalId, setImportLocalId] = useState<string>("");
  const [importFileName, setImportFileName] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);

  const importLocalOptions = useMemo(
    () => localsSorted.map((l) => ({ value: String(l.id), label: l.name })),
    [localsSorted],
  );

  const categoryGroupNameById = useMemo(() => {
    const catToGroup = new Map(categories.map((c) => [c.id, (c as any).financialGroupId as number | null]));
    const groupNameById = new Map(financialGroups.map((g) => [g.id, g.name]));
    return new Map(
      categories.map((c) => [c.id, groupNameById.get(catToGroup.get(c.id) ?? -1) ?? ""]),
    );
  }, [categories, financialGroups]);

  const exportToExcel = () => {
    const rows = filteredTransactions.map((t) => ({
      Fecha: String(t.transactionDate ?? "").slice(0, 10),
      Descripción: t.description ?? "",
      Tipo: t.type === "income" ? "Ingreso" : "Egreso",
      Importe: parseFloat(String(t.amount)) || 0,
      Grupo: t.categoryId ? (categoryGroupNameById.get(t.categoryId) ?? "") : "",
      Categoría: t.category?.name ?? "",
      Local: t.local?.name ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: ["Fecha", "Descripción", "Tipo", "Importe", "Grupo", "Categoría", "Local"] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Efectivo");
    XLSX.writeFile(wb, `efectivo_${toISODate(new Date())}.xlsx`);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet(
      [{ Fecha: "2026-06-10", Descripción: "Ej: venta mostrador", Tipo: "Ingreso", Importe: 1500.5, Categoría: "Ventas" }],
      { header: [...CASH_IMPORT_HEADERS] as string[] },
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
    XLSX.writeFile(wb, "plantilla_efectivo.xlsx");
  };

  const openImport = () => {
    setImportLocalId("");
    setImportFileName("");
    setImportRows([]);
    if (importFileRef.current) importFileRef.current.value = "";
    setImportOpen(true);
  };

  const handleImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed: ImportRow[] = raw.map((r, i) => {
        const transactionDate = parseCellDate(cellByHeader(r, "Fecha"));
        const description = String(cellByHeader(r, "Descripción", "Descripcion") ?? "").trim();
        const type = parseCellType(cellByHeader(r, "Tipo"));
        const amount = parseCellAmount(cellByHeader(r, "Importe", "Monto"));
        const categoryName = String(cellByHeader(r, "Categoría", "Categoria") ?? "").trim();

        let categoryId: number | null = null;
        if (type && categoryName) {
          const match = categories.find(
            (c) =>
              c.active !== false &&
              (c.type === type || c.type === "both") &&
              normalizeName(c.name) === normalizeName(categoryName),
          );
          categoryId = match?.id ?? null;
        }

        let error: string | null = null;
        if (!transactionDate) error = "Fecha inválida";
        else if (!description) error = "Falta descripción";
        else if (!type) error = "Tipo debe ser Ingreso o Egreso";
        else if (!Number.isFinite(amount) || amount <= 0) error = "Importe inválido";
        else if (categoryName && categoryId == null) error = `Categoría "${categoryName}" no encontrada (se importará sin categoría)`;

        return { idx: i + 2, transactionDate, description, type, amount, categoryName, categoryId, error };
      });
      setImportRows(parsed);
      setImportFileName(file.name);
    } catch (e: any) {
      toast({ title: "No se pudo leer el Excel", description: e?.message, variant: "destructive" });
    }
  };

  const importValidRows = useMemo(() => importRows.filter((r) => r.error == null), [importRows]);
  const importErrorRows = useMemo(() => importRows.filter((r) => r.error != null), [importRows]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const localId = parseInt(importLocalId, 10);
      const payload = {
        items: importValidRows.map((r) => ({
          transactionDate: r.transactionDate as string,
          description: r.description,
          categoryId: r.categoryId ?? null,
          localId,
          type: r.type as "income" | "expense",
          amount: r.amount,
        })),
      };
      const res = await apiRequest("POST", "/api/transactions/cash-batch", payload);
      return res.json() as Promise<{ inserted: number }>;
    },
    onSuccess: async (data) => {
      toast({ title: "Importación completa", description: `Se importaron ${data.inserted} movimiento(s).` });
      setImportOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      await refetch();
    },
    onError: (e: Error) => {
      toast({ title: "No se pudo importar", description: e.message, variant: "destructive" });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async () => {
      if (!editRow) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(editTransactionDate.trim())) {
        throw new Error("Fecha inválida");
      }
      const desc = editDescription.trim();
      if (!desc) {
        throw new Error("La descripción es obligatoria");
      }
      const amt = parseEsArAmount(String(editAmount));
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new Error("Importe inválido");
      }
      await apiRequest("PATCH", `/api/transactions/${editRow.id}`, {
        transactionDate: editTransactionDate.trim(),
        description: desc,
        type: editType,
        amount: amt,
        categoryId: editCategoryId ? parseInt(editCategoryId, 10) : null,
        localId: editLocalId === "none" ? null : parseInt(editLocalId, 10),
      });
    },
    onSuccess: async () => {
      toast({ title: "Movimiento actualizado" });
      setEditRow(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      await refetch();
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  // Clasificación Masiva — descripciones disponibles (sin categoría, efectivo)
  const masivaGroupedDescs = useMemo(() => {
    let rows = transactions.filter((t) => !t.categoryId && t.description);
    if (masivaDateFrom && masivaDateTo) {
      rows = rows.filter((t) => {
        const d = String(t.transactionDate ?? "").slice(0, 10);
        return d >= masivaDateFrom && d <= masivaDateTo;
      });
    }
    if (masivaLocalId) {
      const lid = parseInt(masivaLocalId, 10);
      rows = rows.filter((t) => t.localId === lid);
    }
    const map = new Map<string, number>();
    for (const t of rows) map.set(t.description!, (map.get(t.description!) || 0) + 1);
    return Array.from(map.entries()).map(([description, count]) => ({ description, count })).sort((a, b) => b.count - a.count);
  }, [transactions, masivaDateFrom, masivaDateTo, masivaLocalId]);

  const masivaFilteredDescs = useMemo(() => {
    const q = masivaDescSearch.trim().toLowerCase();
    if (!q) return masivaGroupedDescs;
    return masivaGroupedDescs.filter((g) => g.description.toLowerCase().includes(q));
  }, [masivaGroupedDescs, masivaDescSearch]);

  const masivaMutation = useMutation({
    mutationFn: async () => {
      if (!masivaCategoryId) throw new Error("Elegí una categoría");
      const body: Record<string, any> = {
        categoryId: parseInt(masivaCategoryId, 10),
        bankSource: "cash",
      };
      if (masivaNewLocalId) body.localId = parseInt(masivaNewLocalId, 10);
      if (masivaDateFrom && masivaDateTo) { body.dateFrom = masivaDateFrom; body.dateTo = masivaDateTo; }
      const descs = Array.from(masivaSelectedDescs);
      if (descs.length > 0) body.descriptions = descs;
      const res = await apiRequest("POST", "/api/transactions/batch-categorize", body);
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: `${r.updated ?? 0} movimiento(s) categorizados` });
      setIsMasivaOpen(false);
      setMasivaDateFrom(""); setMasivaDateTo(""); setMasivaLocalId(""); setMasivaDescSearch("");
      setMasivaSelectedDescs(new Set()); setMasivaCategoryId(""); setMasivaNewLocalId("");
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      refetch();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/transactions/${id}`);
    },
    onSuccess: async () => {
      toast({ title: "Movimiento eliminado" });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      await refetch();
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const openEdit = (row: TransactionWithRelations) => {
    setEditRow(row);
    const ds = String(row.transactionDate ?? "").slice(0, 10);
    setEditTransactionDate(/^\d{4}-\d{2}-\d{2}$/.test(ds) ? ds : "");
    setEditDescription(row.description ?? "");
    setEditType(row.type === "expense" ? "expense" : "income");
    setEditAmount(formatNumber(Math.abs(parseFloat(String(row.amount) || "0")), 2));
    setEditCategoryId(row.categoryId != null ? String(row.categoryId) : "");
    setEditLocalId(row.localId != null ? String(row.localId) : "none");
  };

  const columns: Column<TransactionWithRelations>[] = [
    {
      key: "transactionDate",
      header: "Fecha",
      cell: (row) => formatDate(row.transactionDate),
    },
    {
      key: "description",
      header: "Descripción",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full ${
              row.type === "income" ? "bg-green-500/10" : "bg-red-500/10"
            }`}
          >
            {row.type === "income" ? (
              <ArrowUpRight className="h-3 w-3 text-green-600" />
            ) : (
              <ArrowDownRight className="h-3 w-3 text-red-600" />
            )}
          </div>
          <span className="truncate max-w-md">{row.description || "—"}</span>
        </div>
      ),
    },
    {
      key: "local",
      header: "Local",
      cell: (row) => <span className="text-sm">{row.local?.name ?? "—"}</span>,
    },
    {
      key: "category",
      header: "Categoría",
      cell: (row) =>
        row.category ? (
          <Badge variant="secondary" className="truncate max-w-40">
            {row.category.name}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Sin categoría
          </Badge>
        ),
    },
    {
      key: "amount",
      header: "Monto",
      className: "text-right",
      cell: (row) => (
        <span className={`font-mono font-medium ${row.type === "income" ? "text-green-600" : "text-red-600"}`}>
          {row.type === "income" ? "+" : "-"}
          {formatCurrency(Math.abs(parseFloat(String(row.amount) || "0")))}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Acciones",
      className:
        "sticky right-0 z-10 bg-background border-l border-border shadow-[inset_-6px_0_8px_-8px_rgb(0_0_0/0.12)] whitespace-nowrap w-[1%]",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1 pr-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Editar movimiento"
            className="h-8 gap-1 px-2"
            onClick={() => openEdit(row)}
          >
            <Pencil className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Editar</span>
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            title="Eliminar"
            onClick={() => setDeleteTarget(row)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  const categoriasForType = (t: "income" | "expense") =>
    t === "income" ? incomeCategories : expenseCategories;

  const listEmptyMessage = useMemo(
    () =>
      transactions.length === 0
        ? "No hay movimientos en efectivo registrados."
        : "Ningún movimiento coincide con los filtros.",
    [transactions.length],
  );

  const clearFilters = () => {
    setFilterSearch("");
    setFilterType("all");
    setFilterLocalId("all");
    setFilterCategoryId("all");
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  const filtersActive =
    filterSearch.trim() !== "" ||
    filterType !== "all" ||
    filterLocalId !== "all" ||
    filterCategoryId !== "all" ||
    filterDateFrom !== "" ||
    filterDateTo !== "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Efectivo"
        description="Movimientos de caja cargados manualmente; mismas categorías que en extractos."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={exportToExcel} disabled={filteredTransactions.length === 0} data-testid="button-export-cash">
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
            <Button variant="outline" onClick={() => setIsMasivaOpen(true)} data-testid="button-masiva-cash">
              <Filter className="h-4 w-4 mr-2" />
              Clasificación Masiva
            </Button>
            <Button variant="outline" onClick={openImport} data-testid="button-import-cash">
              <Upload className="h-4 w-4 mr-2" />
              Importar Excel
            </Button>
            <Button onClick={openBatch} data-testid="button-new-cash-batch">
              <Plus className="h-4 w-4 mr-2" />
              Nuevo movimiento en efectivo
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Ingresos</CardTitle>
              {filteredTransactions.length !== transactions.length && (
                <p className="text-xs text-muted-foreground font-normal mt-0.5">Filtrado</p>
              )}
            </div>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-green-600">{formatCurrency(totalIncome)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Promedio</CardTitle>
              <p className="text-xs text-muted-foreground font-normal mt-0.5">Ingreso diario promedio</p>
              {filteredTransactions.length !== transactions.length && (
                <p className="text-xs text-muted-foreground font-normal mt-0.5">Filtrado</p>
              )}
            </div>
            <CalendarDays className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-700">{formatCurrency(dailyIncomeAverage.amount)}</div>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">{dailyIncomeAverage.periodNote}</p>
            {filtersActive && (
              <p className="text-xs text-muted-foreground mt-0.5">Según filtros aplicados</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Egresos</CardTitle>
              {filteredTransactions.length !== transactions.length && (
                <p className="text-xs text-muted-foreground font-normal mt-0.5">Filtrado</p>
              )}
            </div>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-red-600">{formatCurrency(totalExpense)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm font-medium">Saldo</CardTitle>
              <p className="text-xs text-muted-foreground font-normal mt-0.5">
                Ingresos − egresos
                {filteredTransactions.length !== transactions.length ? " · Vista filtrada" : ""}
              </p>
            </div>
            <Scale className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "text-2xl font-bold font-mono",
                saldoFiltered > 0 && "text-green-600",
                saldoFiltered < 0 && "text-red-600",
                saldoFiltered === 0 && "text-muted-foreground",
              )}
            >
              {saldoFiltered > 0 ? "+" : saldoFiltered < 0 ? "−" : ""}
              {formatCurrency(Math.abs(saldoFiltered))}
            </div>
            {filtersActive && (
              <p className="text-xs text-muted-foreground mt-1">Según filtros aplicados</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Movimientos</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredTransactions.length}</div>
            {filtersActive && (
              <p className="text-xs text-muted-foreground mt-1">Según filtros aplicados</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Listado
            </CardTitle>
            {filtersActive && (
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Buscar en descripción</Label>
              <Input
                placeholder="Texto en descripción…"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <DataEntryCombobox
                options={CASH_FILTER_TYPE_OPTIONS}
                value={filterType}
                onValueChange={(v) => setFilterType(v as "all" | "income" | "expense")}
                placeholder="Tipo"
                searchPlaceholder="Buscar…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Local</Label>
              <FilterSearchableSelect
                value={filterLocalId}
                onChange={setFilterLocalId}
                allLabel="Todos los locales"
                items={localFiltersItems}
                searchPlaceholder="Buscar local…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoría</Label>
              <FilterSearchableSelect
                value={filterCategoryId}
                onChange={setFilterCategoryId}
                allLabel="Todas las categorías"
                items={categoryFiltersItems}
                searchPlaceholder="Buscar categoría…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Período</Label>
              <DateRangePicker from={filterDateFrom} to={filterDateTo} onChange={(f, t) => { setFilterDateFrom(f); setFilterDateTo(t); }} />
            </div>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <DataTable
              columns={columns}
              data={filteredTransactions}
              pageSize={25}
              showSearch={false}
              emptyMessage={listEmptyMessage}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Nuevo movimiento en efectivo</DialogTitle>
            <DialogDescription>
              Podés agregar varias filas y guardarlas todas en una sola operación.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[min(50vh,520px)] w-full pr-3 border rounded-md">
            <div className="space-y-4 p-3">
              {draftRows.map((r) => (
                <div
                  key={r.key}
                  className={cn(
                    "grid gap-3 md:grid-cols-12 border rounded-md p-3 relative",
                    r.key === CASH_ADJUST_KEY ? "bg-amber-50 border-amber-300" : "bg-muted/30",
                  )}
                >
                  {r.key === CASH_ADJUST_KEY && (
                    <div className="md:col-span-12">
                      <Badge variant="secondary">Ajuste automático por diferencia de caja</Badge>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-7 w-7"
                    disabled={draftRows.length <= 1}
                    onClick={() => removeDraftRow(r.key)}
                    title="Quitar fila"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <div className="md:col-span-3 space-y-1">
                    <Label className="text-xs">Fecha</Label>
                    <Input
                      type="date"
                      value={r.transactionDate}
                      onChange={(e) => patchDraft(r.key, { transactionDate: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-4 space-y-1">
                    <Label className="text-xs">Descripción</Label>
                    <Input
                      placeholder="Ej. Pago a Sebastian Mantenimiento"
                      value={r.description}
                      onChange={(e) => patchDraft(r.key, { description: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs">Tipo</Label>
                    <DataEntryCombobox
                      options={CASH_MOVEMENT_TYPE_OPTIONS}
                      value={r.type}
                      onValueChange={(v) =>
                        patchDraft(r.key, {
                          type: v as "income" | "expense",
                          categoryId: "",
                        })
                      }
                      placeholder="Tipo"
                      searchPlaceholder="Buscar…"
                    />
                  </div>
                  <div className="md:col-span-3 space-y-1">
                    <Label className="text-xs">Importe</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0,00"
                      className="font-mono"
                      value={r.amount}
                      onChange={(e) =>
                        patchDraft(r.key, { amount: formatEsArAmountInput(e.target.value) })
                      }
                    />
                  </div>
                  <div className="md:col-span-6 space-y-1">
                    <Label className="text-xs">Categoría (opcional)</Label>
                    <GroupedCategoryPicker
                      value={r.categoryId}
                      onChange={(id) => patchDraft(r.key, { categoryId: id })}
                      categories={allCategoriesSorted}
                      financialGroups={financialGroups}
                      allowClear
                    />
                  </div>
                  <div className="md:col-span-6 space-y-1">
                    <Label className="text-xs">Local</Label>
                    <DataEntryCombobox
                      options={cashLocalPickComboOptions}
                      value={r.localId}
                      onValueChange={(v) => patchDraft(r.key, { localId: v })}
                      placeholder="Opcional"
                      searchPlaceholder="Buscar local…"
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="flex gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={addDraftRow}>
              <Plus className="h-4 w-4 mr-2" />
              Agregar otra fila
            </Button>
          </div>

          <div className="border-t pt-3 space-y-2">
            <Label className="text-sm">Cuadre de caja (opcional)</Label>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Neto recibido</Label>
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  className="font-mono w-40"
                  value={netoRecibido}
                  onChange={(e) => setNetoRecibido(formatEsArAmountInput(e.target.value))}
                  data-testid="input-neto-recibido"
                />
              </div>
              <div className="text-sm space-y-0.5">
                <div className="text-muted-foreground">
                  Esperado (ingresos − egresos):{" "}
                  <span className="font-mono text-foreground">{formatCurrency(cuadreEsperado)}</span>
                </div>
                {cuadreDiff != null && (
                  <div className="flex items-center gap-2">
                    <span>Diferencia:</span>
                    <span className={cn("font-mono", cuadreDiff < 0 ? "text-destructive" : cuadreDiff > 0 ? "text-green-600" : "")}>
                      {formatCurrency(cuadreDiff)}
                    </span>
                    {Math.abs(cuadreDiff) < 0.005 ? (
                      <Badge variant="secondary">Cuadra</Badge>
                    ) : cuadreDiff < 0 ? (
                      <Badge variant="destructive">Faltante</Badge>
                    ) : (
                      <Badge variant="default">Sobrante</Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
            {cuadreCatMissing && cuadreDiff != null && (
              <p className="text-xs text-destructive">
                No encontré la categoría «{cuadreDiff < 0 ? CASH_ADJUST_FALTANTE : CASH_ADJUST_SOBRANTE}» en este cliente.
                Creala para poder imputar la diferencia.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitBatch} disabled={saveBatchMutation.isPending}>
              {saveBatchMutation.isPending ? "Guardando…" : "Guardar todos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar movimiento en efectivo</DialogTitle>
            <DialogDescription>
              Podés corregir fecha, descripción, tipo, importe, categoría y local. Solo aplica a movimientos cargados como efectivo.
            </DialogDescription>
          </DialogHeader>
          {editRow && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={editTransactionDate}
                  onChange={(e) => setEditTransactionDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Descripción</Label>
                <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Concepto…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <DataEntryCombobox
                    options={CASH_MOVEMENT_TYPE_OPTIONS}
                    value={editType}
                    onValueChange={(v) => {
                      const nt = v as "income" | "expense";
                      setEditType(nt);
                      setEditCategoryId("");
                    }}
                    placeholder="Tipo"
                    searchPlaceholder="Buscar…"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Importe</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    className="font-mono"
                    value={editAmount}
                    onChange={(e) => setEditAmount(formatEsArAmountInput(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Categoría (opcional)</Label>
                <GroupedCategoryPicker
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  categories={allCategoriesSorted}
                  financialGroups={financialGroups}
                  allowClear
                />
              </div>
              <div className="space-y-1">
                <Label>Local</Label>
                <DataEntryCombobox
                  options={cashLocalPickComboOptions}
                  value={editLocalId}
                  onValueChange={setEditLocalId}
                  placeholder="Local"
                  searchPlaceholder="Buscar local…"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>
              Cancelar
            </Button>
            <Button onClick={() => patchMutation.mutate()} disabled={patchMutation.isPending}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isMasivaOpen} onOpenChange={(o) => {
        setIsMasivaOpen(o);
        if (!o) {
          setMasivaDateFrom(""); setMasivaDateTo(""); setMasivaLocalId(""); setMasivaDescSearch("");
          setMasivaSelectedDescs(new Set()); setMasivaCategoryId(""); setMasivaNewLocalId("");
        }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[min(90vh,880px)] h-[min(90vh,880px)] flex flex-col gap-0 p-0 overflow-hidden sm:rounded-lg">
          <div className="px-6 pt-6 pb-2 pr-12 shrink-0 border-b border-border/50">
            <DialogHeader>
              <DialogTitle>Clasificación Masiva — Efectivo</DialogTitle>
              <DialogDescription>Filtrá por período, local y descripción; asigná categoría a todos los movimientos sin categorizar que coincidan.</DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4 space-y-4">
            <div className="grid gap-3 p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">1. Filtros (opcionales)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Desde</Label>
                  <Input type="date" value={masivaDateFrom} onChange={(e) => { setMasivaDateFrom(e.target.value); setMasivaSelectedDescs(new Set()); }} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Hasta</Label>
                  <Input type="date" value={masivaDateTo} onChange={(e) => { setMasivaDateTo(e.target.value); setMasivaSelectedDescs(new Set()); }} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Local</Label>
                <FilterSearchableSelect
                  value={masivaLocalId || "all"}
                  onChange={(v) => { setMasivaLocalId(v === "all" ? "" : v); setMasivaSelectedDescs(new Set()); }}
                  allLabel="Todos los locales"
                  items={localFiltersItems}
                  searchPlaceholder="Buscar local…"
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">2. Descripciones (opcional — podés elegir varias)</p>
              {masivaGroupedDescs.length > 0 && (
                <Input placeholder="Buscar en descripciones…" value={masivaDescSearch} onChange={(e) => setMasivaDescSearch(e.target.value)} className="max-w-md" />
              )}
              {masivaGroupedDescs.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground rounded-lg bg-muted/50">No hay movimientos sin categorizar</div>
              ) : masivaFilteredDescs.length === 0 ? (
                <div className="text-center py-3 text-sm text-muted-foreground rounded-lg bg-muted/50">Ninguna descripción coincide</div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1 rounded-md border bg-muted/20 p-1">
                  {masivaFilteredDescs.map((g) => {
                    const sel = masivaSelectedDescs.has(g.description);
                    return (
                      <div key={g.description}
                        className={`flex items-center justify-between gap-3 p-2 rounded-lg cursor-pointer transition-colors ${sel ? "bg-primary/10 border border-primary/30" : "bg-muted/50 hover:bg-muted"}`}
                        onClick={() => {
                          setMasivaSelectedDescs((prev) => {
                            const n = new Set(prev);
                            if (n.has(g.description)) n.delete(g.description); else n.add(g.description);
                            return n;
                          });
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`h-4 w-4 shrink-0 rounded border ${sel ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                            {sel && <Check className="h-3 w-3 text-primary-foreground m-0.5" />}
                          </div>
                          <p className="text-sm truncate">{g.description}</p>
                        </div>
                        <Badge variant="secondary">{g.count} mov.</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              {masivaSelectedDescs.size > 0 && (
                <p className="text-xs text-muted-foreground">{masivaSelectedDescs.size} descripción(es) seleccionada(s)</p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">3. Categoría a asignar</p>
              <GroupedCategoryPicker
                value={masivaCategoryId}
                onChange={setMasivaCategoryId}
                categories={allCategoriesSorted}
                financialGroups={financialGroups}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">4. Local a asignar (opcional)</p>
              <FilterSearchableSelect
                value={masivaNewLocalId || "all"}
                onChange={(v) => setMasivaNewLocalId(v === "all" ? "" : v)}
                allLabel="No cambiar local"
                items={localFiltersItems}
                searchPlaceholder="Buscar local…"
              />
            </div>
          </div>
          <div className="px-6 py-4 border-t shrink-0">
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsMasivaOpen(false)}>Cancelar</Button>
              <Button
                disabled={!masivaCategoryId || masivaMutation.isPending}
                onClick={() => masivaMutation.mutate()}
              >
                {masivaMutation.isPending ? "Clasificando…" : "Clasificar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar movimiento</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. ¿Eliminar el movimiento en efectivo seleccionado?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Eliminar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Importar efectivo desde Excel</DialogTitle>
            <DialogDescription>
              Elegí el local, descargá la plantilla si querés, y subí el archivo. Columnas:
              Fecha, Descripción, Tipo (Ingreso/Egreso), Importe, Categoría. La categoría se
              busca por nombre. Todos los movimientos se cargan en el local elegido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Local (obligatorio)</Label>
                <DataEntryCombobox
                  options={importLocalOptions}
                  value={importLocalId}
                  onValueChange={setImportLocalId}
                  placeholder="Elegí el local"
                  searchPlaceholder="Buscar local…"
                  data-testid="select-import-local"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Plantilla</Label>
                <Button variant="outline" className="w-full justify-start" onClick={downloadTemplate}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Descargar plantilla
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Archivo (.xlsx)</Label>
              <Input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xls"
                disabled={!importLocalId}
                onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
                data-testid="input-import-file"
              />
              {!importLocalId && <p className="text-xs text-muted-foreground">Elegí primero el local para habilitar la carga.</p>}
              {importFileName && <p className="text-xs text-muted-foreground">Archivo: {importFileName}</p>}
            </div>

            {importRows.length > 0 && (
              <>
                <div className="text-sm">
                  <Badge variant="default" className="mr-2">{importValidRows.length} válido(s)</Badge>
                  {importErrorRows.length > 0 && <Badge variant="destructive">{importErrorRows.length} con error</Badge>}
                </div>
                <div className="rounded-md border overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80">
                      <tr>
                        <th className="px-2 py-1 text-left font-medium border-b">Fila</th>
                        <th className="px-2 py-1 text-left font-medium border-b">Fecha</th>
                        <th className="px-2 py-1 text-left font-medium border-b">Descripción</th>
                        <th className="px-2 py-1 text-left font-medium border-b">Tipo</th>
                        <th className="px-2 py-1 text-right font-medium border-b">Importe</th>
                        <th className="px-2 py-1 text-left font-medium border-b">Categoría</th>
                        <th className="px-2 py-1 text-left font-medium border-b">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.map((r) => (
                        <tr key={r.idx} className={cn("border-b", r.error && "bg-destructive/5")}>
                          <td className="px-2 py-1 text-muted-foreground">{r.idx}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{r.transactionDate ?? "—"}</td>
                          <td className="px-2 py-1 max-w-[180px] truncate">{r.description || "—"}</td>
                          <td className="px-2 py-1">{r.type === "income" ? "Ingreso" : r.type === "expense" ? "Egreso" : "—"}</td>
                          <td className="px-2 py-1 text-right font-mono">{Number.isFinite(r.amount) ? formatCurrency(r.amount) : "—"}</td>
                          <td className="px-2 py-1 max-w-[140px] truncate">{r.categoryName || "—"}</td>
                          <td className="px-2 py-1">
                            {r.error ? (
                              <span className="text-destructive">{r.error}</span>
                            ) : (
                              <span className="text-green-600 inline-flex items-center gap-1"><Check className="h-3 w-3" /> OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || !importLocalId || importValidRows.length === 0}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? "Importando…" : `Importar ${importValidRows.length} movimiento(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
