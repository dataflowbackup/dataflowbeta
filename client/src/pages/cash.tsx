import { useMemo, useState, useCallback } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate } from "@/lib/formatters";
import {
  Banknote,
  Plus,
  Trash2,
  Tag,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import type { Transaction, BankAccount, TransactionCategory, Local } from "@shared/schema";

interface TransactionWithRelations extends Transaction {
  bankAccount?: BankAccount | null;
  category?: TransactionCategory | null;
  local?: Local | null;
}

const CASH_BANK_SOURCE = "cash";

type DraftRow = {
  key: string;
  transactionDate: string;
  description: string;
  categoryId: string;
  localId: string;
  type: "income" | "expense";
  amount: string;
};

function makeDraftRow(): DraftRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    transactionDate: new Date().toISOString().slice(0, 10),
    description: "",
    categoryId: "",
    localId: "none",
    type: "expense",
    amount: "",
  };
}

export default function CashPage() {
  const { toast } = useToast();
  const [batchOpen, setBatchOpen] = useState(false);
  const [draftRows, setDraftRows] = useState<DraftRow[]>([makeDraftRow()]);
  const [editRow, setEditRow] = useState<TransactionWithRelations | null>(null);
  const [editCategoryId, setEditCategoryId] = useState<string>("");
  const [editLocalId, setEditLocalId] = useState<string>("none");
  const [deleteTarget, setDeleteTarget] = useState<TransactionWithRelations | null>(null);

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

  const totalIncome = useMemo(
    () =>
      transactions.filter((t) => t.type === "income").reduce((s, t) => s + parseFloat(String(t.amount) || "0"), 0),
    [transactions],
  );
  const totalExpense = useMemo(
    () =>
      transactions
        .filter((t) => t.type === "expense")
        .reduce((s, t) => s + Math.abs(parseFloat(String(t.amount) || "0")), 0),
    [transactions],
  );

  const openBatch = () => {
    setDraftRows([makeDraftRow()]);
    setBatchOpen(true);
  };

  const addDraftRow = () => setDraftRows((r) => [...r, makeDraftRow()]);
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
          amount: parseFloat(String(r.amount).replace(",", ".")),
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
      const amt = parseFloat(String(r.amount).replace(",", "."));
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
      const body: { categoryId?: number | null; localId?: number | null } = {};
      if (editCategoryId !== "") body.categoryId = parseInt(editCategoryId, 10);
      else body.categoryId = null;
      body.localId = editLocalId === "none" ? null : parseInt(editLocalId, 10);
      await apiRequest("PATCH", `/api/transactions/${editRow.id}`, body);
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
      header: "",
      cell: (row) => (
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" title="Clasificar / local" onClick={() => openEdit(row)}>
            <Tag className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" title="Eliminar" onClick={() => setDeleteTarget(row)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  const categoriasForType = (t: "income" | "expense") =>
    t === "income" ? incomeCategories : expenseCategories;

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

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingresos</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-green-600">{formatCurrency(totalIncome)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Egresos</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-red-600">{formatCurrency(totalExpense)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Movimientos</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{transactions.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <DataTable
              columns={columns}
              data={transactions}
              pageSize={25}
              searchKeys={["description"]}
              emptyMessage="No hay movimientos en efectivo registrados."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Nuevo movimiento en efectivo</DialogTitle>
            <DialogDescription>
              Podés agregar varias filas y guardarlas todas en una sola operación.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[55vh] pr-3">
            <div className="space-y-4">
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
                    <Select
                      value={r.type}
                      onValueChange={(v) => patchDraft(r.key, { type: v as "income" | "expense", categoryId: "" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="income">Ingreso</SelectItem>
                        <SelectItem value="expense">Egreso</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-3 space-y-1">
                    <Label className="text-xs">Importe</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={r.amount}
                      onChange={(e) => patchDraft(r.key, { amount: e.target.value })}
                    />
                  </div>
                  <div className="md:col-span-6 space-y-1">
                    <Label className="text-xs">Categoría</Label>
                    <Select
                      value={r.categoryId || undefined}
                      onValueChange={(v) => patchDraft(r.key, { categoryId: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir…" />
                      </SelectTrigger>
                      <SelectContent>
                        {categoriasForType(r.type).map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-6 space-y-1">
                    <Label className="text-xs">Local</Label>
                    <Select value={r.localId} onValueChange={(v) => patchDraft(r.key, { localId: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Opcional" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin asignar</SelectItem>
                        {locals.map((l) => (
                          <SelectItem key={l.id} value={String(l.id)}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
            <DialogTitle>Editar movimiento</DialogTitle>
            <DialogDescription>Categoría y local (misma regla que en extractos).</DialogDescription>
          </DialogHeader>
          {editRow && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label>Categoría</Label>
                <Select
                  value={editCategoryId ? editCategoryId : "__sin__"}
                  onValueChange={(v) => setEditCategoryId(v === "__sin__" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__sin__">Sin categoría</SelectItem>
                    {categoriasForType(editRow.type).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Local</Label>
                <Select value={editLocalId} onValueChange={setEditLocalId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {locals.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
