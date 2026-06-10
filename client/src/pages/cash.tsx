import { useMemo, useState, useCallback, useRef } from "react";
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
import { formatCurrency, formatDate, formatEsArAmountInput, formatNumber, parseEsArAmount } from "@/lib/formatters";
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
} from "lucide-react";
import type { Transaction, BankAccount, TransactionCategory, Local } from "@shared/schema";

interface TransactionWithRelations extends Transaction {
  bankAccount?: BankAccount | null;
  category?: TransactionCategory | null;
  local?: Local | null;
}

const CASH_BANK_SOURCE = "cash";

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
          categoryId: parseInt(r.categoryId, 10),
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
    const prepared = draftRows.filter((r) => r.description.trim() !== "" && r.categoryId !== "" && r.amount !== "");
    if (prepared.length === 0) {
      toast({
        title: "Completá al menos un movimiento",
        description: "Descripción, categoría e importe son obligatorios.",
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
      if (editCategoryId === "") {
        throw new Error("Elegí una categoría");
      }
      await apiRequest("PATCH", `/api/transactions/${editRow.id}`, {
        transactionDate: editTransactionDate.trim(),
        description: desc,
        type: editType,
        amount: amt,
        categoryId: parseInt(editCategoryId, 10),
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
          <Button onClick={openBatch} data-testid="button-new-cash-batch">
            <Plus className="h-4 w-4 mr-2" />
            Nuevo movimiento en efectivo
          </Button>
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
                  className="grid gap-3 md:grid-cols-12 border rounded-md p-3 bg-muted/30 relative"
                >
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
                    <Label className="text-xs">Categoría</Label>
                    <CategoryPicker
                      value={r.categoryId}
                      onChange={(id) => patchDraft(r.key, { categoryId: id })}
                      categories={categoriasForType(r.type)}
                      placeholder="Elegir categoría…"
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
                <Label>Categoría</Label>
                <CategoryPicker
                  value={editCategoryId}
                  onChange={setEditCategoryId}
                  categories={categoriasForType(editType)}
                  placeholder="Elegir categoría…"
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
    </div>
  );
}
