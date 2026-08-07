import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { InternalLoanButton } from "@/components/internal-loan-button";
import { SplitLocalsButton } from "@/components/split-locals-button";
import { EconomicMonthCell, EconomicMonthHeader } from "@/components/economic-month-cell";
import { EconomicMonthBulkDialog } from "@/components/economic-month-bulk-dialog";
import { resolveEconomicMonth, economicMonthLabelWithYear, economicMonthRange } from "@shared/economicMonth";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateRangePicker } from "@/components/date-range-picker";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
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
import { formatCurrency, formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { GenericBankMappingDialog } from "@/components/generic-bank-mapping-dialog";
import {
  Upload,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  Tag,
  CheckCircle,
  AlertCircle,
  Percent,
  ListChecks,
  Plus,
  Trash2,
  Landmark,
  Eraser,
  ChevronsUpDown,
  Check,
  Filter,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toISODate } from "@/lib/dateHelpers";
import type {
  Transaction,
  BankAccount,
  TransactionCategory,
  Local,
  LocalAlias,
  FinancialGroup,
} from "@shared/schema";
import type { BusinessName } from "@shared/schema";

interface TransactionWithRelations extends Transaction {
  bankAccount?: BankAccount | null;
  category?: TransactionCategory | null;
  local?: Local | null;
}

interface BranchMapping {
  alias: string;
  localId: number | null;
}

type FilterTab = "all" | "uncategorized" | "categorized";

/** Pestañas de banco siempre visibles (orden fijo), aunque el contador sea 0. */
const PINNED_BANK_TAB_IDS = ["galicia", "mercadopago", "frances", "bbva"];

interface AvailableBank {
  id: string;
  name: string;
}

interface ImportBatch {
  importBatchId: string;
  bankSource: string | null;
  count: number;
  minDate: string | null;
  maxDate: string | null;
  importedAt: string | null;
  bankAccountId?: number | null;
  bankAccountName?: string | null;
  openingBalance?: string | null;
  closingBalance?: string | null;
}

type BankAccountWithLocal = BankAccount & {
  local?: { id: number; name: string } | null;
};

interface MpReconciliationRow {
  excelRow: number;
  description: string;
  description2?: string;
  date?: string | null;
  montoBrutoActual: number;
}

interface MpReconciliationPayload {
  message: string;
  saldoDisponibleTotal: number;
  /** Suma algebraica ingresos − egresos de todas las líneas a importar (incl. comisión, impuesto, ajustes). */
  sumNetImportable: number;
  /** Suma de columna H solo en filas con línea bruta (informativo). */
  sumGrossImportable: number;
  delta: number;
  rows: MpReconciliationRow[];
}

function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

/** Filtro de listado: opción "todos" + lista con búsqueda (cmdk). */
function FilterSearchableSelect({
  value,
  onChange,
  allLabel,
  items,
  searchPlaceholder,
  extraOptions = [],
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  items: { id: number; name: string }[];
  searchPlaceholder: string;
  /** Opciones especiales con value no numérico (ej. "Sin local"). Se muestran arriba de la lista. */
  extraOptions?: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const extraSelected = extraOptions.find((o) => o.value === value);
  const selected = value === "all" ? null : items.find((x) => String(x.id) === value);
  const label = extraSelected?.label ?? selected?.name ?? allLabel;
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
              {extraOptions.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`__extra__ ${opt.label}`}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")} />
                  {opt.label}
                </CommandItem>
              ))}
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.name} ${item.id}`}
                  onSelect={() => {
                    onChange(String(item.id));
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === String(item.id) ? "opacity-100" : "opacity-0",
                    )}
                  />
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

function BatchCategoryCombobox({
  categories,
  financialGroups = [],
  value,
  onChange,
  placeholder = "Seleccionar categoria...",
}: {
  categories: TransactionCategory[];
  financialGroups?: FinancialGroup[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [groupId, setGroupId] = useState("all");
  const [open, setOpen] = useState(false);
  const [gOpen, setGOpen] = useState(false);

  const active = categories.filter((c) => c.active !== false);
  const visibleCats = groupId === "all" ? active : active.filter((c) => String((c as any).financialGroupId) === groupId);
  const selected = value ? active.find((c) => String(c.id) === value) : undefined;
  const selectedGroup = groupId !== "all" ? financialGroups.find((g) => String(g.id) === groupId) : null;
  const groupOptions = [...financialGroups].filter((g) => g.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));

  return (
    <div className="space-y-2">
      {financialGroups.length > 0 && (
        <Popover open={gOpen} onOpenChange={setGOpen} modal={true}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal min-h-9 text-xs">
              <span className="truncate text-left text-muted-foreground">Grupo: {selectedGroup?.name ?? "Todos"}</span>
              <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(100vw-2rem,24rem)] p-0 z-[200]" align="start">
            <Command>
              <CommandInput placeholder="Buscar grupo…" />
              <CommandList className="max-h-[220px]">
                <CommandEmpty>Sin resultados.</CommandEmpty>
                <CommandGroup>
                  <CommandItem value="__all__ Todos" onSelect={() => { setGroupId("all"); setGOpen(false); }}>
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
      )}
      <Popover open={open} onOpenChange={setOpen} modal={true}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal min-h-9" data-testid="select-batch-category">
            <span className="truncate text-left">{selected ? selected.name : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(100vw-2rem,24rem)] p-0 z-[100]" align="start">
          <Command>
            <CommandInput placeholder="Buscar categoria..." />
            <CommandList className="max-h-[260px]">
              <CommandEmpty>Sin resultados.</CommandEmpty>
              <CommandGroup>
                {visibleCats.map((cat) => (
                  <CommandItem key={cat.id} value={`${cat.name} ${cat.id}`} onSelect={() => { onChange(String(cat.id)); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", value === String(cat.id) ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{cat.name}</span>
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

function BatchLocalCombobox({
  locals,
  value,
  onChange,
}: {
  locals: Local[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const none = !value || value === "none";
  const selected = none ? null : locals.find((l) => String(l.id) === value);
  const label = none ? "Sin asignar" : selected?.name ?? "Sin asignar";
  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal min-h-9"
          data-testid="select-batch-local"
        >
          <span className="truncate text-left">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,24rem)] p-0 z-[100]" align="start">
        <Command>
          <CommandInput placeholder="Buscar local..." />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__sin_asignar__"
                onSelect={() => {
                  onChange("none");
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4 shrink-0", none ? "opacity-100" : "opacity-0")} />
                Sin asignar
              </CommandItem>
              {locals.map((l) => (
                <CommandItem
                  key={l.id}
                  value={`${l.name} ${l.id}`}
                  onSelect={() => {
                    onChange(String(l.id));
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value === String(l.id) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{l.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const BANK_STMT_LIST_FILTER_TYPE_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "income", label: "Ingresos" },
  { value: "expense", label: "Egresos" },
];

export default function BankStatementsPage() {
  const { toast } = useToast();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isCategorizeOpen, setIsCategorizeOpen] = useState(false);
  const [isBatchCategorizeOpen, setIsBatchCategorizeOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<"categorize" | "uncategorize">("categorize");
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionWithRelations | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [batchCategoryId, setBatchCategoryId] = useState<string>("");
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<number>>(new Set());
  const [batchDateFrom, setBatchDateFrom] = useState<string>("");
  const [batchDateTo, setBatchDateTo] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedBankId, setSelectedBankId] = useState<string>("galicia");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [isBranchMappingOpen, setIsBranchMappingOpen] = useState(false);
  const [unmappedBranches, setUnmappedBranches] = useState<string[]>([]);
  const [branchMappings, setBranchMappings] = useState<BranchMapping[]>([]);
  const [selectedDescriptions, setSelectedDescriptions] = useState<Set<string>>(new Set());
  const [selectedDescription2, setSelectedDescription2] = useState<string>("");
  const [selectedLocalId, setSelectedLocalId] = useState<string>("");
  const [batchFilterLocalId, setBatchFilterLocalId] = useState<string>("");
  const [batchLocalId, setBatchLocalId] = useState<string>("");
  const [batchDescSearch, setBatchDescSearch] = useState("");
  const [batchDesc2Search, setBatchDesc2Search] = useState("");
  // Punto 1: filtro por Entidad (banco de origen) dentro de la categorización masiva.
  const [batchBankSource, setBatchBankSource] = useState<string>("");
  const [isDeleteBatchOpen, setIsDeleteBatchOpen] = useState(false);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState<ImportBatch | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");
  const [listFilterLocalId, setListFilterLocalId] = useState<string>("all");
  const [listFilterCategoryId, setListFilterCategoryId] = useState<string>("all");
  const [listFilterGroupId, setListFilterGroupId] = useState<string>("all");
  // Punto 4 (jul-27): filtro por Cuenta (bank_accounts), distinto de la pestaña de Entidad/banco.
  const [listFilterAccountId, setListFilterAccountId] = useState<string>("all");
  const [listFilterDateFrom, setListFilterDateFrom] = useState("");
  const [listFilterDateTo, setListFilterDateTo] = useState("");
  /** Filtro por Mes Económico: "all" o un "YYYY-MM". */
  const [listFilterEconMonth, setListFilterEconMonth] = useState<string>("all");
  const [listFilterType, setListFilterType] = useState<"all" | "income" | "expense">("all");
  const [listSearch, setListSearch] = useState("");
  const [uploadBankAccountId, setUploadBankAccountId] = useState("");
  const [uploadDefaultLocalId, setUploadDefaultLocalId] = useState<string>("none");
  const [uploadOpeningBalance, setUploadOpeningBalance] = useState<string>("");
  const [uploadClosingBalance, setUploadClosingBalance] = useState<string>("");
  const [uploadSkipContinuityCheck, setUploadSkipContinuityCheck] = useState(false);
  const [mpReconciliationOpen, setMpReconciliationOpen] = useState(false);
  const [mpReconciliation, setMpReconciliation] = useState<MpReconciliationPayload | null>(null);
  /** Evita toast de “suspendido” al cerrar el panel tras import OK. */
  const mpSilentDismissRef = useRef(false);
  const mpPanelWasOpenRef = useRef(false);
  const [isAccountsDialogOpen, setIsAccountsDialogOpen] = useState(false);
  const [isGenericMappingOpen, setIsGenericMappingOpen] = useState(false);
  const [purgeAccountTarget, setPurgeAccountTarget] = useState<BankAccountWithLocal | null>(null);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountLocalId, setNewAccountLocalId] = useState<string>("none");
  const [newAccountNumber, setNewAccountNumber] = useState("");
  const [newAccountBusinessNameId, setNewAccountBusinessNameId] = useState<string>("none");
  const [newAccountBankId, setNewAccountBankId] = useState<string>("none");
  const { data: transactions = [],
    isLoading,
    isError: isTransactionsError,
    error: transactionsError,
    refetch: refetchTransactions,
  } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions"],
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
        const qs = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
        if (afterDate !== undefined && afterId !== undefined) {
          qs.set("afterDate", afterDate);
          qs.set("afterId", String(afterId));
        }
        const res = await fetch(`/api/transactions?${qs}`, {
          credentials: "include",
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            res.status === 502 || text.toLowerCase().includes("upstream")
              ? `502: Fallo al cargar una pagina de movimientos. Reintentá; si persiste, puede ser un fallo puntual de Netlify/Turso.`
              : `${res.status}: ${text || res.statusText}`,
          );
        }
        const body = (await res.json()) as
          | TransactionWithRelations[]
          | { items: TransactionWithRelations[]; total: number; page?: number; pageSize: number };

        if (Array.isArray(body)) {
          return body;
        }

        const prevSize = mergedById.size;
        for (const item of body.items) {
          mergedById.set(item.id, item);
        }

        // No usar solo mergedById.size >= total: si total viene bajo (carrera tras import, réplicas, etc.)
        // se dejan de pedir páginas y faltan movimientos → filtros por banco pueden quedar vacíos.
        const noNewIds = body.items.length > 0 && mergedById.size === prevSize;
        if (body.items.length === 0 || body.items.length < PAGE_SIZE || noNewIds) {
          break;
        }
        const last = body.items[body.items.length - 1]!;
        const nextAfter = encodeCursorDate(last.transactionDate);
        if (!nextAfter || last.id == null) {
          break;
        }
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

  const { data: bankAccounts = [] } = useQuery<BankAccountWithLocal[]>({
    queryKey: ["/api/bank-accounts"],
  });

  const { data: categories = [] } = useQuery<TransactionCategory[]>({
    queryKey: ["/api/transaction-categories"],
  });

  const { data: financialGroups = [] } = useQuery<FinancialGroup[]>({
    queryKey: ["/api/financial-groups"],
  });

  const { data: availableBanks = [] } = useQuery<AvailableBank[]>({
    queryKey: ["/api/available-banks"],
  });

  const { data: businessNames = [] } = useQuery<BusinessName[]>({
    queryKey: ["/api/business-names"],
  });

  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const { data: localAliases = [] } = useQuery<LocalAlias[]>({
    queryKey: ["/api/local-aliases"],
  });

  const { data: importBatches = [] } = useQuery<ImportBatch[]>({
    queryKey: ["/api/transactions/import-batches"],
  });

  const effectiveContextAccountId = useMemo(() => {
    const ids = new Set<number>();
    for (const t of transactions) {
      if (bankFilter !== "all" && t.bankSource !== bankFilter) continue;
      const id = (t as TransactionWithRelations).bankAccountId;
      if (typeof id === "number" && Number.isFinite(id)) ids.add(id);
    }
    return ids.size === 1 ? Array.from(ids)[0] : null;
  }, [bankFilter, transactions]);

  const latestContextBatch = useMemo(() => {
    if (!importBatches.length) return null;
    if (effectiveContextAccountId == null) return null;
    const filtered = importBatches.filter((b) => b.bankAccountId === effectiveContextAccountId);
    const byBank =
      bankFilter === "all" ? filtered : filtered.filter((b) => b.bankSource === bankFilter);
    const sorted = [...byBank].sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""));
    return sorted[0] ?? null;
  }, [importBatches, effectiveContextAccountId, bankFilter]);

  const contextOpening = useMemo(() => {
    const v = latestContextBatch?.openingBalance;
    if (v == null || v === "") return null;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }, [latestContextBatch]);

  const contextClosing = useMemo(() => {
    const v = latestContextBatch?.closingBalance;
    if (v == null || v === "") return null;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }, [latestContextBatch]);

  const deleteBatchMutation = useMutation({
    mutationFn: async ({ batchId, confirmCode }: { batchId: string; confirmCode: string }) => {
      return apiRequest(
        "DELETE",
        `/api/transactions/batch/${encodeURIComponent(batchId)}`,
        { confirmCode },
      );
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions/import-batches"] });
      toast({ title: "Extracto eliminado", description: `Se eliminaron ${data.deleted} movimientos` });
      setIsDeleteBatchOpen(false);
      setDeleteBatchTarget(null);
      setDeleteConfirmCode("");
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar extracto", description: error.message, variant: "destructive" });
    },
  });

  const bulkAliasMutation = useMutation({
    mutationFn: async (mappings: { localId: number; alias: string; source: string }[]) => {
      return apiRequest("POST", "/api/local-aliases/bulk", { mappings });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/local-aliases"] });
      toast({ title: "Mapeos guardados", description: "Las sucursales fueron vinculadas correctamente" });
      setIsBranchMappingOpen(false);
      setBranchMappings([]);
      setUnmappedBranches([]);
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar mapeos", description: error.message, variant: "destructive" });
    },
  });

  const createBankAccountMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      accountNumber?: string;
      bankId?: string;
      businessNameId?: number | null;
      localId?: number | null;
    }) => {
      const res = await apiRequest("POST", "/api/bank-accounts", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      toast({ title: "Cuenta creada" });
      setNewAccountName("");
      setNewAccountLocalId("none");
      setNewAccountNumber("");
      setNewAccountBusinessNameId("none");
      setNewAccountBankId("none");
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear cuenta", description: error.message, variant: "destructive" });
    },
  });

  const deleteBankAccountMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/bank-accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      toast({ title: "Cuenta eliminada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar cuenta", description: error.message, variant: "destructive" });
    },
  });

  const purgeBankImportsMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/bank-accounts/${id}/purge-imports`, { confirm: true });
      return res.json() as Promise<{
        success: boolean;
        deletedTransactions: number;
        deletedBatches: number;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions/import-batches"] });
      setPurgeAccountTarget(null);
      toast({
        title: "Extractos vaciados",
        description: `Se eliminaron ${data.deletedTransactions} movimientos importados y ${data.deletedBatches} registros de lotes.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error al vaciar extractos", description: error.message, variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (payload: {
      formData: FormData;
      queryString: string;
      mpGrossOverrides?: Record<string, number>;
    }) => {
      const fd = payload.formData;
      if (payload.mpGrossOverrides && Object.keys(payload.mpGrossOverrides).length > 0) {
        fd.append("mpGrossOverrides", JSON.stringify(payload.mpGrossOverrides));
      }
      const res = await fetch(`/api/transactions/import${payload.queryString}`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        let errorMessage = "Error al importar";
        try {
          const error = JSON.parse(text);
          errorMessage = error.message || errorMessage;
        } catch {
          errorMessage =
            text.includes("upstream") || text.toLowerCase().includes("timeout")
              ? "Timeout del servidor importando el extracto. Probá con un período más chico o avisame y lo pasamos a un proceso en segundo plano."
            : text || errorMessage;
        }
        throw new Error(errorMessage);
      }
      const data = await res.json();

      /** Mercado Pago en producción: cola + Netlify Background Function (evita 504). */
      if (data?.async === true && data.jobToken && data.triggerKey) {
        toast({
          title: "Import en segundo plano",
          description:
            "Mercado Pago: procesando archivo (puede tardar 1–3 min). Esperá sin cerrar la pestaña.",
          duration: 8000,
        });
        if (isLocalDevHost()) {
          await apiRequest("POST", "/api/transactions/import/execute-job", {
            jobToken: data.jobToken,
            triggerKey: data.triggerKey,
          });
        } else {
          const bgRes = await fetch("/.netlify/functions/process-financial-import-background", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobToken: data.jobToken, triggerKey: data.triggerKey }),
          });
          if (!bgRes.ok) {
            const t = await bgRes.text();
            throw new Error(
              t ||
                `No se pudo iniciar el procesamiento en segundo plano (${bgRes.status}). Probá de nuevo.`,
            );
          }
        }

        const deadline = Date.now() + 14 * 60 * 1000;
        let last: {
          status?: string;
          httpStatus?: number;
          payload?: unknown;
          errorMessage?: string;
        } | null = null;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          const pr = await fetch(
            `/api/transactions/import-jobs/${encodeURIComponent(data.jobToken)}`,
            { credentials: "include" },
          );
          if (!pr.ok) {
            const tx = await pr.text();
            throw new Error(tx || "Error al consultar el estado del import");
          }
          last = await pr.json();
          if (last?.status === "done" || last?.status === "failed") break;
        }
        if (!last || (last.status !== "done" && last.status !== "failed")) {
          throw new Error(
            "El import está tardando demasiado. Revisá si los movimientos se cargaron o intentá de nuevo.",
          );
        }
        if (last.status === "failed") {
          const p = last.payload as { message?: string } | undefined;
          throw new Error(
            last.errorMessage ||
              (p && typeof p.message === "string" ? p.message : null) ||
              "Error al importar el extracto",
          );
        }
        const pl = last.payload;
        if (!pl || typeof pl !== "object") {
          throw new Error("Respuesta de import inválida");
        }
        return pl as any;
      }

      return data;
    },
    onSuccess: (data: {
      reconciliationRequired?: boolean;
      skipped?: number;
      imported?: number;
      total?: number;
      bankUsed?: string;
      bankSourceId?: string;
      skippedReasons?: string[];
      batchOpeningBalance?: unknown;
      batchClosingBalance?: unknown;
      message?: string;
      saldoDisponibleTotal?: number;
      sumNetImportable?: number;
      sumGrossImportable?: number;
      delta?: number;
      rows?: MpReconciliationPayload["rows"];
      unmappedBranches?: string[];
      mpDiagnostics?: {
        saldoDisponibleTotalArchivo?: number | null;
        sumNetImportable?: number;
        sumGrossImportable?: number;
      };
    }) => {
      if (data.reconciliationRequired && data.rows && data.message != null) {
        setMpReconciliation({
          message: data.message,
          saldoDisponibleTotal: Number(data.saldoDisponibleTotal ?? 0),
          sumNetImportable: Number(data.sumNetImportable ?? 0),
          sumGrossImportable: Number(data.sumGrossImportable ?? 0),
          delta: Number(data.delta ?? 0),
          rows: data.rows,
        });
        mpPanelWasOpenRef.current = true;
        setMpReconciliationOpen(true);
        return;
      }

      if (mpPanelWasOpenRef.current) {
        mpSilentDismissRef.current = true;
        mpPanelWasOpenRef.current = false;
      }
      setMpReconciliationOpen(false);
      setMpReconciliation(null);

      if (data.bankSourceId) {
        setBankFilter(data.bankSourceId);
      } else {
        setBankFilter("all");
      }

      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions/import-batches"] });
      let description =
        (data.skipped ?? 0) > 0
        ? `Importados: ${data.imported}. Saltados: ${data.skipped}. Total: ${data.total}. Banco: ${data.bankUsed}`
        : `Se importaron ${data.imported} de ${data.total} movimientos usando ${data.bankUsed}`;
      if (data.batchOpeningBalance != null && data.batchOpeningBalance !== "") {
        description += `. Saldo inicial: ${formatCurrency(Number(data.batchOpeningBalance))}`;
      }
      if (data.batchClosingBalance != null && data.batchClosingBalance !== "") {
        description += `. Saldo final: ${formatCurrency(Number(data.batchClosingBalance))}`;
      }

      // Diagnóstico MP (solo aplica si el banco fue Mercado Pago).
      if (data.mpDiagnostics) {
        const d = data.mpDiagnostics;
        const ref =
          d.saldoDisponibleTotalArchivo != null
            ? formatCurrency(Number(d.saldoDisponibleTotalArchivo))
            : "no detectado";
        const sumNet =
          d.sumNetImportable != null ? formatCurrency(Number(d.sumNetImportable)) : "—";
        const sumGross =
          d.sumGrossImportable != null ? formatCurrency(Number(d.sumGrossImportable)) : "—";
        description += `. MP — saldo archivo: ${ref}; suma neta movimientos: ${sumNet}; suma brutos (info): ${sumGross}`;
        console.log("[IMPORT] MP diagnostics:", d);
      }

      if (data.skippedReasons && data.skippedReasons.length > 0 && data.imported === 0) {
        description += `. Razones: ${data.skippedReasons.slice(0, 3).join("; ")}`;
        console.log("[IMPORT] Skip reasons:", data.skippedReasons);
      }
      
      toast({ 
        title: "Importacion completada", 
        description,
        duration: 12000,
      });
      setIsUploadOpen(false);
      setFile(null);
      
      if (data.unmappedBranches && data.unmappedBranches.length > 0) {
        setUnmappedBranches(data.unmappedBranches);
        setBranchMappings(data.unmappedBranches.map((b: string) => ({ alias: b, localId: null })));
        setIsBranchMappingOpen(true);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error al importar", description: error.message, variant: "destructive" });
    },
  });

  const categorizeMutation = useMutation({
    mutationFn: async ({ id, categoryId, localId }: { id: number; categoryId: number | null; localId?: number | null }) => {
      const body: any = { categoryId };
      if (localId !== undefined) body.localId = localId;
      return apiRequest("PATCH", `/api/transactions/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({ title: "Transaccion categorizada" });
      setIsCategorizeOpen(false);
      setSelectedTransaction(null);
      setSelectedCategoryId("");
      setSelectedLocalId("");
    },
    onError: (error: Error) => {
      toast({ title: "Error al categorizar", description: error.message, variant: "destructive" });
    },
  });

  const batchCategorizeMutation = useMutation({
    mutationFn: async (data: {
      transactionIds?: number[];
      categoryId: number | null;
      localId?: number | null;
      dateFrom?: string;
      dateTo?: string;
      description?: string;
      descriptions?: string[];
      description2?: string;
      bankSource?: string;
      mode?: "uncategorize";
    }) => {
      return apiRequest("POST", "/api/transactions/batch-categorize", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({ 
        title: "Clasificacion masiva completada", 
        description: data.message || `Se categorizaron ${data.updated} transacciones`
      });
      setIsBatchCategorizeOpen(false);
      setBatchCategoryId("");
      setBatchLocalId("");
      setSelectedTransactionIds(new Set());
      setBatchDateFrom("");
      setBatchDateTo("");
      setSelectedDescriptions(new Set());
      setSelectedDescription2("");
      setBatchBankSource("");
    },
    onError: (error: Error) => {
      toast({ title: "Error en clasificacion masiva", description: error.message, variant: "destructive" });
    },
  });

  const buildUploadPayload = (
    opts?: { absorbResidual?: boolean },
  ): { formData: FormData; queryString: string } | null => {
    if (!file || !uploadBankAccountId) return null;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("bankAccountId", uploadBankAccountId);
    const uploadAccount = bankAccounts.find((a) => String(a.id) === uploadBankAccountId);
    if (uploadAccount?.bankId && String(uploadAccount.bankId).trim() !== "") {
      formData.append("bankId", String(uploadAccount.bankId).trim());
    }
    if (uploadDefaultLocalId && uploadDefaultLocalId !== "none") {
      formData.append("defaultLocalId", uploadDefaultLocalId);
    }
    if (uploadOpeningBalance.trim()) {
      formData.append("openingBalance", uploadOpeningBalance.trim());
    }
    if (uploadClosingBalance.trim()) {
      formData.append("closingBalance", uploadClosingBalance.trim());
    }
    const qs = new URLSearchParams();
    qs.set("bankAccountId", uploadBankAccountId);
    if (uploadAccount?.bankId && String(uploadAccount.bankId).trim() !== "") {
      qs.set("bankId", String(uploadAccount.bankId).trim());
    }
    if (uploadDefaultLocalId && uploadDefaultLocalId !== "none") {
      qs.set("defaultLocalId", uploadDefaultLocalId);
    }
    if (uploadOpeningBalance.trim()) qs.set("openingBalance", uploadOpeningBalance.trim());
    if (uploadClosingBalance.trim()) qs.set("closingBalance", uploadClosingBalance.trim());
    if (uploadSkipContinuityCheck) {
      formData.append("skipContinuityCheck", "1");
      qs.set("skipContinuityCheck", "1");
    }
    if (opts?.absorbResidual) {
      formData.append("mpAbsorbResidualAsCommission", "1");
      qs.set("mpAbsorbResidualAsCommission", "1");
    }
    return { formData, queryString: `?${qs.toString()}` };
  };

  const handleUpload = () => {
    if (!file) {
      toast({ title: "Seleccione un archivo", variant: "destructive" });
      return;
    }
    if (!uploadBankAccountId) {
      toast({
        title: "Seleccione una cuenta",
        description: "Cada importe debe asociarse a una cuenta o caja registrada.",
        variant: "destructive",
      });
      return;
    }
    const payload = buildUploadPayload();
    if (!payload) return;
    uploadMutation.mutate(payload);
  };

  const handleSuspendMpReconciliation = () => {
    mpPanelWasOpenRef.current = false;
    const silent = mpSilentDismissRef.current;
    mpSilentDismissRef.current = false;
    setMpReconciliationOpen(false);
    setMpReconciliation(null);
    if (!silent) {
      toast({
        title: "Importacion suspendida",
        description: "No se guardo ningun movimiento del extracto.",
        duration: 8000,
      });
    }
  };

  // Reintenta la importación absorbiendo la diferencia de conciliación como una "Comisión Mercado Pago".
  const handleAbsorbResidualAndImport = () => {
    if (!file) {
      toast({ title: "Volvé a seleccionar el archivo", variant: "destructive" });
      return;
    }
    const payload = buildUploadPayload({ absorbResidual: true });
    if (!payload) return;
    mpSilentDismissRef.current = true;
    setMpReconciliationOpen(false);
    uploadMutation.mutate(payload);
  };

  useEffect(() => {
    if (!isUploadOpen || bankAccounts.length === 0) return;
    if (!uploadBankAccountId) {
      setUploadBankAccountId(String(bankAccounts[0].id));
    }
  }, [isUploadOpen, bankAccounts, uploadBankAccountId]);

  const handleCreateAccount = () => {
    if (!newAccountName.trim()) {
      toast({ title: "Indique el nombre de la cuenta", variant: "destructive" });
      return;
    }
    if (!newAccountNumber.trim()) {
      toast({ title: "Indique el número de la cuenta/caja", variant: "destructive" });
      return;
    }
    if (!newAccountBankId || newAccountBankId === "none") {
      toast({ title: "Seleccione la entidad bancaria", variant: "destructive" });
      return;
    }
    if (!newAccountBusinessNameId || newAccountBusinessNameId === "none") {
      toast({ title: "Seleccione la razón social", variant: "destructive" });
      return;
    }
    createBankAccountMutation.mutate({
      name: newAccountName.trim(),
      accountNumber: newAccountNumber.trim(),
      bankId: newAccountBankId,
      businessNameId: parseInt(newAccountBusinessNameId, 10),
      localId: newAccountLocalId === "none" ? null : parseInt(newAccountLocalId, 10),
    });
  };

  const handleCategorize = () => {
    if (!selectedTransaction) return;
    categorizeMutation.mutate({
      id: selectedTransaction.id,
      categoryId: selectedCategoryId && selectedCategoryId !== "none" ? parseInt(selectedCategoryId) : null,
      localId: selectedLocalId && selectedLocalId !== "none" ? parseInt(selectedLocalId) : null,
    });
  };

  const handleBatchCategorize = () => {
    const uncategorize = batchMode === "uncategorize";
    if (!uncategorize && !batchCategoryId) {
      toast({ title: "Seleccione una categoria", variant: "destructive" });
      return;
    }

    const hasSelection = selectedTransactionIds.size > 0;
    const hasDateRange = batchDateFrom && batchDateTo;
    const hasPartialDate = (batchDateFrom && !batchDateTo) || (!batchDateFrom && batchDateTo);
    const hasDescriptions = selectedDescriptions.size > 0;
    const hasDescription2 = !!selectedDescription2.trim();

    if (hasPartialDate) {
      toast({ title: "Complete ambas fechas del periodo", variant: "destructive" });
      return;
    }

    if (!hasSelection && !hasDateRange && !hasDescriptions && !hasDescription2) {
      toast({ title: "Seleccione un filtro: periodo, descripcion o transacciones", variant: "destructive" });
      return;
    }

    // Punto 2 (jul-27): SOLO tocar el local si el usuario eligió uno explícitamente.
    // Si deja "Sin asignar" (default), NO se envía localId → el backend no pisa el local
    // previo de los movimientos (antes mandaba null y los dejaba sin local).
    const localSelected = !!batchLocalId && batchLocalId !== "none";

    batchCategorizeMutation.mutate({
      ...(hasDescriptions ? { descriptions: Array.from(selectedDescriptions) } : {}),
      ...(hasDescription2 ? { description2: selectedDescription2 } : {}),
      ...(batchBankSource ? { bankSource: batchBankSource } : {}),
      ...(hasSelection ? { transactionIds: Array.from(selectedTransactionIds) } : {}),
      ...(uncategorize ? { mode: "uncategorize" as const } : {}),
      categoryId: uncategorize ? null : parseInt(batchCategoryId),
      ...(!uncategorize && localSelected ? { localId: parseInt(batchLocalId) } : {}),
      dateFrom: hasDateRange ? batchDateFrom : undefined,
      dateTo: hasDateRange ? batchDateTo : undefined,
    });
  };

  // Categorizar → filtra sin categoría; Descategorizar → filtra con categoría.
  const batchMatchesCategoryState = (hasCategory: boolean) =>
    batchMode === "uncategorize" ? hasCategory : !hasCategory;

  const groupedDescriptions = useMemo(() => {
    let base = transactions.filter(t => batchMatchesCategoryState(Boolean(t.categoryId)) && t.description);
    if (batchDateFrom && batchDateTo) {
      base = base.filter(t => {
        const d = t.transactionDate ? String(t.transactionDate).slice(0, 10) : "";
        return d >= batchDateFrom && d <= batchDateTo;
      });
    }
    if (batchFilterLocalId) {
      const lid = parseInt(batchFilterLocalId, 10);
      base = base.filter(t => t.localId === lid);
    }
    // Punto 1: acotar por Entidad (banco de origen).
    if (batchBankSource) {
      base = base.filter((t) => t.bankSource === batchBankSource);
    }
    const groups = new Map<string, number>();
    for (const t of base) {
      const desc = t.description || "";
      groups.set(desc, (groups.get(desc) || 0) + 1);
    }
    return Array.from(groups.entries())
      .map(([description, count]) => ({ description, count }))
      .sort((a, b) => b.count - a.count);
  }, [transactions, batchMode, batchDateFrom, batchDateTo, batchFilterLocalId, batchBankSource]);

  const groupedDescriptions2 = useMemo(() => {
    let base = transactions.filter(
      (t) => batchMatchesCategoryState(Boolean(t.categoryId)) && (t.description2 && String(t.description2).trim()),
    );
    if (batchDateFrom && batchDateTo) {
      base = base.filter((t) => {
        const d = t.transactionDate ? String(t.transactionDate).slice(0, 10) : "";
        return d >= batchDateFrom && d <= batchDateTo;
      });
    }
    // Punto 1: acotar por Entidad (banco de origen).
    if (batchBankSource) {
      base = base.filter((t) => t.bankSource === batchBankSource);
    }
    // Punto 3/8: la Descripción 2 se acota a la Descripción 1. Si hay descripciones
    // seleccionadas, usa esas; si no, se acota a medida que se ESCRIBE en el buscador
    // de Descripción 1 (para que D2 muestre solo las descripciones 2 que corresponden).
    if (selectedDescriptions.size > 0) {
      base = base.filter((t) => selectedDescriptions.has(t.description ?? ""));
    } else {
      const q = batchDescSearch.trim().toLowerCase();
      if (q) base = base.filter((t) => String(t.description ?? "").toLowerCase().includes(q));
    }
    const groups = new Map<string, number>();
    for (const t of base) {
      const desc = String(t.description2 || "").trim();
      groups.set(desc, (groups.get(desc) || 0) + 1);
    }
    return Array.from(groups.entries())
      .map(([description2, count]) => ({ description2, count }))
      .sort((a, b) => b.count - a.count);
  }, [transactions, batchMode, batchDateFrom, batchDateTo, selectedDescriptions, batchDescSearch, batchBankSource]);

  const filteredGroupedDescriptions = useMemo(() => {
    const q = batchDescSearch.trim().toLowerCase();
    if (!q) return groupedDescriptions;
    return groupedDescriptions.filter((g) => g.description.toLowerCase().includes(q));
  }, [groupedDescriptions, batchDescSearch]);

  const filteredGroupedDescriptions2 = useMemo(() => {
    const q = batchDesc2Search.trim().toLowerCase();
    if (!q) return groupedDescriptions2;
    return groupedDescriptions2.filter((g) => g.description2.toLowerCase().includes(q));
  }, [groupedDescriptions2, batchDesc2Search]);

  const toggleTransactionSelection = (id: number) => {
    setSelectedTransactionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllSelection = () => {
    if (selectedTransactionIds.size === searchedTransactions.length) {
      setSelectedTransactionIds(new Set());
    } else {
      setSelectedTransactionIds(new Set(searchedTransactions.map((t) => t.id)));
    }
  };

  const openCategorizeDialog = (transaction: TransactionWithRelations) => {
    setSelectedTransaction(transaction);
    setSelectedCategoryId(transaction.categoryId ? String(transaction.categoryId) : "");
    setSelectedLocalId(transaction.localId ? String(transaction.localId) : "");
    setIsCategorizeOpen(true);
  };

  const handleSaveBranchMappings = () => {
    const validMappings = branchMappings
      .filter(m => m.localId !== null)
      .map(m => ({
        localId: m.localId as number,
        alias: m.alias,
        source: selectedBankId,
      }));
    
    if (validMappings.length === 0) {
      toast({ title: "Selecciona al menos un local", variant: "destructive" });
      return;
    }
    
    bulkAliasMutation.mutate(validMappings);
  };

  const updateBranchMapping = (index: number, localId: number | null) => {
    setBranchMappings(prev => prev.map((m, i) => i === index ? { ...m, localId } : m));
  };

  // Métricas GLOBALES (todo el dataset) — para el banner "tenés N sin categorizar".
  const globalCategorizedCount = transactions.filter(t => t.categoryId).length;
  const globalUncategorizedCount = transactions.length - globalCategorizedCount;
  const globalCategorizationPercent = transactions.length > 0
    ? Math.round((globalCategorizedCount / transactions.length) * 100)
    : 0;

  const contextDelta =
    contextOpening != null && contextClosing != null ? contextClosing - contextOpening : null;

  const incomeCategories = categories.filter(c => c.type === "income" || c.type === "both");
  const expenseCategories = categories.filter(c => c.type === "expense" || c.type === "both");

  const banksForTabs = useMemo(() => {
    const fromTx = Array.from(
      new Set(
        transactions.map((t) => t.bankSource).filter((id): id is string => Boolean(id)),
      ),
    );
    const pinned = PINNED_BANK_TAB_IDS.filter((id) =>
      availableBanks.some((b) => b.id === id),
    );
    const rest = fromTx.filter((id) => !pinned.includes(id)).sort();
    return [...pinned, ...rest];
  }, [transactions, availableBanks]);

  const bankFilteredTransactions = bankFilter === "all" 
    ? transactions 
    : transactions.filter(t => t.bankSource === bankFilter);

  const tabFilteredTransactions = useMemo(() => {
    if (filterTab === "all") return bankFilteredTransactions;
    if (filterTab === "uncategorized") {
      return bankFilteredTransactions.filter((t) => !t.categoryId);
    }
    return bankFilteredTransactions.filter((t) => t.categoryId);
  }, [bankFilteredTransactions, filterTab]);

  const categoryFilterItems = useMemo(
    () =>
      [...categories]
        .filter((c) => c.active !== false)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"))
        .map((c) => ({ id: c.id, name: c.name })),
    [categories],
  );

  const localFilterItems = useMemo(
    () =>
      [...locals].sort((a, b) => String(a.name).localeCompare(String(b.name), "es")).map((l) => ({
        id: l.id,
        name: l.name,
      })),
    [locals],
  );

  const groupFilterItems = useMemo(
    () =>
      [...financialGroups]
        .filter((g) => g.active !== false)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"))
        .map((g) => ({ id: g.id, name: g.name })),
    [financialGroups],
  );

  // Punto 4 (jul-27): opciones del filtro por Cuenta (bank_accounts) del listado.
  const accountFilterItems = useMemo(
    () =>
      [...bankAccounts]
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"))
        .map((a) => ({ id: a.id, name: `${a.name}${a.local?.name ? ` · ${a.local.name}` : ""}` })),
    [bankAccounts],
  );

  // categoryId -> financialGroupId, para filtrar por grupo a través de la categoría.
  const categoryGroupMap = useMemo(
    () => new Map(categories.map((c) => [c.id, (c as any).financialGroupId as number | null])),
    [categories],
  );

  const uploadBankAccountComboOptions = useMemo(
    () =>
      bankAccounts.map((a) => ({
        value: String(a.id),
        label: `${a.name}${a.local?.name ? ` · ${a.local.name}` : ""}`,
      })),
    [bankAccounts],
  );

  const uploadDefaultLocalComboOptions = useMemo(
    () => [
      { value: "none", label: "Sin local (asignar luego)" },
      ...locals.map((l) => ({ value: String(l.id), label: l.name })),
    ],
    [locals],
  );

  const newAccountBusinessComboOptions = useMemo(
    () => [
      { value: "none", label: "Seleccionar..." },
      ...businessNames.map((b) => ({ value: String(b.id), label: b.name })),
    ],
    [businessNames],
  );

  const newAccountBankComboOptions = useMemo(
    () => [
      { value: "none", label: "Seleccionar..." },
      ...availableBanks.map((bank) => ({ value: String(bank.id), label: bank.name })),
    ],
    [availableBanks],
  );

  const newAccountLocalComboOptions = useMemo(
    () => [
      { value: "none", label: "Sin local" },
      ...locals.map((l) => ({ value: String(l.id), label: l.name })),
    ],
    [locals],
  );

  const localsSortedForCombo = useMemo(
    () =>
      [...locals].sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
    [locals],
  );

  const localsOnlyComboOptions = useMemo(
    () => localsSortedForCombo.map((l) => ({ value: String(l.id), label: l.name })),
    [localsSortedForCombo],
  );

  const categorizeCategoryComboOptions = useMemo(() => {
    return [
      { value: "none", label: "Sin categoria" },
      ...categories.filter((c) => c.active !== false).map((c) => ({ value: String(c.id), label: c.name })),
    ];
  }, [categories]);

  const transactionLocalPickComboOptions = useMemo(
    () => [
      { value: "none", label: "Sin asignar" },
      ...localsSortedForCombo.map((l) => ({ value: String(l.id), label: l.name })),
    ],
    [localsSortedForCombo],
  );

  const listFiltersActive =
    listFilterLocalId !== "all" ||
    listFilterCategoryId !== "all" ||
    listFilterGroupId !== "all" ||
    listFilterAccountId !== "all" ||
    listFilterType !== "all" ||
    listFilterEconMonth !== "all" ||
    listFilterDateFrom !== "" ||
    listFilterDateTo !== "";

  const clearListFilters = () => {
    setListFilterLocalId("all");
    setListFilterCategoryId("all");
    setListFilterGroupId("all");
    setListFilterAccountId("all");
    setListFilterType("all");
    setListFilterEconMonth("all");
    setListFilterDateFrom("");
    setListFilterDateTo("");
  };

  /**
   * Opciones del filtro por Mes Económico: los meses que realmente existen entre los movimientos
   * cargados (resueltos, o sea contemplando las correcciones a mano), del más nuevo al más viejo.
   */
  const econMonthFilterOptions = useMemo(() => {
    const present = new Set<string>();
    for (const t of transactions) {
      const m = resolveEconomicMonth(t as any);
      if (m) present.add(m);
    }
    return [
      { value: "all", label: "Todos los meses" },
      ...Array.from(present)
        .sort((a, b) => b.localeCompare(a))
        .map((m) => ({ value: m, label: economicMonthLabelWithYear(m) })),
    ];
  }, [transactions]);

  const listFilteredTransactions = useMemo(() => {
    let rows = tabFilteredTransactions;
    if (listFilterLocalId === "none") {
      rows = rows.filter((t) => t.localId == null);
    } else if (listFilterLocalId !== "all") {
      const lid = parseInt(listFilterLocalId, 10);
      if (Number.isFinite(lid)) rows = rows.filter((t) => t.localId === lid);
    }
    if (listFilterCategoryId !== "all") {
      const cid = parseInt(listFilterCategoryId, 10);
      if (Number.isFinite(cid)) rows = rows.filter((t) => t.categoryId === cid);
    }
    if (listFilterGroupId !== "all") {
      const gid = parseInt(listFilterGroupId, 10);
      if (Number.isFinite(gid)) {
        rows = rows.filter((t) => t.categoryId != null && categoryGroupMap.get(t.categoryId) === gid);
      }
    }
    if (listFilterAccountId === "none") {
      rows = rows.filter((t) => (t as TransactionWithRelations).bankAccountId == null);
    } else if (listFilterAccountId !== "all") {
      const aid = parseInt(listFilterAccountId, 10);
      if (Number.isFinite(aid)) rows = rows.filter((t) => (t as TransactionWithRelations).bankAccountId === aid);
    }
    if (listFilterType !== "all") {
      rows = rows.filter((t) => t.type === listFilterType);
    }
    if (listFilterEconMonth !== "all") {
      rows = rows.filter((t) => resolveEconomicMonth(t as any) === listFilterEconMonth);
    }
    if (listFilterDateFrom) {
      rows = rows.filter(
        (t) => String(t.transactionDate ?? "").slice(0, 10) >= listFilterDateFrom,
      );
    }
    if (listFilterDateTo) {
      rows = rows.filter(
        (t) => String(t.transactionDate ?? "").slice(0, 10) <= listFilterDateTo,
      );
    }
    return rows;
  }, [
    tabFilteredTransactions,
    listFilterLocalId,
    listFilterCategoryId,
    listFilterGroupId,
    listFilterAccountId,
    categoryGroupMap,
    listFilterType,
    listFilterEconMonth,
    listFilterDateFrom,
    listFilterDateTo,
  ]);

  // Buscador (descripción, descripción 2 e IMPORTE normalizado). Base de la tabla y de los KPIs superiores.
  const searchedTransactions = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return listFilteredTransactions;
    const qDigits = q.replace(/[^0-9]/g, "");
    return listFilteredTransactions.filter((t) => {
      const desc = String(t.description ?? "").toLowerCase();
      const desc2 = String(t.description2 ?? "").toLowerCase();
      if (desc.includes(q) || desc2.includes(q)) return true;
      if (qDigits.length > 0) {
        const amtDigits = String(Math.abs(parseFloat(String(t.amount) || "0")) || "")
          .replace(/[^0-9]/g, "");
        if (amtDigits.includes(qDigits)) return true;
      }
      return false;
    });
  }, [listFilteredTransactions, listSearch]);

  // Originales divididos: siguen visibles en la tabla pero NO computan en KPIs ni balances.
  const splitParentIds = useMemo(
    () =>
      new Set(
        transactions
          .filter((t) => t.parentTransactionId != null)
          .map((t) => t.parentTransactionId as number),
      ),
    [transactions],
  );

  // KPIs del dashboard superior: reflejan banco + pestaña + filtros del listado + buscador.
  // Se excluyen los originales divididos (para no duplicar con sus partes).
  const kpi = searchedTransactions.filter((t) => !splitParentIds.has(t.id));
  const bankKpiTransactions = bankFilteredTransactions.filter((t) => !splitParentIds.has(t.id));
  const categorizedCount = kpi.filter((t) => t.categoryId).length;
  const uncategorizedCount = kpi.length - categorizedCount;
  const categorizationPercent = kpi.length > 0
    ? Math.round((categorizedCount / kpi.length) * 100)
    : 0;
  // Punto 5 (jul-27): % de movimientos con Local asignado (mismo criterio de vista que el % categorizado).
  const withLocalCount = kpi.filter((t) => t.localId).length;
  const withLocalPercent = kpi.length > 0
    ? Math.round((withLocalCount / kpi.length) * 100)
    : 0;
  const totalIncome = kpi
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0);
  const totalExpense = kpi
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0);
  const balance = totalIncome - totalExpense;
  const categorizedIncome = kpi
    .filter((t) => t.type === "income" && t.categoryId)
    .reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0);
  const categorizedExpense = kpi
    .filter((t) => t.type === "expense" && t.categoryId)
    .reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0);
  // Con filtros/búsqueda activos mostramos el neto calculado; sin filtros, el saldo declarado del extracto (contexto).
  const anyFilterOrSearch =
    listFiltersActive || listSearch.trim() !== "" || bankFilter !== "all" || filterTab !== "all";
  const showDeclaredBalance = contextClosing != null && !anyFilterOrSearch;
  const balanceDisplayValue = showDeclaredBalance ? (contextClosing as number) : balance;

  const columns: Column<TransactionWithRelations>[] = [
    {
      key: "select",
      header: () => (
        <Checkbox
          checked={
            selectedTransactionIds.size === searchedTransactions.length &&
            searchedTransactions.length > 0
          }
          onCheckedChange={toggleAllSelection}
          data-testid="checkbox-select-all"
        />
      ),
      cell: (row) => (
        <Checkbox
          checked={selectedTransactionIds.has(row.id)}
          onCheckedChange={() => toggleTransactionSelection(row.id)}
          onClick={(e) => e.stopPropagation()}
          data-testid={`checkbox-select-${row.id}`}
        />
      ),
    },
    {
      key: "transactionDate",
      header: "Fecha Acreditación",
      cell: (row) => formatDate(row.transactionDate),
    },
    {
      key: "description",
      header: "Descripcion",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-full ${
            row.type === "income" ? "bg-green-500/10" : "bg-red-500/10"
          }`}>
            {row.type === "income" ? (
              <ArrowUpRight className="h-3 w-3 text-green-600" />
            ) : (
              <ArrowDownRight className="h-3 w-3 text-red-600" />
            )}
          </div>
          <span className="truncate max-w-xs">{row.description || "-"}</span>
        </div>
      ),
    },
    {
      key: "description2",
      header: "Descripcion 2",
      cell: (row) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block" title={row.description2 || undefined}>
          {row.description2?.trim() ? row.description2 : "—"}
        </span>
      ),
    },
    {
      key: "bankAccount",
      header: "Cuenta",
      cell: (row) =>
        row.bankAccount ? (
          <span className="text-sm truncate max-w-[140px] block">{row.bankAccount.name}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "category",
      header: "Categoria",
      cell: (row) =>
        row.category ? (
          <Badge variant="secondary" className="truncate max-w-32">
            {row.category.name}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            Sin clasificar
          </Badge>
        ),
    },
    {
      key: "economicMonth",
      header: <EconomicMonthHeader />,
      cell: (row) => <EconomicMonthCell row={row as any} />,
    },
    {
      key: "local",
      header: "Local",
      cell: (row) => (
        <span className="text-sm truncate max-w-[140px] block" title={row.local?.name ?? undefined}>
          {row.local?.name?.trim() ? row.local.name : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Monto",
      className: "text-right",
      cell: (row) => (
        <span className={`font-mono font-medium ${
          row.type === "income" ? "text-green-600" : "text-red-600"
        }`}>
          {row.type === "income" ? "+" : "-"}
          {formatCurrency(Math.abs(parseFloat(String(row.amount) || "0")))}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => openCategorizeDialog(row)}
            data-testid={`button-categorize-${row.id}`}
            title="Categorizar"
          >
            <Tag className="h-4 w-4" />
          </Button>
          {row.parentTransactionId && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Parte
            </Badge>
          )}
          {splitParentIds.has(row.id) && (
            <Badge variant="outline" className="text-xs text-muted-foreground border-amber-500/50">
              Dividido — no computa
            </Badge>
          )}
          <SplitLocalsButton transaction={row} isSplitParent={splitParentIds.has(row.id)} />
          {!splitParentIds.has(row.id) && <InternalLoanButton transaction={row} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Extractos Bancarios"
        description="Importa y gestiona los movimientos de tus cuentas"
        actions={
          <div className="flex flex-wrap gap-2">
            {selectedTransactionIds.size > 0 && (
              <Button
                variant="secondary"
                onClick={() => { setBatchMode("categorize"); setIsBatchCategorizeOpen(true); }}
                data-testid="button-batch-categorize"
              >
                <ListChecks className="h-4 w-4 mr-2" />
                Clasificar {selectedTransactionIds.size} seleccionados
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                const groupNameByGroupId = new Map(financialGroups.map((g) => [g.id, g.name]));
                const catGroupName = (catId: number | null | undefined) => {
                  if (!catId) return "";
                  const cat = categories.find((c) => c.id === catId);
                  if (!cat) return "";
                  return groupNameByGroupId.get((cat as any).financialGroupId) ?? "";
                };
                const rows = searchedTransactions.map((t) => ({
                  Fecha: String(t.transactionDate ?? "").slice(0, 10),
                  Descripción: t.description ?? "",
                  Entidad: t.description2 ?? "",
                  Tipo: t.type === "income" ? "Ingreso" : "Egreso",
                  Importe: parseFloat(String(t.amount)) || 0,
                  Grupo: catGroupName(t.categoryId),
                  Categoría: t.category?.name ?? "",
                  Local: t.local?.name ?? "",
                }));
                const ws = XLSX.utils.json_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Extractos");
                XLSX.writeFile(wb, `extractos_${toISODate(new Date())}.xlsx`);
              }}
              disabled={searchedTransactions.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
            <Button
              variant="outline"
              onClick={() => { setBatchMode("categorize"); setIsBatchCategorizeOpen(true); }}
              data-testid="button-batch-categorize-range"
            >
              <Tag className="h-4 w-4 mr-2" />
              Clasificacion Masiva
            </Button>
            <Button
              variant="outline"
              onClick={() => { setBatchMode("uncategorize"); setIsBatchCategorizeOpen(true); }}
              data-testid="button-batch-uncategorize"
            >
              <ListChecks className="h-4 w-4 mr-2" />
              Descategorizar Masivo
            </Button>
            <EconomicMonthBulkDialog transactions={transactions as any} locals={locals} />
            <Button variant="outline" onClick={() => setIsAccountsDialogOpen(true)} data-testid="button-bank-accounts">
              <Landmark className="h-4 w-4 mr-2" />
              Cuentas
            </Button>
            <Button variant="outline" onClick={() => setIsGenericMappingOpen(true)} data-testid="button-generic-mapping">
              <ListChecks className="h-4 w-4 mr-2" />
              Extracto genérico
            </Button>
            <Button onClick={() => setIsUploadOpen(true)} data-testid="button-import">
              <Upload className="h-4 w-4 mr-2" />
              Importar Excel
            </Button>
          </div>
        }
      />

      <GenericBankMappingDialog
        open={isGenericMappingOpen}
        onOpenChange={setIsGenericMappingOpen}
      />

      {isTransactionsError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex gap-2 items-start min-w-0">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-destructive">No se pudieron cargar los movimientos</p>
                <p className="text-sm text-muted-foreground break-words">
                  {transactionsError instanceof Error ? transactionsError.message : "Error desconocido"}
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => refetchTransactions()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Movimientos</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-total">
              {kpi.length}
            </div>
          </CardContent>
        </Card>

        <Card className={categorizationPercent === 100 ? "border-green-500/50" : "border-amber-500/50"}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Categorizado</CardTitle>
            {categorizationPercent === 100 ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold font-mono ${
                categorizationPercent === 100 ? "text-green-600" : "text-amber-600"
              }`} data-testid="stat-categorized">
                {categorizationPercent}%
              </div>
            </div>
            <Progress 
              value={categorizationPercent} 
              className="mt-2 h-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {categorizedCount} de {kpi.length} movimientos
            </p>
          </CardContent>
        </Card>

        <Card className={withLocalPercent === 100 ? "border-green-500/50" : "border-amber-500/50"}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Con Local</CardTitle>
            {withLocalPercent === 100 ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <div className={`text-2xl font-bold font-mono ${
                withLocalPercent === 100 ? "text-green-600" : "text-amber-600"
              }`} data-testid="stat-with-local">
                {withLocalPercent}%
              </div>
            </div>
            <Progress
              value={withLocalPercent}
              className="mt-2 h-2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {withLocalCount} de {kpi.length} movimientos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Ingresos</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-green-600" data-testid="stat-income">
              {formatCurrency(totalIncome)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Categorizado: {formatCurrency(categorizedIncome)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Egresos</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-red-600" data-testid="stat-expense">
              {formatCurrency(totalExpense)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Categorizado: {formatCurrency(categorizedExpense)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">
              {showDeclaredBalance ? "Saldo final" : "Balance Neto"}
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-mono ${balanceDisplayValue >= 0 ? "text-green-600" : "text-red-600"}`}
              data-testid="stat-balance"
            >
              {formatCurrency(balanceDisplayValue)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {showDeclaredBalance && contextOpening != null ? (
                <>
                  Saldo inicial: {formatCurrency(contextOpening)}
                  {" · "}
                  Variación: {formatCurrency(contextDelta ?? 0)}
                </>
              ) : (
                <>Bruto: {formatCurrency(totalIncome + totalExpense)}</>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {globalCategorizationPercent < 100 && transactions.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div className="flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Tienes {globalUncategorizedCount} movimiento{globalUncategorizedCount !== 1 ? "s" : ""} sin categorizar
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Categoriza todos los movimientos para poder generar reportes precisos.
                </p>
              </div>
              <Button 
                variant="outline" 
                onClick={() => setFilterTab("uncategorized")}
                className="border-amber-500 text-amber-700 hover:bg-amber-500/10"
                data-testid="button-show-uncategorized"
              >
                Ver pendientes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={bankFilter} onValueChange={setBankFilter}>
        <TabsList className="flex-wrap h-auto gap-1 mb-4">
          <TabsTrigger value="all" data-testid="bank-tab-all" className="gap-2">
            Todos
            <Badge variant="secondary" className="text-xs">{transactions.length}</Badge>
          </TabsTrigger>
          {banksForTabs.map((bank) => {
            const bankInfo = availableBanks.find((b) => b.id === bank);
            const bankCount = transactions.filter((t) => t.bankSource === bank).length;
            return (
              <TabsTrigger key={bank} value={bank as string} data-testid={`bank-tab-${bank}`} className="gap-2">
                {bankInfo?.name || bank}
                <Badge variant="secondary" className="text-xs">{bankCount}</Badge>
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="extractos" data-testid="tab-extractos" className="ml-auto">
            Extractos Importados
          </TabsTrigger>
          <TabsTrigger value="breakdown" data-testid="tab-breakdown">
            Desglose
          </TabsTrigger>
        </TabsList>

        {/* Bank-specific content for "all" and each bank */}
        {(bankFilter === "all" ||
          banksForTabs.includes(bankFilter) ||
          PINNED_BANK_TAB_IDS.includes(bankFilter)) && (
          <div className="space-y-4">
            {/* Bank-specific stats */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">
                    Movimientos {bankFilter !== "all" && `(${availableBanks.find(b => b.id === bankFilter)?.name || bankFilter})`}
                  </CardTitle>
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono" data-testid="stat-bank-total">
                    {bankKpiTransactions.length}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Ingresos</CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-green-600" data-testid="stat-bank-income">
                    {formatCurrency(bankKpiTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Egresos</CardTitle>
                  <TrendingDown className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold font-mono text-red-600" data-testid="stat-bank-expense">
                    {formatCurrency(bankKpiTransactions.filter(t => t.type === "expense").reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Balance</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {(() => {
                    const bankIncome = bankKpiTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0);
                    const bankExpense = bankKpiTransactions.filter(t => t.type === "expense").reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0);
                    const bankBalance = bankIncome - bankExpense;
                    return (
                      <div className={`text-2xl font-bold font-mono ${bankBalance >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="stat-bank-balance">
                        {formatCurrency(bankBalance)}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>

            {/* Categorization filter */}
            <div className="flex flex-wrap items-center gap-4">
              <Tabs value={filterTab} onValueChange={(v) => setFilterTab(v as FilterTab)}>
                <TabsList>
                  <TabsTrigger value="all" data-testid="filter-all">
                    Todos ({bankFilteredTransactions.length})
                  </TabsTrigger>
                  <TabsTrigger value="uncategorized" data-testid="filter-uncategorized" className="text-amber-600">
                    Sin categorizar ({bankFilteredTransactions.filter(t => !t.categoryId).length})
                  </TabsTrigger>
                  <TabsTrigger value="categorized" data-testid="filter-categorized">
                    Categorizados ({bankFilteredTransactions.filter(t => t.categoryId).length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filtros del listado
                </p>
                {listFiltersActive && (
                  <Button type="button" variant="outline" size="sm" onClick={clearListFilters}>
                    Limpiar filtros
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Local</Label>
                  <FilterSearchableSelect
                    value={listFilterLocalId}
                    onChange={setListFilterLocalId}
                    allLabel="Todos los locales"
                    items={localFilterItems}
                    searchPlaceholder="Buscar local…"
                    extraOptions={[{ value: "none", label: "Sin local" }]}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Categoría</Label>
                  <FilterSearchableSelect
                    value={listFilterCategoryId}
                    onChange={setListFilterCategoryId}
                    allLabel="Todas las categorías"
                    items={categoryFilterItems}
                    searchPlaceholder="Buscar categoría…"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Grupo Financiero</Label>
                  <FilterSearchableSelect
                    value={listFilterGroupId}
                    onChange={setListFilterGroupId}
                    allLabel="Todos los grupos"
                    items={groupFilterItems}
                    searchPlaceholder="Buscar grupo…"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Cuenta</Label>
                  <FilterSearchableSelect
                    value={listFilterAccountId}
                    onChange={setListFilterAccountId}
                    allLabel="Todas las cuentas"
                    items={accountFilterItems}
                    searchPlaceholder="Buscar cuenta…"
                    extraOptions={[{ value: "none", label: "Sin cuenta" }]}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <DataEntryCombobox
                    options={BANK_STMT_LIST_FILTER_TYPE_OPTIONS}
                    value={listFilterType}
                    onValueChange={(v) => setListFilterType(v as "all" | "income" | "expense")}
                    placeholder="Tipo"
                    searchPlaceholder="Buscar…"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Mes Económico</Label>
                  <DataEntryCombobox
                    options={econMonthFilterOptions}
                    value={listFilterEconMonth}
                    onValueChange={setListFilterEconMonth}
                    placeholder="Todos los meses"
                    searchPlaceholder="Buscar mes…"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Período</Label>
                  <DateRangePicker
                    from={listFilterDateFrom}
                    to={listFilterDateTo}
                    onChange={(f, t) => {
                      setListFilterDateFrom(f);
                      setListFilterDateTo(t);
                    }}
                    placeholder="Todas las fechas"
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <DataTable
              columns={columns}
              data={searchedTransactions}
              isLoading={isLoading}
              searchPlaceholder="Buscar por descripción, entidad o importe..."
              searchKeys={[]}
              search={listSearch}
              onSearchChange={setListSearch}
              emptyMessage={
                filterTab === "uncategorized"
                  ? "No hay movimientos sin categorizar"
                  : listFiltersActive
                    ? "No hay movimientos que coincidan con los filtros del listado."
                    : "No hay movimientos registrados. Importa un extracto bancario en formato Excel."
              }
              pageSize={20}
            />
          </div>
        )}

        <TabsContent value="extractos" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Extractos Importados</CardTitle>
            </CardHeader>
            <CardContent>
              {importBatches.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No hay extractos importados
                </p>
              ) : (
                <div className="space-y-3">
                  {importBatches
                    .sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""))
                    .map((batch) => {
                    const bankInfo = availableBanks.find(b => b.id === batch.bankSource);
                    const openingNum =
                      batch.openingBalance != null && batch.openingBalance !== "" && Number.isFinite(parseFloat(batch.openingBalance))
                        ? parseFloat(batch.openingBalance)
                        : null;
                    const closingNum =
                      batch.closingBalance != null && batch.closingBalance !== "" && Number.isFinite(parseFloat(batch.closingBalance))
                        ? parseFloat(batch.closingBalance)
                        : null;
                    const deltaNum =
                      openingNum != null && closingNum != null ? closingNum - openingNum : null;
                    return (
                      <div key={batch.importBatchId} className="flex items-center justify-between p-3 rounded-lg border" data-testid={`batch-${batch.importBatchId}`}>
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{bankInfo?.name || batch.bankSource || "Desconocido"}</span>
                              <Badge variant="secondary">{batch.count} movimientos</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              Periodo: {batch.minDate ? formatDate(batch.minDate) : "-"} a {batch.maxDate ? formatDate(batch.maxDate) : "-"}
                              {batch.importedAt && (
                                <span className="ml-3">
                                  Importado: {formatDate(batch.importedAt)}
                                </span>
                              )}
                              {batch.bankAccountName && (
                                <span className="ml-3">Cuenta: {batch.bankAccountName}</span>
                              )}
                              {openingNum != null && (
                                <span className="ml-3">Saldo inicial: {formatCurrency(openingNum)}</span>
                              )}
                              {closingNum != null && (
                                <span className="ml-3">Saldo final: {formatCurrency(closingNum)}</span>
                              )}
                              {deltaNum != null && (
                                <span className="ml-3">Variación: {formatCurrency(deltaNum)}</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              const groupNameByGroupId = new Map(financialGroups.map((g) => [g.id, g.name]));
                              const catGroupName = (catId: number | null | undefined) => {
                                if (!catId) return "";
                                const cat = categories.find((c) => c.id === catId);
                                if (!cat) return "";
                                return groupNameByGroupId.get((cat as any).financialGroupId) ?? "";
                              };
                              const batchRows = transactions.filter((t) => t.importBatchId === batch.importBatchId);
                              if (batchRows.length === 0) {
                                toast({ title: "Este extracto no tiene movimientos para exportar", variant: "destructive" });
                                return;
                              }
                              const rows = batchRows.map((t) => ({
                                Fecha: String(t.transactionDate ?? "").slice(0, 10),
                                Descripción: t.description ?? "",
                                Entidad: t.description2 ?? "",
                                Tipo: t.type === "income" ? "Ingreso" : "Egreso",
                                Importe: parseFloat(String(t.amount)) || 0,
                                Grupo: catGroupName(t.categoryId),
                                Categoría: t.category?.name ?? "",
                                Local: t.local?.name ?? "",
                              }));
                              const ws = XLSX.utils.json_to_sheet(rows);
                              const wb = XLSX.utils.book_new();
                              XLSX.utils.book_append_sheet(wb, ws, "Extracto");
                              const label = (bankInfo?.name || batch.bankSource || "extracto").replace(/[^a-z0-9]+/gi, "_");
                              XLSX.writeFile(wb, `extracto_${label}_${toISODate(new Date())}.xlsx`);
                            }}
                            data-testid={`button-export-batch-${batch.importBatchId}`}
                            title="Exportar movimientos de este extracto a Excel"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setDeleteBatchTarget(batch);
                              setDeleteConfirmCode("");
                              setIsDeleteBatchOpen(true);
                            }}
                            data-testid={`button-delete-batch-${batch.importBatchId}`}
                            title="Eliminar extracto completo"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breakdown" className="mt-4">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Desglose de Ingresos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {incomeCategories.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      No hay categorias de ingresos definidas
                    </p>
                  ) : (
                    incomeCategories.map(cat => {
                      const catTotal = transactions
                        .filter(t => t.type === "income" && t.categoryId === cat.id)
                        .reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0);
                      const percent = totalIncome > 0 ? (catTotal / totalIncome) * 100 : 0;
                      
                      return (
                        <div key={cat.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-green-500" />
                            <span className="text-sm">{cat.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground">
                              {percent.toFixed(1)}%
                            </span>
                            <span className="font-mono font-medium text-green-600">
                              {formatCurrency(catTotal)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div className="border-t pt-3 mt-3">
                    <div className="flex items-center justify-between font-medium">
                      <span>Total Ingresos</span>
                      <span className="font-mono text-green-600">{formatCurrency(totalIncome)}</span>
                    </div>
                    {totalIncome - categorizedIncome > 0 && (
                      <div className="flex items-center justify-between text-sm text-amber-600 mt-1">
                        <span>Sin categorizar</span>
                        <span className="font-mono">{formatCurrency(totalIncome - categorizedIncome)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                  Desglose de Egresos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {expenseCategories.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      No hay categorias de egresos definidas
                    </p>
                  ) : (
                    expenseCategories.map(cat => {
                      const catTotal = transactions
                        .filter(t => t.type === "expense" && t.categoryId === cat.id)
                        .reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0);
                      const percent = totalExpense > 0 ? (catTotal / totalExpense) * 100 : 0;
                      
                      return (
                        <div key={cat.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-500" />
                            <span className="text-sm">{cat.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground">
                              {percent.toFixed(1)}%
                            </span>
                            <span className="font-mono font-medium text-red-600">
                              {formatCurrency(catTotal)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div className="border-t pt-3 mt-3">
                    <div className="flex items-center justify-between font-medium">
                      <span>Total Egresos</span>
                      <span className="font-mono text-red-600">{formatCurrency(totalExpense)}</span>
                    </div>
                    {totalExpense - categorizedExpense > 0 && (
                      <div className="flex items-center justify-between text-sm text-amber-600 mt-1">
                        <span>Sin categorizar</span>
                        <span className="font-mono">{formatCurrency(totalExpense - categorizedExpense)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Percent className="h-5 w-5" />
                  Resumen Neto vs Bruto
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 md:grid-cols-3">
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Total Bruto</p>
                    <p className="text-2xl font-bold font-mono">{formatCurrency(totalIncome + totalExpense)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Suma de todos los movimientos
                    </p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Balance Neto</p>
                    <p className={`text-2xl font-bold font-mono ${balance >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(balance)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ingresos - Egresos
                    </p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <p className="text-sm text-muted-foreground mb-1">Validacion</p>
                    {Math.abs(totalIncome - totalExpense - balance) < 0.01 ? (
                      <div className="flex items-center justify-center gap-2">
                        <CheckCircle className="h-6 w-6 text-green-600" />
                        <span className="text-green-600 font-medium">Cuadra</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2">
                        <AlertCircle className="h-6 w-6 text-red-600" />
                        <span className="text-red-600 font-medium">Diferencia detectada</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Diferencia: {formatCurrency(Math.abs(totalIncome - totalExpense - balance))}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={isUploadOpen}
        onOpenChange={(open) => {
          setIsUploadOpen(open);
          if (!open) {
            setUploadBankAccountId("");
            setUploadSkipContinuityCheck(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar Extracto Bancario</DialogTitle>
            <DialogDescription>
              El archivo se asocia a la cuenta que elijas; todos los movimientos quedan vinculados a esa caja o cuenta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cuenta o caja *</Label>
              <DataEntryCombobox
                options={uploadBankAccountComboOptions}
                value={uploadBankAccountId}
                onValueChange={setUploadBankAccountId}
                placeholder={
                  bankAccounts.length ? "Seleccionar cuenta..." : "Cree una cuenta primero"
                }
                searchPlaceholder="Buscar cuenta…"
                disabled={bankAccounts.length === 0}
                data-testid="select-upload-bank-account"
              />
            </div>
            <div className="space-y-2">
              <Label>Entidad bancaria (automática)</Label>
              <p className="text-sm text-muted-foreground">
                Se toma desde la caja/cuenta seleccionada. Si necesitás cambiarla, editá la cuenta en “Cuentas y cajas”.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Local (opcional)</Label>
              <DataEntryCombobox
                options={uploadDefaultLocalComboOptions}
                value={uploadDefaultLocalId}
                onValueChange={setUploadDefaultLocalId}
                placeholder="Sin local (asignar luego)"
                searchPlaceholder="Buscar local…"
                data-testid="select-upload-default-local"
              />
              <p className="text-xs text-muted-foreground">
                Si lo elegís, los movimientos sin sucursal/alias se importan con ese local.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <Checkbox
                id="skip-continuity"
                checked={uploadSkipContinuityCheck}
                onCheckedChange={(v) => setUploadSkipContinuityCheck(v === true)}
                data-testid="checkbox-skip-continuity"
              />
              <div className="space-y-1">
                <Label htmlFor="skip-continuity" className="cursor-pointer font-normal leading-snug">
                  Omitir validacion de encadenamiento de saldos
                </Label>
                <p className="text-xs text-muted-foreground">
                  Activá solo si el sistema rechaza el import por saldos y necesitás recuperar la carga (p. ej. extracciones
                  huérfanas o datos inconsistentes). No uses esto en condiciones normales.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Saldo inicial (opcional)</Label>
                <Input
                  value={uploadOpeningBalance}
                  onChange={(e) => setUploadOpeningBalance(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ej: 125000.50"
                  data-testid="input-opening-balance"
                />
              </div>
              <div className="space-y-2">
                <Label>Saldo final (opcional)</Label>
                <Input
                  value={uploadClosingBalance}
                  onChange={(e) => setUploadClosingBalance(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ej: 130250.75"
                  data-testid="input-closing-balance"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Archivo Excel (.xlsx)</Label>
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                data-testid="input-file"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsUploadOpen(false)} data-testid="button-cancel">
                Cancelar
              </Button>
              <Button
                onClick={handleUpload}
                disabled={
                  !file ||
                  !uploadBankAccountId ||
                  bankAccounts.length === 0 ||
                  uploadMutation.isPending
                }
                data-testid="button-upload"
              >
                {uploadMutation.isPending ? "Importando..." : "Importar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mpReconciliationOpen}
        onOpenChange={(open) => {
          if (!open) handleSuspendMpReconciliation();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Conciliar extracto Mercado Pago</DialogTitle>
            <DialogDescription>
              La suma de los movimientos a importar (bruto − comisión − impuesto) no coincide con la variación del
              saldo del archivo (columna SALDO). Podés cargar la diferencia como una "Comisión Mercado Pago" para que
              cuadre y avanzar, corregir el Excel y volver a importar, o suspender la carga. La tabla muestra hasta 10
              filas de referencia (típicamente montos bruto sospechosos).
            </DialogDescription>
          </DialogHeader>
          {mpReconciliation && (
            <>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
                <p className="font-medium text-foreground">{mpReconciliation.message}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-xs sm:text-sm mt-2">
                  <div>
                    <span className="text-muted-foreground">Saldo disponible total (archivo)</span>
                    <div className="font-semibold">{formatCurrency(mpReconciliation.saldoDisponibleTotal)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Suma neta (movimientos)</span>
                    <div className="font-semibold">{formatCurrency(mpReconciliation.sumNetImportable)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Suma brutos (sólo info)</span>
                    <div className="font-semibold">{formatCurrency(mpReconciliation.sumGrossImportable)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Diferencia</span>
                    <div className="font-semibold text-amber-800 dark:text-amber-200">
                      {formatCurrency(mpReconciliation.delta)}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground pt-1 border-t border-amber-500/20 mt-2">
                  Cada fila del Excel genera hasta 3 movimientos (bruto, comisión, impuesto). Si la suma no cuadra con
                  la variación del SALDO, suele deberse a filas con importes corruptos en el Excel, filas omitidas o
                  importaciones duplicadas. Con "Cargar diferencia como Comisión Mercado Pago" se asienta la diferencia
                  como una única línea para cerrar el saldo y avanzar.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Hasta 10 filas candidatas. Columna «Bruto (H)»: monto de la línea de ingreso/egreso bruto en esa fila
                Excel (puede ser 0 si el movimiento se expresa sólo vía comisión, impuesto o ajuste).
              </p>
              <ScrollArea className="max-h-[min(50vh,420px)] border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="p-2 font-medium">Fila Excel</th>
                      <th className="p-2 font-medium">Fecha</th>
                      <th className="p-2 font-medium">Descripción</th>
                      <th className="p-2 font-medium text-right">Bruto (H)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mpReconciliation.rows.map((row) => (
                      <tr key={row.excelRow} className="border-b border-border/60">
                        <td className="p-2 font-mono align-top">{row.excelRow}</td>
                        <td className="p-2 font-mono whitespace-nowrap align-top">
                          {row.date || "—"}
                        </td>
                        <td className="p-2 max-w-[220px] align-top">
                          <div className="truncate" title={row.description}>
                            {row.description || "—"}
                          </div>
                          {row.description2 ? (
                            <div
                              className="truncate text-xs text-muted-foreground"
                              title={row.description2}
                            >
                              {row.description2}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2 text-right font-mono align-top">
                          {formatCurrency(row.montoBrutoActual)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button type="button" variant="outline" onClick={handleSuspendMpReconciliation}>
              Suspender importación
            </Button>
            {mpReconciliation && (
              <Button
                type="button"
                onClick={handleAbsorbResidualAndImport}
                disabled={uploadMutation.isPending}
                data-testid="button-absorb-mp-residual"
              >
                Cargar diferencia ({formatCurrency(Math.abs(mpReconciliation.delta))}) como Comisión Mercado Pago y continuar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAccountsDialogOpen} onOpenChange={setIsAccountsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cuentas y cajas</DialogTitle>
            <DialogDescription>
              Registra cada cuenta o caja para importar extractos y filtrar movimientos. Opcionalmente vincula un local.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[50vh] overflow-y-auto">
            {bankAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay cuentas registradas.</p>
            ) : (
              <ul className="space-y-2">
                {bankAccounts.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{a.name}</span>
                      {a.local?.name && (
                        <span className="text-muted-foreground"> · {a.local.name}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        title="Borrar solo movimientos de extractos Excel y metadatos de import"
                        onClick={() => setPurgeAccountTarget(a)}
                        disabled={purgeBankImportsMutation.isPending}
                      >
                        <Eraser className="h-3.5 w-3.5" />
                        Vaciar extractos
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        title="Eliminar cuenta"
                        onClick={() => deleteBankAccountMutation.mutate(a.id)}
                        disabled={deleteBankAccountMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2 border-t pt-4">
              <Label>Nueva cuenta</Label>
              <Input
                placeholder="Nombre (ej. CC Galicia — Centro)"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                data-testid="input-new-account-name"
              />
              <Label className="text-xs text-muted-foreground">Número de cuenta / caja *</Label>
              <Input
                placeholder="Ej: 123-456789/0 o CVU/CBU"
                value={newAccountNumber}
                onChange={(e) => setNewAccountNumber(e.target.value)}
                data-testid="input-new-account-number"
              />
              <Label className="text-xs text-muted-foreground">Razón social *</Label>
              <DataEntryCombobox
                options={newAccountBusinessComboOptions}
                value={newAccountBusinessNameId}
                onValueChange={setNewAccountBusinessNameId}
                placeholder="Seleccionar razón social..."
                searchPlaceholder="Buscar razón social…"
              />
              <Label className="text-xs text-muted-foreground">Entidad bancaria *</Label>
              <DataEntryCombobox
                options={newAccountBankComboOptions}
                value={newAccountBankId}
                onValueChange={setNewAccountBankId}
                placeholder="Seleccionar entidad..."
                searchPlaceholder="Buscar entidad…"
              />
              <Label className="text-xs text-muted-foreground">Local (opcional)</Label>
              <DataEntryCombobox
                options={newAccountLocalComboOptions}
                value={newAccountLocalId}
                onValueChange={setNewAccountLocalId}
                placeholder="Sin local"
                searchPlaceholder="Buscar local…"
              />
              <Button
                type="button"
                className="w-full"
                onClick={handleCreateAccount}
                disabled={createBankAccountMutation.isPending}
              >
                {createBankAccountMutation.isPending ? "Guardando..." : "Crear cuenta"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={purgeAccountTarget != null}
        onOpenChange={(open) => {
          if (!open) setPurgeAccountTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vaciar movimientos de extractos</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Se borrarán de la base solo los movimientos <strong>importados desde Excel</strong> de la cuenta{" "}
                  <strong>{purgeAccountTarget?.name}</strong>, y los <strong>metadatos de lotes de import</strong>{" "}
                  (saldos encadenados). Así podés volver a cargar un extracto sin el error de saldo inicial.
                </p>
                <p>
                  No se eliminan movimientos manuales ni la definición de la cuenta.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={purgeBankImportsMutation.isPending || !purgeAccountTarget}
              onClick={() => {
                if (purgeAccountTarget) purgeBankImportsMutation.mutate(purgeAccountTarget.id);
              }}
            >
              {purgeBankImportsMutation.isPending ? "Borrando..." : "Confirmar vaciado"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isCategorizeOpen} onOpenChange={setIsCategorizeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Categorizar Movimiento</DialogTitle>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Descripcion</p>
                <p className="font-medium">{selectedTransaction.description}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">
                    {formatDate(selectedTransaction.transactionDate)}
                  </span>
                  <span className={`font-mono font-medium ${
                    selectedTransaction.type === "income" ? "text-green-600" : "text-red-600"
                  }`}>
                    {selectedTransaction.type === "income" ? "+" : "-"}
                    {formatCurrency(Math.abs(parseFloat(String(selectedTransaction.amount) || "0")))}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Categoria</Label>
                <DataEntryCombobox
                  options={categorizeCategoryComboOptions}
                  value={selectedCategoryId === "" ? "none" : selectedCategoryId}
                  onValueChange={(v) =>
                    setSelectedCategoryId(v === "none" ? "" : v)
                  }
                  placeholder="Seleccionar categoria..."
                  searchPlaceholder="Buscar categoria…"
                  data-testid="select-category"
                />
              </div>

              <div className="space-y-2">
                <Label>Local</Label>
                <DataEntryCombobox
                  options={transactionLocalPickComboOptions}
                  value={selectedLocalId === "" ? "none" : selectedLocalId}
                  onValueChange={(v) => setSelectedLocalId(v === "none" ? "" : v)}
                  placeholder="Seleccionar local..."
                  searchPlaceholder="Buscar local…"
                  data-testid="select-local"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCategorizeOpen(false)} data-testid="button-cancel-categorize">
                  Cancelar
                </Button>
                <Button
                  onClick={handleCategorize}
                  disabled={categorizeMutation.isPending}
                  data-testid="button-save-category"
                >
                  {categorizeMutation.isPending ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isBatchCategorizeOpen} onOpenChange={(open) => {
        setIsBatchCategorizeOpen(open);
        if (!open) {
          setBatchCategoryId("");
          setBatchLocalId("");
          setBatchDateFrom("");
          setBatchDateTo("");
          setSelectedDescriptions(new Set());
          setSelectedDescription2("");
          setBatchDescSearch("");
          setBatchDesc2Search("");
          setBatchFilterLocalId("");
        }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[min(90vh,880px)] h-[min(90vh,880px)] flex flex-col gap-0 p-0 overflow-hidden sm:rounded-lg">
          <div className="px-6 pt-6 pb-2 pr-12 shrink-0 border-b border-border/50">
            <DialogHeader>
              <DialogTitle>{batchMode === "uncategorize" ? "Descategorizar Masivo" : "Clasificacion Masiva"}</DialogTitle>
              <DialogDescription>
                {batchMode === "uncategorize"
                  ? (selectedTransactionIds.size > 0
                      ? `Vas a quitar la categoría a ${selectedTransactionIds.size} transacciones seleccionadas`
                      : "Filtrá por periodo y/o descripción; se quitará la categoría a las que coincidan")
                  : (selectedTransactionIds.size > 0
                      ? `Vas a clasificar ${selectedTransactionIds.size} transacciones seleccionadas`
                      : "Filtra por periodo y/o descripcion, asigna categoria y local")}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4 space-y-4">
            {selectedTransactionIds.size === 0 && (
              <div className="grid gap-3 p-3 rounded-lg bg-muted/50">
                <p className="text-sm font-medium">1. Periodo (opcional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Desde</Label>
                    <Input type="date" value={batchDateFrom} onChange={(e) => { setBatchDateFrom(e.target.value); setSelectedDescriptions(new Set()); setSelectedDescription2(""); }} data-testid="input-batch-date-from" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Hasta</Label>
                    <Input type="date" value={batchDateTo} onChange={(e) => { setBatchDateTo(e.target.value); setSelectedDescriptions(new Set()); setSelectedDescription2(""); }} data-testid="input-batch-date-to" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Local (filtro de búsqueda)</Label>
                  <BatchLocalCombobox locals={locals} value={batchFilterLocalId || "none"} onChange={(v) => { setBatchFilterLocalId(v === "none" ? "" : v); setSelectedDescriptions(new Set()); }} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Entidad (banco de origen)</Label>
                  <Select value={batchBankSource || "all"} onValueChange={(v) => { setBatchBankSource(v === "all" ? "" : v); setSelectedDescriptions(new Set()); setSelectedDescription2(""); }}>
                    <SelectTrigger data-testid="select-batch-bank-source"><SelectValue placeholder="Todas las entidades" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas las entidades</SelectItem>
                      {availableBanks.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  {batchMode === "uncategorize"
                    ? "Solo se descategorizaran transacciones CON categoria"
                    : "Solo se clasificaran transacciones SIN categoria"}
                </p>
              </div>
            )}

            {selectedTransactionIds.size === 0 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">2. Descripcion (podés elegir varias)</p>
                  {groupedDescriptions.length > 0 && (
                    <Input placeholder="Buscar en descripciones…" value={batchDescSearch} onChange={(e) => setBatchDescSearch(e.target.value)} className="max-w-md" />
                  )}
                  {groupedDescriptions.length === 0 ? (
                    <div className="text-center py-4 text-sm text-muted-foreground rounded-lg bg-muted/50">{batchMode === "uncategorize" ? "No hay movimientos categorizados" : "No hay movimientos sin clasificar"}</div>
                  ) : filteredGroupedDescriptions.length === 0 ? (
                    <div className="text-center py-3 text-sm text-muted-foreground rounded-lg bg-muted/50">Ninguna descripcion coincide</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1 rounded-md border bg-muted/20 p-1">
                      {filteredGroupedDescriptions.map((group) => {
                        const sel = selectedDescriptions.has(group.description);
                        return (
                          <div key={group.description}
                            className={`flex items-center justify-between gap-3 p-2 rounded-lg cursor-pointer transition-colors ${sel ? "bg-primary/10 border border-primary/30" : "bg-muted/50 hover-elevate"}`}
                            onClick={() => setSelectedDescriptions((prev) => { const n = new Set(prev); if (n.has(group.description)) n.delete(group.description); else n.add(group.description); return n; })}
                            data-testid={`desc-group-${group.description.slice(0, 20)}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`h-4 w-4 shrink-0 rounded border flex items-center justify-center ${sel ? "bg-primary border-primary" : "border-muted-foreground/30"}`}>
                                {sel && <Check className="h-3 w-3 text-primary-foreground" />}
                              </div>
                              <p className="text-sm truncate">{group.description}</p>
                            </div>
                            <Badge variant="secondary">{group.count} mov.</Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {selectedDescriptions.size > 0 && (
                    <p className="text-xs text-muted-foreground">{selectedDescriptions.size} descripción(es) seleccionada(s)</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Entidad / Descripcion 2 (opcional)</p>
                  <p className="text-xs text-muted-foreground">Segunda linea cuando el banco la aporta (Galicia, Mercado Pago). Combiná con la descripción para acotar más.</p>
                  {groupedDescriptions2.length > 0 && (
                    <Input placeholder="Buscar en descripcion 2…" value={batchDesc2Search} onChange={(e) => setBatchDesc2Search(e.target.value)} className="max-w-md" />
                  )}
                  {groupedDescriptions2.length === 0 ? (
                    <div className="text-center py-3 text-sm text-muted-foreground rounded-lg bg-muted/50">No hay segunda descripcion{batchDateFrom && batchDateTo ? " en el periodo seleccionado" : ""}</div>
                  ) : filteredGroupedDescriptions2.length === 0 ? (
                    <div className="text-center py-3 text-sm text-muted-foreground rounded-lg bg-muted/50">Ninguna descripcion 2 coincide</div>
                  ) : (
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1 rounded-md border bg-muted/20 p-1">
                      {filteredGroupedDescriptions2.map((group) => (
                        <div key={group.description2}
                          className={`flex items-center justify-between gap-3 p-2 rounded-lg cursor-pointer transition-colors ${selectedDescription2 === group.description2 ? "bg-primary/10 border border-primary/30" : "bg-muted/50 hover-elevate"}`}
                          onClick={() => setSelectedDescription2(selectedDescription2 === group.description2 ? "" : group.description2)}
                          data-testid={`desc2-group-${group.description2.slice(0, 24)}`}
                        >
                          <div className="flex-1 min-w-0"><p className="text-sm truncate">{group.description2}</p></div>
                          <Badge variant="secondary">{group.count} mov.</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedDescription2 && (
                    <p className="text-xs text-muted-foreground">Seleccionado: <span className="font-medium">{selectedDescription2}</span></p>
                  )}
                </div>
              </div>
            )}

            {batchMode === "categorize" && (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium">3. Categoria a Asignar</p>
                  <BatchCategoryCombobox categories={categories} financialGroups={financialGroups} value={batchCategoryId} onChange={setBatchCategoryId} />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">4. Local a asignar (opcional)</p>
                  <p className="text-xs text-muted-foreground">Si dejás "Sin asignar", no se modifica el local que ya tienen los movimientos.</p>
                  <BatchLocalCombobox locals={locals} value={batchLocalId} onChange={setBatchLocalId} />
                </div>
              </>
            )}

            {batchMode === "categorize" && batchCategoryId &&
              (selectedTransactionIds.size > 0 || (batchDateFrom && batchDateTo) || selectedDescriptions.size > 0 || selectedDescription2.trim()) && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="text-sm min-w-0">
                      <p className="font-medium text-amber-700 dark:text-amber-300">Resumen</p>
                      <p className="text-muted-foreground">
                        Categoria: <span className="font-medium">{categories.find((c) => c.id === parseInt(batchCategoryId, 10))?.name}</span>
                        {selectedDescriptions.size > 0 && (<><br />{selectedDescriptions.size} descripción(es): <span className="font-medium">{Array.from(selectedDescriptions).join(", ")}</span></>)}
                        {selectedDescription2.trim() && (<><br />Entidad: <span className="font-medium">{selectedDescription2}</span></>)}
                        {batchDateFrom && batchDateTo && (<><br />Periodo: {batchDateFrom} a {batchDateTo}</>)}
                        {selectedTransactionIds.size > 0 && (<><br />{selectedTransactionIds.size} transacciones seleccionadas</>)}
                        {batchLocalId && batchLocalId !== "none" && (<><br />Local asignado: <span className="font-medium">{locals.find((l) => l.id === parseInt(batchLocalId, 10))?.name}</span></>)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
          </div>

          <div className="shrink-0 border-t px-6 py-4 flex flex-wrap justify-end gap-2 bg-background">
            <Button variant="outline" onClick={() => {
              setIsBatchCategorizeOpen(false); setBatchCategoryId(""); setBatchLocalId(""); setBatchDateFrom(""); setBatchDateTo("");
              setSelectedDescriptions(new Set()); setSelectedDescription2(""); setBatchDescSearch(""); setBatchDesc2Search(""); setBatchFilterLocalId("");
            }} data-testid="button-cancel-batch">Cancelar</Button>
            <Button
              variant={batchMode === "uncategorize" ? "destructive" : "default"}
              onClick={handleBatchCategorize}
              disabled={
                batchCategorizeMutation.isPending ||
                (batchMode === "categorize" && !batchCategoryId) ||
                (selectedTransactionIds.size === 0 && !batchDateFrom && !batchDateTo && selectedDescriptions.size === 0 && !selectedDescription2.trim())
              }
              data-testid="button-apply-batch"
            >
              {batchCategorizeMutation.isPending
                ? "Procesando..."
                : batchMode === "uncategorize"
                ? "Descategorizar"
                : "Aplicar Clasificacion"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isBranchMappingOpen} onOpenChange={setIsBranchMappingOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular Sucursales</DialogTitle>
            <DialogDescription>
              Se detectaron nombres de sucursales que no estan vinculados a un local del sistema.
              Asigna cada nombre a su local correspondiente para futuras importaciones.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {branchMappings.map((mapping, index) => (
              <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <div className="flex-1">
                  <p className="text-sm font-medium">{mapping.alias}</p>
                  <p className="text-xs text-muted-foreground">Nombre en el extracto</p>
                </div>
                <DataEntryCombobox
                  options={localsOnlyComboOptions}
                  value={mapping.localId != null ? String(mapping.localId) : ""}
                  onValueChange={(v) =>
                    updateBranchMapping(index, v ? parseInt(v, 10) : null)
                  }
                  placeholder="Seleccionar local..."
                  searchPlaceholder="Buscar local…"
                  emptyOptionLabel="Sin vínculo"
                  triggerClassName="w-48"
                  data-testid={`select-branch-mapping-${index}`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={() => {
                setIsBranchMappingOpen(false);
                setBranchMappings([]);
                setUnmappedBranches([]);
              }}
              data-testid="button-cancel-branch-mapping"
            >
              Omitir
            </Button>
            <Button
              onClick={handleSaveBranchMappings}
              disabled={bulkAliasMutation.isPending}
              data-testid="button-save-branch-mapping"
            >
              {bulkAliasMutation.isPending ? "Guardando..." : "Guardar Vinculos"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteBatchOpen} onOpenChange={(open) => {
        setIsDeleteBatchOpen(open);
        if (!open) {
          setDeleteBatchTarget(null);
          setDeleteConfirmCode("");
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar Extracto Completo</DialogTitle>
            <DialogDescription>
              Esta accion eliminara todos los movimientos de este extracto. Esta accion no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {deleteBatchTarget && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="font-medium text-destructive">
                  {availableBanks.find(b => b.id === deleteBatchTarget.bankSource)?.name || deleteBatchTarget.bankSource}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {deleteBatchTarget.count} movimientos - Periodo: {deleteBatchTarget.minDate ? formatDate(deleteBatchTarget.minDate) : "-"} a {deleteBatchTarget.maxDate ? formatDate(deleteBatchTarget.maxDate) : "-"}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Escribi <span className="font-bold text-destructive">ELIMINAR</span> para confirmar</Label>
                <Input
                  value={deleteConfirmCode}
                  onChange={(e) => setDeleteConfirmCode(e.target.value)}
                  placeholder="ELIMINAR"
                  data-testid="input-delete-confirm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsDeleteBatchOpen(false);
                    setDeleteBatchTarget(null);
                    setDeleteConfirmCode("");
                  }}
                  data-testid="button-cancel-delete-batch"
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  disabled={deleteConfirmCode !== "ELIMINAR" || deleteBatchMutation.isPending}
                  onClick={() => {
                    if (deleteBatchTarget) {
                      deleteBatchMutation.mutate({
                        batchId: deleteBatchTarget.importBatchId,
                        confirmCode: deleteConfirmCode,
                      });
                    }
                  }}
                  data-testid="button-confirm-delete-batch"
                >
                  {deleteBatchMutation.isPending ? "Eliminando..." : "Eliminar Extracto"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
