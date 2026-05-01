import { useState, useMemo, useEffect, useRef } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate } from "@/lib/formatters";
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
  Split,
  Plus,
  Trash2,
  Bookmark,
  Landmark,
  Eraser,
} from "lucide-react";
import type {
  Transaction,
  BankAccount,
  TransactionCategory,
  Local,
  LocalAlias,
  FinancialSavedView,
} from "@shared/schema";
import type { BusinessName } from "@shared/schema";

interface TransactionWithRelations extends Transaction {
  bankAccount?: BankAccount | null;
  category?: TransactionCategory | null;
  local?: Local | null;
}

interface SplitItem {
  localId: number | null;
  localName: string;
  amount: string;
  categoryId?: number;
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

interface MpReconciliationPayload {
  message: string;
  saldoDisponibleTotal: number;
  sumGrossImportable: number;
  delta: number;
  rows: Array<{ excelRow: number; description: string; montoBrutoActual: number }>;
}

/** Parseo flexible de monto (coma/punto) para overrides brutos MP. */
function parseMpMoneyInput(s: string): number | null {
  const t = s.trim().replace(/\s/g, "").replace(/\$/g, "");
  if (!t) return null;
  if (t.includes(",")) {
    const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function parseSavedViewFilters(raw: unknown): {
  bankFilter: string;
  accountContextFilter: string;
  filterTab: FilterTab;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const filterTab = o.filterTab;
  if (filterTab !== "all" && filterTab !== "uncategorized" && filterTab !== "categorized") return null;
  return {
    bankFilter: typeof o.bankFilter === "string" ? o.bankFilter : "all",
    accountContextFilter:
      typeof o.accountContextFilter === "string" ? o.accountContextFilter : "all",
    filterTab,
  };
}

export default function BankStatementsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isCategorizeOpen, setIsCategorizeOpen] = useState(false);
  const [isBatchCategorizeOpen, setIsBatchCategorizeOpen] = useState(false);
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionWithRelations | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [batchCategoryId, setBatchCategoryId] = useState<string>("");
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<number>>(new Set());
  const [batchDateFrom, setBatchDateFrom] = useState<string>("");
  const [batchDateTo, setBatchDateTo] = useState<string>("");
  const [splitItems, setSplitItems] = useState<SplitItem[]>([
    { localId: null, localName: "", amount: "" },
    { localId: null, localName: "", amount: "" },
  ]);
  const [file, setFile] = useState<File | null>(null);
  const [selectedBankId, setSelectedBankId] = useState<string>("galicia");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [isBranchMappingOpen, setIsBranchMappingOpen] = useState(false);
  const [unmappedBranches, setUnmappedBranches] = useState<string[]>([]);
  const [branchMappings, setBranchMappings] = useState<BranchMapping[]>([]);
  const [selectedDescription, setSelectedDescription] = useState<string>("");
  const [selectedDescription2, setSelectedDescription2] = useState<string>("");
  const [selectedLocalId, setSelectedLocalId] = useState<string>("");
  const [batchLocalId, setBatchLocalId] = useState<string>("");
  const [isDeleteBatchOpen, setIsDeleteBatchOpen] = useState(false);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState<ImportBatch | null>(null);
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");
  const [accountContextFilter, setAccountContextFilter] = useState<string>("all");
  const [uploadBankAccountId, setUploadBankAccountId] = useState("");
  const [uploadDefaultLocalId, setUploadDefaultLocalId] = useState<string>("none");
  const [uploadOpeningBalance, setUploadOpeningBalance] = useState<string>("");
  const [uploadClosingBalance, setUploadClosingBalance] = useState<string>("");
  const [uploadSkipContinuityCheck, setUploadSkipContinuityCheck] = useState(false);
  const [mpReconciliationOpen, setMpReconciliationOpen] = useState(false);
  const [mpReconciliation, setMpReconciliation] = useState<MpReconciliationPayload | null>(null);
  const [mpGrossDrafts, setMpGrossDrafts] = useState<Record<number, string>>({});
  /** Evita toast de “suspendido” al cerrar el panel tras import OK. */
  const mpSilentDismissRef = useRef(false);
  const mpPanelWasOpenRef = useRef(false);
  const [isAccountsDialogOpen, setIsAccountsDialogOpen] = useState(false);
  const [purgeAccountTarget, setPurgeAccountTarget] = useState<BankAccountWithLocal | null>(null);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountLocalId, setNewAccountLocalId] = useState<string>("none");
  const [newAccountNumber, setNewAccountNumber] = useState("");
  const [newAccountBusinessNameId, setNewAccountBusinessNameId] = useState<string>("none");
  const [newAccountBankId, setNewAccountBankId] = useState<string>("none");
  const [isSaveViewDialogOpen, setIsSaveViewDialogOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");

  const {
    data: transactions = [],
    isLoading,
    isError: isTransactionsError,
    error: transactionsError,
    refetch: refetchTransactions,
  } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions"],
    queryFn: async () => {
      const PAGE_SIZE = 800;
      const MAX_PAGES = 250;
      const merged: TransactionWithRelations[] = [];
      let page = 0;
      let total = 0;

      while (page < MAX_PAGES) {
        const res = await fetch(`/api/transactions?page=${page}&pageSize=${PAGE_SIZE}`, {
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
          | { items: TransactionWithRelations[]; total: number; page: number; pageSize: number };

        if (Array.isArray(body)) {
          return body;
        }

        if (page === 0) {
          total = body.total;
        }
        merged.push(...body.items);

        if (merged.length >= total || body.items.length === 0 || body.items.length < PAGE_SIZE) {
          break;
        }
        page += 1;
      }

      return merged;
    },
  });

  const { data: bankAccounts = [] } = useQuery<BankAccountWithLocal[]>({
    queryKey: ["/api/bank-accounts"],
  });

  const { data: savedViews = [] } = useQuery<FinancialSavedView[]>({
    queryKey: ["/api/financial-saved-views"],
    enabled: !!user?.id,
  });

  const { data: categories = [] } = useQuery<TransactionCategory[]>({
    queryKey: ["/api/transaction-categories"],
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
    // Si el usuario eligió una cuenta específica, usamos esa.
    if (accountContextFilter !== "all" && accountContextFilter !== "unassigned") {
      const aid = parseInt(accountContextFilter, 10);
      return Number.isFinite(aid) ? aid : null;
    }

    // Si la vista está en "todas", pero en la práctica hay movimientos de una sola cuenta,
    // mostramos el saldo de esa cuenta para evitar confusión (caso típico: solo Galicia cargado).
    const ids = new Set<number>();
    for (const t of transactions) {
      if (bankFilter !== "all" && t.bankSource !== bankFilter) continue;
      const id = (t as any).bankAccountId;
      if (typeof id === "number" && Number.isFinite(id)) ids.add(id);
    }
    return ids.size === 1 ? Array.from(ids)[0] : null;
  }, [accountContextFilter, bankFilter, transactions]);

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

  const saveViewMutation = useMutation({
    mutationFn: async (payload: { name: string; filters: Record<string, unknown> }) => {
      const res = await apiRequest("POST", "/api/financial-saved-views", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/financial-saved-views"] });
      toast({ title: "Vista guardada" });
      setIsSaveViewDialogOpen(false);
      setSaveViewName("");
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar vista", description: error.message, variant: "destructive" });
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/financial-saved-views/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/financial-saved-views"] });
      toast({ title: "Vista eliminada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar vista", description: error.message, variant: "destructive" });
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
      return res.json();
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
      sumGrossImportable?: number;
      delta?: number;
      rows?: MpReconciliationPayload["rows"];
      unmappedBranches?: string[];
    }) => {
      if (data.reconciliationRequired && data.rows && data.message != null) {
        setMpReconciliation({
          message: data.message,
          saldoDisponibleTotal: Number(data.saldoDisponibleTotal ?? 0),
          sumGrossImportable: Number(data.sumGrossImportable ?? 0),
          delta: Number(data.delta ?? 0),
          rows: data.rows,
        });
        const drafts: Record<number, string> = {};
        for (const r of data.rows) {
          drafts[r.excelRow] = String(r.montoBrutoActual);
        }
        setMpGrossDrafts(drafts);
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
      setMpGrossDrafts({});

      if (data.bankSourceId) {
        setBankFilter(data.bankSourceId);
      } else {
        setBankFilter("all");
      }
      setAccountContextFilter("all");

      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions/import-batches"] });
      let description = data.skipped > 0 
        ? `Importados: ${data.imported}. Saltados: ${data.skipped}. Total: ${data.total}. Banco: ${data.bankUsed}`
        : `Se importaron ${data.imported} de ${data.total} movimientos usando ${data.bankUsed}`;
      if (data.batchOpeningBalance != null && data.batchOpeningBalance !== "") {
        description += `. Saldo inicial: ${formatCurrency(Number(data.batchOpeningBalance))}`;
      }
      if (data.batchClosingBalance != null && data.batchClosingBalance !== "") {
        description += `. Saldo final: ${formatCurrency(Number(data.batchClosingBalance))}`;
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
      description2?: string;
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
      setSelectedDescription("");
      setSelectedDescription2("");
    },
    onError: (error: Error) => {
      toast({ title: "Error en clasificacion masiva", description: error.message, variant: "destructive" });
    },
  });

  const splitMutation = useMutation({
    mutationFn: async ({ id, splits }: { id: number; splits: SplitItem[] }) => {
      return apiRequest("POST", `/api/transactions/${id}/split`, { splits });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({ 
        title: "Transaccion dividida", 
        description: data.message || `Se crearon ${data.splits?.length || 0} sub-movimientos`
      });
      setIsSplitOpen(false);
      setSelectedTransaction(null);
      setSplitItems([
        { localId: null, localName: "", amount: "" },
        { localId: null, localName: "", amount: "" },
      ]);
    },
    onError: (error: Error) => {
      toast({ title: "Error al dividir", description: error.message, variant: "destructive" });
    },
  });

  const buildUploadPayload = (): { formData: FormData; queryString: string } | null => {
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
    setMpGrossDrafts({});
    if (!silent) {
      toast({
        title: "Importacion suspendida",
        description: "No se guardo ningun movimiento del extracto.",
        duration: 8000,
      });
    }
  };

  const handleFinalizeMpReconciliation = () => {
    if (!mpReconciliation || !file || !uploadBankAccountId) return;
    const overrides: Record<string, number> = {};
    for (const r of mpReconciliation.rows) {
      const n = parseMpMoneyInput(mpGrossDrafts[r.excelRow] ?? "");
      if (n === null) {
        toast({
          title: "Montos invalidos",
          description: `Revisá el monto bruto de la fila ${r.excelRow} del Excel.`,
          variant: "destructive",
        });
        return;
      }
      overrides[String(r.excelRow)] = n;
    }
    const payload = buildUploadPayload();
    if (!payload) return;
    uploadMutation.mutate({ ...payload, mpGrossOverrides: overrides });
  };

  const mpEstimatedSumGross = useMemo(() => {
    if (!mpReconciliation) return null;
    let s = mpReconciliation.sumGrossImportable;
    for (const r of mpReconciliation.rows) {
      const oldv = r.montoBrutoActual;
      const newv = parseMpMoneyInput(mpGrossDrafts[r.excelRow] ?? "");
      if (newv !== null) s += newv - oldv;
    }
    return s;
  }, [mpReconciliation, mpGrossDrafts]);

  useEffect(() => {
    if (!isUploadOpen || bankAccounts.length === 0) return;
    if (!uploadBankAccountId) {
      setUploadBankAccountId(String(bankAccounts[0].id));
    }
  }, [isUploadOpen, bankAccounts, uploadBankAccountId]);

  const applySavedView = (view: FinancialSavedView) => {
    const f = parseSavedViewFilters(view.filters);
    if (!f) {
      toast({ title: "Vista invalida", variant: "destructive" });
      return;
    }
    setBankFilter(f.bankFilter);
    setAccountContextFilter(f.accountContextFilter);
    setFilterTab(f.filterTab);
  };

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

  const handleSaveCurrentView = () => {
    if (!saveViewName.trim()) {
      toast({ title: "Indique un nombre para la vista", variant: "destructive" });
      return;
    }
    saveViewMutation.mutate({
      name: saveViewName.trim(),
      filters: {
        bankFilter,
        accountContextFilter,
        filterTab,
      },
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
    if (!batchCategoryId) {
      toast({ title: "Seleccione una categoria", variant: "destructive" });
      return;
    }
    
    const hasSelection = selectedTransactionIds.size > 0;
    const hasDateRange = batchDateFrom && batchDateTo;
    const hasPartialDate = (batchDateFrom && !batchDateTo) || (!batchDateFrom && batchDateTo);
    const hasDescription = !!selectedDescription.trim();
    const hasDescription2 = !!selectedDescription2.trim();
    
    if (hasPartialDate) {
      toast({ title: "Complete ambas fechas del periodo", variant: "destructive" });
      return;
    }
    
    if (!hasSelection && !hasDateRange && !hasDescription && !hasDescription2) {
      toast({ title: "Seleccione un filtro: periodo, descripcion o transacciones", variant: "destructive" });
      return;
    }
    
    const localId = batchLocalId && batchLocalId !== "none" ? parseInt(batchLocalId) : null;
    
    batchCategorizeMutation.mutate({
      ...(hasDescription ? { description: selectedDescription } : {}),
      ...(hasDescription2 ? { description2: selectedDescription2 } : {}),
      ...(hasSelection ? { transactionIds: Array.from(selectedTransactionIds) } : {}),
      categoryId: parseInt(batchCategoryId),
      localId,
      dateFrom: hasDateRange ? batchDateFrom : undefined,
      dateTo: hasDateRange ? batchDateTo : undefined,
    });
  };

  const groupedDescriptions = useMemo(() => {
    let uncategorized = transactions.filter(t => !t.categoryId && t.description);
    if (batchDateFrom && batchDateTo) {
      uncategorized = uncategorized.filter(t => {
        const d = t.transactionDate ? String(t.transactionDate).slice(0, 10) : "";
        return d >= batchDateFrom && d <= batchDateTo;
      });
    }
    const groups = new Map<string, number>();
    for (const t of uncategorized) {
      const desc = t.description || "";
      groups.set(desc, (groups.get(desc) || 0) + 1);
    }
    return Array.from(groups.entries())
      .map(([description, count]) => ({ description, count }))
      .sort((a, b) => b.count - a.count);
  }, [transactions, batchDateFrom, batchDateTo]);

  const groupedDescriptions2 = useMemo(() => {
    let uncategorized = transactions.filter(
      (t) => !t.categoryId && (t.description2 && String(t.description2).trim()),
    );
    if (batchDateFrom && batchDateTo) {
      uncategorized = uncategorized.filter((t) => {
        const d = t.transactionDate ? String(t.transactionDate).slice(0, 10) : "";
        return d >= batchDateFrom && d <= batchDateTo;
      });
    }
    const groups = new Map<string, number>();
    for (const t of uncategorized) {
      const desc = String(t.description2 || "").trim();
      groups.set(desc, (groups.get(desc) || 0) + 1);
    }
    return Array.from(groups.entries())
      .map(([description2, count]) => ({ description2, count }))
      .sort((a, b) => b.count - a.count);
  }, [transactions, batchDateFrom, batchDateTo]);


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
    if (selectedTransactionIds.size === filteredTransactions.length) {
      setSelectedTransactionIds(new Set());
    } else {
      setSelectedTransactionIds(new Set(filteredTransactions.map(t => t.id)));
    }
  };

  const openCategorizeDialog = (transaction: TransactionWithRelations) => {
    setSelectedTransaction(transaction);
    setSelectedCategoryId(transaction.categoryId ? String(transaction.categoryId) : "");
    setSelectedLocalId(transaction.localId ? String(transaction.localId) : "");
    setIsCategorizeOpen(true);
  };

  const openSplitDialog = (transaction: TransactionWithRelations) => {
    setSelectedTransaction(transaction);
    const amount = Math.abs(parseFloat(String(transaction.amount) || "0"));
    setSplitItems([
      { localId: null, localName: "", amount: String(Math.floor(amount / 2)) },
      { localId: null, localName: "", amount: String(Math.ceil(amount / 2)) },
    ]);
    setIsSplitOpen(true);
  };

  const handleSplit = () => {
    if (!selectedTransaction) return;
    
    const validSplits = splitItems.filter(s => s.amount && parseFloat(s.amount) > 0);
    if (validSplits.length < 2) {
      toast({ title: "Se requieren al menos 2 partes con monto", variant: "destructive" });
      return;
    }

    const totalSplit = validSplits.reduce((sum, s) => sum + parseFloat(s.amount), 0);
    const parentAmount = Math.abs(parseFloat(String(selectedTransaction.amount) || "0"));
    
    if (Math.abs(totalSplit - parentAmount) > 0.01) {
      toast({ 
        title: "Los montos no coinciden", 
        description: `Suma: ${formatCurrency(totalSplit)} vs Original: ${formatCurrency(parentAmount)}`,
        variant: "destructive" 
      });
      return;
    }

    splitMutation.mutate({
      id: selectedTransaction.id,
      splits: validSplits,
    });
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

  const addSplitItem = () => {
    setSplitItems([...splitItems, { localId: null, localName: "", amount: "" }]);
  };

  const removeSplitItem = (index: number) => {
    if (splitItems.length <= 2) return;
    setSplitItems(splitItems.filter((_, i) => i !== index));
  };

  const updateSplitItem = (index: number, field: keyof SplitItem, value: any) => {
    setSplitItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      if (field === "localId") {
        const local = locals.find(l => l.id === value);
        return { ...item, localId: value, localName: local?.name || "" };
      }
      return { ...item, [field]: value };
    }));
  };

  const categorizedCount = transactions.filter(t => t.categoryId).length;
  const uncategorizedCount = transactions.length - categorizedCount;
  const categorizationPercent = transactions.length > 0 
    ? Math.round((categorizedCount / transactions.length) * 100) 
    : 0;

  const totalIncome = transactions
    .filter(t => t.type === "income")
    .reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0);

  const totalExpense = transactions
    .filter(t => t.type === "expense")
    .reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0);

  const balance = totalIncome - totalExpense;
  const contextDelta =
    contextOpening != null && contextClosing != null ? contextClosing - contextOpening : null;
  const balanceDisplayValue = contextClosing != null ? contextClosing : balance;

  const incomeCategories = categories.filter(c => c.type === "income" || c.type === "both");
  const expenseCategories = categories.filter(c => c.type === "expense" || c.type === "both");

  const categorizedIncome = transactions
    .filter(t => t.type === "income" && t.categoryId)
    .reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0);
  
  const categorizedExpense = transactions
    .filter(t => t.type === "expense" && t.categoryId)
    .reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0);

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

  const accountFilteredTransactions = useMemo(() => {
    if (accountContextFilter === "all") return bankFilteredTransactions;
    if (accountContextFilter === "unassigned") {
      return bankFilteredTransactions.filter((t) => !t.bankAccountId);
    }
    const aid = parseInt(accountContextFilter, 10);
    if (Number.isNaN(aid)) return bankFilteredTransactions;
    return bankFilteredTransactions.filter((t) => t.bankAccountId === aid);
  }, [bankFilteredTransactions, accountContextFilter]);

  const filteredTransactions = filterTab === "all" 
    ? accountFilteredTransactions 
    : filterTab === "uncategorized" 
      ? accountFilteredTransactions.filter(t => !t.categoryId)
      : accountFilteredTransactions.filter(t => t.categoryId);

  const columns: Column<TransactionWithRelations>[] = [
    {
      key: "select",
      header: () => (
        <Checkbox
          checked={selectedTransactionIds.size === filteredTransactions.length && filteredTransactions.length > 0}
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
      header: "Fecha",
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
          {!row.parentTransactionId && !row.invoiced && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => openSplitDialog(row)}
              data-testid={`button-split-${row.id}`}
              title="Dividir por local"
            >
              <Split className="h-4 w-4" />
            </Button>
          )}
          {row.parentTransactionId && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Split
            </Badge>
          )}
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
                onClick={() => setIsBatchCategorizeOpen(true)} 
                data-testid="button-batch-categorize"
              >
                <ListChecks className="h-4 w-4 mr-2" />
                Clasificar {selectedTransactionIds.size} seleccionados
              </Button>
            )}
            <Button 
              variant="outline"
              onClick={() => setIsBatchCategorizeOpen(true)} 
              data-testid="button-batch-categorize-range"
            >
              <Tag className="h-4 w-4 mr-2" />
              Clasificacion Masiva
            </Button>
            <Button variant="outline" onClick={() => setIsAccountsDialogOpen(true)} data-testid="button-bank-accounts">
              <Landmark className="h-4 w-4 mr-2" />
              Cuentas
            </Button>
            <Button onClick={() => setIsUploadOpen(true)} data-testid="button-import">
              <Upload className="h-4 w-4 mr-2" />
              Importar Excel
            </Button>
          </div>
        }
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

      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Movimientos</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-total">
              {transactions.length}
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
              {categorizedCount} de {transactions.length} movimientos
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
              {contextClosing != null ? "Saldo final" : "Balance Neto"}
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
              {contextOpening != null && contextClosing != null ? (
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

      <div className="space-y-3 rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
        <p className="text-sm font-semibold text-foreground">Vista por cuenta y atajos</p>
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <div className="space-y-2 min-w-[220px] flex-1">
          <Label className="text-xs font-medium text-foreground">Cuenta / caja (vista)</Label>
          <Select value={accountContextFilter} onValueChange={setAccountContextFilter}>
            <SelectTrigger data-testid="select-account-context" className="w-full md:max-w-md">
              <SelectValue placeholder="Filtrar por cuenta..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las cuentas</SelectItem>
              <SelectItem value="unassigned">Sin cuenta asignada (importes antiguos)</SelectItem>
              {bankAccounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                  {a.local?.name ? ` · ${a.local.name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {user?.id && savedViews.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Vistas:</span>
              {savedViews.map((v) => (
                <div key={v.id} className="flex items-center gap-0.5 rounded-md border bg-background">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => applySavedView(v)}
                  >
                    <Bookmark className="h-3 w-3 mr-1 opacity-70" />
                    {v.name}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    title="Eliminar vista"
                    onClick={() => deleteViewMutation.mutate(v.id)}
                    disabled={deleteViewMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {user?.id && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8"
              onClick={() => setIsSaveViewDialogOpen(true)}
              data-testid="button-save-view"
            >
              Guardar vista
            </Button>
          )}
        </div>
        </div>
      </div>

      {categorizationPercent < 100 && transactions.length > 0 && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div className="flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Tienes {uncategorizedCount} movimiento{uncategorizedCount !== 1 ? "s" : ""} sin categorizar
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
                    {accountFilteredTransactions.length}
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
                    {formatCurrency(accountFilteredTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0))}
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
                    {formatCurrency(accountFilteredTransactions.filter(t => t.type === "expense").reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0))}
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
                    const bankIncome = accountFilteredTransactions.filter(t => t.type === "income").reduce((sum, t) => sum + parseFloat(String(t.amount) || "0"), 0);
                    const bankExpense = accountFilteredTransactions.filter(t => t.type === "expense").reduce((sum, t) => sum + Math.abs(parseFloat(String(t.amount) || "0")), 0);
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
                    Todos ({accountFilteredTransactions.length})
                  </TabsTrigger>
                  <TabsTrigger value="uncategorized" data-testid="filter-uncategorized" className="text-amber-600">
                    Sin categorizar ({accountFilteredTransactions.filter(t => !t.categoryId).length})
                  </TabsTrigger>
                  <TabsTrigger value="categorized" data-testid="filter-categorized">
                    Categorizados ({accountFilteredTransactions.filter(t => t.categoryId).length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <DataTable
              columns={columns}
              data={filteredTransactions}
              isLoading={isLoading}
              searchPlaceholder="Buscar por descripcion o descripcion 2..."
              searchKeys={["description", "description2"]}
              emptyMessage={
                filterTab === "uncategorized" 
                  ? "No hay movimientos sin categorizar"
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
              <Select
                value={uploadBankAccountId}
                onValueChange={setUploadBankAccountId}
                disabled={bankAccounts.length === 0}
              >
                <SelectTrigger data-testid="select-upload-bank-account">
                  <SelectValue placeholder={bankAccounts.length ? "Seleccionar cuenta..." : "Cree una cuenta primero"} />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                      {a.local?.name ? ` · ${a.local.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Entidad bancaria (automática)</Label>
              <p className="text-sm text-muted-foreground">
                Se toma desde la caja/cuenta seleccionada. Si necesitás cambiarla, editá la cuenta en “Cuentas y cajas”.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Local (opcional)</Label>
              <Select value={uploadDefaultLocalId} onValueChange={setUploadDefaultLocalId}>
                <SelectTrigger data-testid="select-upload-default-local">
                  <SelectValue placeholder="Sin local (asignar luego)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin local (asignar luego)</SelectItem>
                  {locals.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              La suma de los montos brutos de los movimientos no coincide con el «Saldo disponible total» del archivo.
              Corregí el MONTO BRUTO en las filas indicadas (según tu Excel) y finalizá la importación, o suspendé para
              volver más tarde.
            </DialogDescription>
          </DialogHeader>
          {mpReconciliation && (
            <>
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
                <p className="font-medium text-foreground">{mpReconciliation.message}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-xs sm:text-sm mt-2">
                  <div>
                    <span className="text-muted-foreground">Saldo disponible total (archivo)</span>
                    <div className="font-semibold">{formatCurrency(mpReconciliation.saldoDisponibleTotal)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Suma brutos importables</span>
                    <div className="font-semibold">{formatCurrency(mpReconciliation.sumGrossImportable)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Diferencia</span>
                    <div className="font-semibold text-amber-800 dark:text-amber-200">
                      {formatCurrency(mpReconciliation.delta)}
                    </div>
                  </div>
                </div>
                {mpEstimatedSumGross != null && (
                  <p className="text-xs text-muted-foreground pt-1 border-t border-amber-500/20 mt-2">
                    Tras tus cambios en esta tabla, suma brutos estimada:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {formatCurrency(mpEstimatedSumGross)}
                    </span>
                    {Math.round(mpEstimatedSumGross * 100) ===
                    Math.round(mpReconciliation.saldoDisponibleTotal * 100) ? (
                      <span className="text-green-600 ml-2">— coincide con el archivo</span>
                    ) : null}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Hasta 10 filas candidatas. Los montos deben ser los del Excel en MONTO BRUTO (columna del extracto MP).
              </p>
              <ScrollArea className="max-h-[min(50vh,420px)] border rounded-md">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="p-2 font-medium">Fila Excel</th>
                      <th className="p-2 font-medium">Descripción</th>
                      <th className="p-2 font-medium text-right">Bruto actual</th>
                      <th className="p-2 font-medium">Bruto corregido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mpReconciliation.rows.map((row) => (
                      <tr key={row.excelRow} className="border-b border-border/60">
                        <td className="p-2 font-mono">{row.excelRow}</td>
                        <td className="p-2 max-w-[200px] truncate" title={row.description}>
                          {row.description || "—"}
                        </td>
                        <td className="p-2 text-right font-mono">{formatCurrency(row.montoBrutoActual)}</td>
                        <td className="p-2 w-[140px]">
                          <Input
                            className="font-mono h-9"
                            inputMode="decimal"
                            value={mpGrossDrafts[row.excelRow] ?? ""}
                            onChange={(e) =>
                              setMpGrossDrafts((prev) => ({
                                ...prev,
                                [row.excelRow]: e.target.value,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </>
          )}
          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={handleSuspendMpReconciliation}>
              Suspender importación
            </Button>
            <Button
              type="button"
              onClick={handleFinalizeMpReconciliation}
              disabled={uploadMutation.isPending || !mpReconciliation}
            >
              {uploadMutation.isPending ? "Importando..." : "Finalizar importación"}
            </Button>
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
              <Select value={newAccountBusinessNameId} onValueChange={setNewAccountBusinessNameId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar razón social..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar...</SelectItem>
                  {businessNames.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label className="text-xs text-muted-foreground">Entidad bancaria *</Label>
              <Select value={newAccountBankId} onValueChange={setNewAccountBankId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar entidad..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Seleccionar...</SelectItem>
                  {availableBanks.map((bank) => (
                    <SelectItem key={bank.id} value={bank.id}>
                      {bank.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label className="text-xs text-muted-foreground">Local (opcional)</Label>
              <Select value={newAccountLocalId} onValueChange={setNewAccountLocalId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin local</SelectItem>
                  {locals.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      <Dialog open={isSaveViewDialogOpen} onOpenChange={setIsSaveViewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar vista</DialogTitle>
            <DialogDescription>
              Guarda el banco activo, el filtro de cuenta y la pestaña de categorización para recuperarlos con un clic.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={saveViewName}
                onChange={(e) => setSaveViewName(e.target.value)}
                placeholder="Ej. Galicia + cuenta caja"
                data-testid="input-save-view-name"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsSaveViewDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSaveCurrentView}
                disabled={saveViewMutation.isPending}
                data-testid="button-confirm-save-view"
              >
                {saveViewMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                <Select 
                  value={selectedCategoryId} 
                  onValueChange={setSelectedCategoryId}
                >
                  <SelectTrigger data-testid="select-category">
                    <SelectValue placeholder="Seleccionar categoria..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin categoria</SelectItem>
                    {(selectedTransaction.type === "income" ? incomeCategories : expenseCategories).map(cat => (
                      <SelectItem key={cat.id} value={String(cat.id)}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Local</Label>
                <Select value={selectedLocalId} onValueChange={setSelectedLocalId}>
                  <SelectTrigger data-testid="select-local">
                    <SelectValue placeholder="Seleccionar local..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {locals.map(l => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
          setSelectedDescription("");
          setSelectedDescription2("");
        }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Clasificacion Masiva</DialogTitle>
            <DialogDescription>
              {selectedTransactionIds.size > 0 
                ? `Vas a clasificar ${selectedTransactionIds.size} transacciones seleccionadas`
                : "Filtra por periodo y/o descripcion, asigna categoria y local"
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            {selectedTransactionIds.size === 0 && (
              <div className="grid gap-3 p-3 rounded-lg bg-muted/50">
                <p className="text-sm font-medium">1. Periodo (opcional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Desde</Label>
                    <Input
                      type="date"
                      value={batchDateFrom}
                      onChange={(e) => {
                        setBatchDateFrom(e.target.value);
                        setSelectedDescription("");
                        setSelectedDescription2("");
                      }}
                      data-testid="input-batch-date-from"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Hasta</Label>
                    <Input
                      type="date"
                      value={batchDateTo}
                      onChange={(e) => {
                        setBatchDateTo(e.target.value);
                        setSelectedDescription("");
                        setSelectedDescription2("");
                      }}
                      data-testid="input-batch-date-to"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Solo se clasificaran transacciones SIN categoria dentro del rango
                </p>
              </div>
            )}

            {selectedTransactionIds.size === 0 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">2. Descripcion (opcional)</p>
                  <p className="text-xs text-muted-foreground">Linea principal del extracto</p>
                  {groupedDescriptions.length === 0 ? (
                    <div className="text-center py-4 text-sm text-muted-foreground rounded-lg bg-muted/50">
                      No hay movimientos sin clasificar {batchDateFrom && batchDateTo ? "en el periodo seleccionado" : ""}
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                      {groupedDescriptions.map((group) => (
                        <div
                          key={group.description}
                          className={`flex items-center justify-between gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                            selectedDescription === group.description
                              ? "bg-primary/10 border border-primary/30"
                              : "bg-muted/50 hover-elevate"
                          }`}
                          onClick={() => {
                            setSelectedDescription(
                              selectedDescription === group.description ? "" : group.description
                            );
                          }}
                          data-testid={`desc-group-${group.description.slice(0, 20)}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{group.description}</p>
                          </div>
                          <Badge variant="secondary">
                            {group.count} mov.
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedDescription && (
                    <p className="text-xs text-muted-foreground">
                      Seleccionado: <span className="font-medium">{selectedDescription}</span> ({groupedDescriptions.find(g => g.description === selectedDescription)?.count || 0} mov.)
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Descripcion 2 (opcional)</p>
                  <p className="text-xs text-muted-foreground">
                    Segunda linea cuando el banco la aporta (p. ej. Galicia, Mercado Pago). Podes combinar con la linea principal para acotar mas.
                  </p>
                  {groupedDescriptions2.length === 0 ? (
                    <div className="text-center py-3 text-sm text-muted-foreground rounded-lg bg-muted/50">
                      No hay segunda descripcion en movimientos sin clasificar
                      {batchDateFrom && batchDateTo ? " en el periodo seleccionado" : ""}
                    </div>
                  ) : (
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {groupedDescriptions2.map((group) => (
                        <div
                          key={group.description2}
                          className={`flex items-center justify-between gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                            selectedDescription2 === group.description2
                              ? "bg-primary/10 border border-primary/30"
                              : "bg-muted/50 hover-elevate"
                          }`}
                          onClick={() => {
                            setSelectedDescription2(
                              selectedDescription2 === group.description2 ? "" : group.description2
                            );
                          }}
                          data-testid={`desc2-group-${group.description2.slice(0, 24)}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{group.description2}</p>
                          </div>
                          <Badge variant="secondary">{group.count} mov.</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedDescription2 && (
                    <p className="text-xs text-muted-foreground">
                      Seleccionado detalle: <span className="font-medium">{selectedDescription2}</span> (
                      {groupedDescriptions2.find((g) => g.description2 === selectedDescription2)?.count || 0}{" "}
                      mov.)
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">3. Categoria a Asignar</p>
              <Select 
                value={batchCategoryId} 
                onValueChange={setBatchCategoryId}
              >
                <SelectTrigger data-testid="select-batch-category">
                  <SelectValue placeholder="Seleccionar categoria..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={String(cat.id)}>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {cat.type === "income" ? "I" : cat.type === "expense" ? "E" : "B"}
                        </Badge>
                        {cat.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">4. Local (opcional)</p>
              <Select value={batchLocalId} onValueChange={setBatchLocalId}>
                <SelectTrigger data-testid="select-batch-local">
                  <SelectValue placeholder="Seleccionar local..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {locals.map(l => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {batchCategoryId &&
              (selectedTransactionIds.size > 0 ||
                (batchDateFrom && batchDateTo) ||
                selectedDescription.trim() ||
                selectedDescription2.trim()) && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-700 dark:text-amber-300">Resumen</p>
                    <p className="text-muted-foreground">
                      Categoria: <span className="font-medium">{categories.find(c => c.id === parseInt(batchCategoryId))?.name}</span>
                      {selectedDescription.trim() && (
                        <>
                          <br />
                          Descripcion: <span className="font-medium">{selectedDescription}</span>
                        </>
                      )}
                      {selectedDescription2.trim() && (
                        <>
                          <br />
                          Descripcion 2: <span className="font-medium">{selectedDescription2}</span>
                        </>
                      )}
                      {batchDateFrom && batchDateTo && <><br />Periodo: {batchDateFrom} a {batchDateTo}</>}
                      {selectedTransactionIds.size > 0 && <><br />{selectedTransactionIds.size} transacciones seleccionadas</>}
                      {batchLocalId && batchLocalId !== "none" && <><br />Local: <span className="font-medium">{locals.find(l => l.id === parseInt(batchLocalId))?.name}</span></>}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button 
                variant="outline" 
                onClick={() => {
                  setIsBatchCategorizeOpen(false);
                  setBatchCategoryId("");
                  setBatchLocalId("");
                  setBatchDateFrom("");
                  setBatchDateTo("");
                  setSelectedDescription("");
                  setSelectedDescription2("");
                }} 
                data-testid="button-cancel-batch"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleBatchCategorize}
                disabled={
                  batchCategorizeMutation.isPending ||
                  !batchCategoryId ||
                  (selectedTransactionIds.size === 0 &&
                    !batchDateFrom &&
                    !batchDateTo &&
                    !selectedDescription.trim() &&
                    !selectedDescription2.trim())
                }
                data-testid="button-apply-batch"
              >
                {batchCategorizeMutation.isPending ? "Procesando..." : "Aplicar Clasificacion"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isSplitOpen} onOpenChange={setIsSplitOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dividir Movimiento por Local</DialogTitle>
            <DialogDescription>
              Divide este movimiento en partes asignadas a diferentes locales
            </DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Movimiento original</p>
                <p className="font-medium truncate">{selectedTransaction.description}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground">
                    {formatDate(selectedTransaction.transactionDate)}
                  </span>
                  <span className={`font-mono font-medium ${
                    selectedTransaction.type === "income" ? "text-green-600" : "text-red-600"
                  }`}>
                    {formatCurrency(Math.abs(parseFloat(String(selectedTransaction.amount) || "0")))}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Partes del movimiento</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addSplitItem}
                    data-testid="button-add-split"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Agregar
                  </Button>
                </div>
                
                {splitItems.map((item, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <Select
                      value={item.localId ? String(item.localId) : ""}
                      onValueChange={(v) => updateSplitItem(index, "localId", v ? parseInt(v) : null)}
                    >
                      <SelectTrigger className="flex-1" data-testid={`select-split-local-${index}`}>
                        <SelectValue placeholder="Seleccionar local..." />
                      </SelectTrigger>
                      <SelectContent>
                        {locals.map(local => (
                          <SelectItem key={local.id} value={String(local.id)}>
                            {local.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      placeholder="Monto"
                      value={item.amount}
                      onChange={(e) => updateSplitItem(index, "amount", e.target.value)}
                      className="w-32 font-mono"
                      data-testid={`input-split-amount-${index}`}
                    />
                    {splitItems.length > 2 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeSplitItem(index)}
                        data-testid={`button-remove-split-${index}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                ))}

                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-sm text-muted-foreground">Total asignado</span>
                  <span className={`font-mono font-medium ${
                    Math.abs(splitItems.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0) - 
                      Math.abs(parseFloat(String(selectedTransaction.amount) || "0"))) < 0.01
                      ? "text-green-600"
                      : "text-amber-600"
                  }`}>
                    {formatCurrency(splitItems.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0))}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setIsSplitOpen(false);
                    setSelectedTransaction(null);
                  }} 
                  data-testid="button-cancel-split"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleSplit}
                  disabled={splitMutation.isPending}
                  data-testid="button-apply-split"
                >
                  {splitMutation.isPending ? "Procesando..." : "Dividir Movimiento"}
                </Button>
              </div>
            </div>
          )}
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
                <Select
                  value={mapping.localId ? String(mapping.localId) : ""}
                  onValueChange={(v) => updateBranchMapping(index, v ? parseInt(v) : null)}
                >
                  <SelectTrigger className="w-48" data-testid={`select-branch-mapping-${index}`}>
                    <SelectValue placeholder="Seleccionar local..." />
                  </SelectTrigger>
                  <SelectContent>
                    {locals.map(local => (
                      <SelectItem key={local.id} value={String(local.id)}>
                        {local.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
