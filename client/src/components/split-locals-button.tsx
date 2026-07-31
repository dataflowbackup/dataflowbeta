import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Split, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategorySelectOptions, buildCategoryOptionGroups } from "@/components/category-select-options";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/formatters";
import type { Transaction, Local, BankAccount, TransactionCategory, FinancialGroup } from "@shared/schema";

type RowTx = Pick<
  Transaction,
  "id" | "source" | "localId" | "amount" | "description" | "type" | "parentTransactionId" | "bankAccountId"
>;

type SplitMode = "equal" | "percent" | "manual";

interface RowState {
  checked: boolean;
  value: string; // % o importe manual, según el modo
  categoryId: string; // "" = usa la categoría general
  accountId: string;
}

const toCents = (n: number) => Math.round((Number(n) || 0) * 100);
const fromCents = (c: number) => c / 100;

/**
 * División de un movimiento entre varios locales, generando los préstamos internos (jul-29).
 *
 * El original queda asentado en su cuenta pero deja de computar, y se parte en la MISMA cuenta:
 * la parte propia del local de origen (opcional) más una parte "Préstamo" por cada local destino.
 * En la cuenta de cada destino se crean 2 movimientos que netean 0 (el préstamo y el gasto/ingreso
 * real). Ningún saldo de ninguna cuenta cambia.
 */
export function SplitLocalsButton({
  transaction,
  isSplitParent,
}: {
  transaction: RowTx;
  isSplitParent: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);

  const [originLocalId, setOriginLocalId] = useState<string>("");
  const [mainCategoryId, setMainCategoryId] = useState<string>("");
  const [includeOrigin, setIncludeOrigin] = useState(true);
  const [originValue, setOriginValue] = useState("");
  const [originCategoryId, setOriginCategoryId] = useState<string>("");
  const [mode, setMode] = useState<SplitMode>("equal");
  const [rows, setRows] = useState<Record<number, RowState>>({});

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({ queryKey: ["/api/bank-accounts"] });
  const { data: categories = [] } = useQuery<TransactionCategory[]>({ queryKey: ["/api/transaction-categories"] });
  const { data: financialGroups = [] } = useQuery<FinancialGroup[]>({ queryKey: ["/api/financial-groups"] });

  const isIncome = transaction.type === "income";
  const totalCentsOriginal = toCents(Math.abs(parseFloat(String(transaction.amount)) || 0));

  // Todas las categorías activas (ventas, gastos y movimientos financieros), agrupadas.
  const categoryGroupsForSelect = useMemo(
    () => buildCategoryOptionGroups(categories, financialGroups, isIncome ? "income" : "expense"),
    [categories, financialGroups, isIncome],
  );

  const activeAccounts = useMemo(
    () => bankAccounts.filter((a) => a.active !== false),
    [bankAccounts],
  );

  // Cuenta sugerida por local: la primera cuenta de ese local.
  const defaultAccountByLocal = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of activeAccounts) {
      if (a.localId != null && !map.has(a.localId)) map.set(a.localId, a.id);
    }
    return map;
  }, [activeAccounts]);

  const effectiveOriginLocalId = transaction.localId ?? (originLocalId ? parseInt(originLocalId, 10) : null);

  const destinationLocals = useMemo(
    () => locals.filter((l) => l.id !== effectiveOriginLocalId),
    [locals, effectiveOriginLocalId],
  );

  // Al abrir, precarga estado limpio con la cuenta sugerida de cada local.
  useEffect(() => {
    if (!open) return;
    setOriginLocalId(transaction.localId != null ? String(transaction.localId) : "");
    setMainCategoryId("");
    setOriginCategoryId("");
    setIncludeOrigin(true);
    setOriginValue("");
    setMode("equal");
    const next: Record<number, RowState> = {};
    for (const l of locals) {
      const accId = defaultAccountByLocal.get(l.id);
      next[l.id] = { checked: false, value: "", categoryId: "", accountId: accId != null ? String(accId) : "" };
    }
    setRows(next);
  }, [open, locals, defaultAccountByLocal, transaction.localId]);

  const selectedLocalIds = useMemo(
    () => destinationLocals.filter((l) => rows[l.id]?.checked).map((l) => l.id),
    [destinationLocals, rows],
  );

  /**
   * Reparto en centavos. El resto del redondeo va SIEMPRE al local de origen si participa;
   * si no participa, al primer destino. Así la suma da exacta al centavo.
   */
  const computed = useMemo(() => {
    const participants = selectedLocalIds.length + (includeOrigin ? 1 : 0);
    const amounts = new Map<number, number>(); // localId -> centavos
    let originCents = 0;
    if (participants === 0 || totalCentsOriginal <= 0) {
      return { amounts, originCents, assignedCents: 0 };
    }

    if (mode === "equal") {
      const base = Math.floor(totalCentsOriginal / participants);
      let remainder = totalCentsOriginal - base * participants;
      if (includeOrigin) {
        originCents = base + remainder;
        remainder = 0;
      }
      for (let i = 0; i < selectedLocalIds.length; i++) {
        const extra = !includeOrigin && i === 0 ? remainder : 0;
        amounts.set(selectedLocalIds[i], base + extra);
      }
    } else if (mode === "percent") {
      let used = 0;
      for (const id of selectedLocalIds) {
        const pct = parseFloat(rows[id]?.value ?? "") || 0;
        const c = Math.round((totalCentsOriginal * pct) / 100);
        amounts.set(id, c);
        used += c;
      }
      if (includeOrigin) {
        const pct = parseFloat(originValue) || 0;
        originCents = Math.round((totalCentsOriginal * pct) / 100);
        used += originCents;
      }
      // El resto por redondeo de porcentajes cae en el origen (o en el primer destino).
      const rest = totalCentsOriginal - used;
      if (rest !== 0) {
        if (includeOrigin) originCents += rest;
        else if (selectedLocalIds.length > 0) {
          amounts.set(selectedLocalIds[0], (amounts.get(selectedLocalIds[0]) ?? 0) + rest);
        }
      }
    } else {
      for (const id of selectedLocalIds) amounts.set(id, toCents(parseFloat(rows[id]?.value ?? "") || 0));
      if (includeOrigin) originCents = toCents(parseFloat(originValue) || 0);
    }

    let assignedCents = originCents;
    amounts.forEach((v) => {
      assignedCents += v;
    });
    return { amounts, originCents, assignedCents };
  }, [mode, selectedLocalIds, includeOrigin, originValue, rows, totalCentsOriginal]);

  const diffCents = computed.assignedCents - totalCentsOriginal;
  const sumaExacta = diffCents === 0 && selectedLocalIds.length > 0;
  const missingAccounts = selectedLocalIds.filter((id) => !rows[id]?.accountId);
  const missingCategories =
    mainCategoryId === "" && selectedLocalIds.some((id) => !rows[id]?.categoryId);
  const missingOriginCategory =
    includeOrigin && computed.originCents > 0 && mainCategoryId === "" && originCategoryId === "";
  const missingOriginLocal = effectiveOriginLocalId == null;

  const canSubmit =
    sumaExacta &&
    !missingOriginLocal &&
    missingAccounts.length === 0 &&
    !missingCategories &&
    !missingOriginCategory;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/internal-loans"] });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const parts = selectedLocalIds.map((id) => ({
        localId: id,
        amount: fromCents(computed.amounts.get(id) ?? 0),
        categoryId: parseInt(rows[id]?.categoryId || mainCategoryId, 10),
        bankAccountId: parseInt(rows[id]!.accountId, 10),
      }));
      const res = await apiRequest("POST", `/api/transactions/${transaction.id}/split-locals`, {
        originLocalId: effectiveOriginLocalId,
        originShareAmount: includeOrigin ? fromCents(computed.originCents) : 0,
        originCategoryId:
          includeOrigin && computed.originCents > 0
            ? parseInt(originCategoryId || mainCategoryId, 10)
            : null,
        parts,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Movimiento dividido",
        description: `${data?.loans ?? 0} préstamos · ${data?.parts ?? 0} partes en la cuenta de origen · ${
          data?.destinationMovements ?? 0
        } movimientos en los destinos`,
      });
      setOpen(false);
      invalidate();
    },
    onError: (e: any) => toast({ title: e?.message ?? "No se pudo dividir el movimiento", variant: "destructive" }),
  });

  const undoMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/transactions/${transaction.id}/split-locals`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "División deshecha", description: "El movimiento volvió a ser uno solo." });
      setConfirmUndo(false);
      invalidate();
    },
    onError: (e: any) => toast({ title: e?.message ?? "No se pudo deshacer la división", variant: "destructive" }),
  });

  // Los movimientos generados y las partes de una división no se pueden dividir.
  if (transaction.source === "internal_loan" || transaction.source === "local_split") return null;
  if (transaction.parentTransactionId != null) return null;

  if (isSplitParent) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-amber-600"
          title="Deshacer división"
          data-testid={`button-undo-split-locals-${transaction.id}`}
          onClick={(e) => {
            e.stopPropagation();
            setConfirmUndo(true);
          }}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <AlertDialog open={confirmUndo} onOpenChange={setConfirmUndo}>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Deshacer la división</AlertDialogTitle>
              <AlertDialogDescription>
                Se borran todas las partes de la cuenta de origen y los dos movimientos creados en cada local
                destino. El movimiento vuelve a ser uno solo, como estaba. ¿Confirmás?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={undoMut.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  undoMut.mutate();
                }}
                disabled={undoMut.isPending}
              >
                {undoMut.isPending ? "Deshaciendo…" : "Deshacer"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  const setRow = (localId: number, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [localId]: { ...prev[localId], ...patch } }));

  const allSelected = destinationLocals.length > 0 && selectedLocalIds.length === destinationLocals.length;
  const toggleAll = () => {
    setRows((prev) => {
      const next = { ...prev };
      for (const l of destinationLocals) next[l.id] = { ...next[l.id], checked: !allSelected };
      return next;
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Dividir entre locales"
        data-testid={`button-split-locals-${transaction.id}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Split className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Dividir movimiento entre locales</DialogTitle>
            <DialogDescription>
              El movimiento original queda asentado en su cuenta pero deja de computar, y se parte en esa misma
              cuenta. Cada local destino recibe un <strong>préstamo</strong> y su{" "}
              <strong>{isIncome ? "ingreso" : "gasto"} real</strong>, que netean $0.{" "}
              <strong>Ningún saldo de ninguna cuenta cambia.</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="truncate font-medium">{transaction.description}</p>
              <p className={`font-mono text-lg ${isIncome ? "text-green-600" : "text-red-600"}`}>
                {isIncome ? "+" : "-"}
                {formatCurrency(fromCents(totalCentsOriginal))}
              </p>
            </div>

            {missingOriginLocal && (
              <div className="space-y-1.5">
                <Label className="text-xs">Local de origen (este movimiento no tiene local asignado)</Label>
                <Select value={originLocalId} onValueChange={setOriginLocalId}>
                  <SelectTrigger data-testid="select-split-origin-local">
                    <SelectValue placeholder="Elegí el local de origen" />
                  </SelectTrigger>
                  <SelectContent>
                    {locals.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Se le asigna al movimiento al confirmar la división.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Categoría (para todos)</Label>
                <Select value={mainCategoryId} onValueChange={setMainCategoryId}>
                  <SelectTrigger data-testid="select-split-main-category">
                    <SelectValue placeholder="Elegí la categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <CategorySelectOptions groups={categoryGroupsForSelect} />
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Se puede pisar local por local.</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Cómo se reparte</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as SplitMode)}>
                  <SelectTrigger data-testid="select-split-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equal">Partes iguales</SelectItem>
                    <SelectItem value="percent">Por porcentaje</SelectItem>
                    <SelectItem value="manual">Importe manual</SelectItem>
                  </SelectContent>
                </Select>
                {mode === "equal" && (
                  <p className="text-xs text-muted-foreground">
                    El resto del redondeo va al local de origen.
                  </p>
                )}
              </div>
            </div>

            {/* Local de origen */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="split-include-origin"
                  checked={includeOrigin}
                  onCheckedChange={(v) => setIncludeOrigin(v === true)}
                  data-testid="checkbox-split-include-origin"
                />
                <Label htmlFor="split-include-origin" className="text-sm font-medium cursor-pointer">
                  El local de origen absorbe una parte
                  {effectiveOriginLocalId != null && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {locals.find((l) => l.id === effectiveOriginLocalId)?.name ?? ""}
                    </span>
                  )}
                </Label>
              </div>
              {!includeOrigin && (
                <p className="text-xs text-muted-foreground">
                  El local de origen no absorbe {isIncome ? "ingreso" : "gasto"}: el importe completo queda como
                  préstamos a los otros locales.
                </p>
              )}
              {includeOrigin && (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  {mode !== "equal" && (
                    <Input
                      type="number"
                      className="w-32 font-mono"
                      placeholder={mode === "percent" ? "%" : "Importe"}
                      value={originValue}
                      onChange={(e) => setOriginValue(e.target.value)}
                      data-testid="input-split-origin-value"
                    />
                  )}
                  <Badge variant="secondary" className="font-mono">
                    {formatCurrency(fromCents(computed.originCents))}
                  </Badge>
                  <Select value={originCategoryId} onValueChange={setOriginCategoryId}>
                    <SelectTrigger className="h-9 w-[220px]" data-testid="select-split-origin-category">
                      <SelectValue placeholder="Categoría general" />
                    </SelectTrigger>
                    <SelectContent>
                      <CategorySelectOptions groups={categoryGroupsForSelect} />
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">Queda en la cuenta del movimiento original</span>
                </div>
              )}
            </div>

            {/* Locales destino */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Locales destino ({selectedLocalIds.length} seleccionados)</Label>
                <Button type="button" variant="outline" size="sm" onClick={toggleAll} data-testid="button-split-toggle-all">
                  {allSelected ? "Quitar todos" : "Seleccionar todos"}
                </Button>
              </div>

              <div className="rounded-lg border divide-y max-h-[320px] overflow-y-auto">
                {destinationLocals.map((l) => {
                  const r = rows[l.id];
                  if (!r) return null;
                  const cents = computed.amounts.get(l.id) ?? 0;
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 p-2">
                      <Checkbox
                        checked={r.checked}
                        onCheckedChange={(v) => setRow(l.id, { checked: v === true })}
                        data-testid={`checkbox-split-local-${l.id}`}
                      />
                      <span className="min-w-[150px] flex-1 truncate text-sm">{l.name}</span>

                      {r.checked && mode !== "equal" && (
                        <Input
                          type="number"
                          className="w-28 font-mono"
                          placeholder={mode === "percent" ? "%" : "Importe"}
                          value={r.value}
                          onChange={(e) => setRow(l.id, { value: e.target.value })}
                          data-testid={`input-split-value-${l.id}`}
                        />
                      )}
                      {r.checked && (
                        <>
                          <Badge variant="secondary" className="font-mono">
                            {formatCurrency(fromCents(cents))}
                          </Badge>
                          <Select value={r.categoryId} onValueChange={(v) => setRow(l.id, { categoryId: v })}>
                            <SelectTrigger className="h-9 w-[180px]" data-testid={`select-split-category-${l.id}`}>
                              <SelectValue placeholder="Categoría general" />
                            </SelectTrigger>
                            <SelectContent>
                              <CategorySelectOptions groups={categoryGroupsForSelect} />
                            </SelectContent>
                          </Select>
                          <Select value={r.accountId} onValueChange={(v) => setRow(l.id, { accountId: v })}>
                            <SelectTrigger
                              className={`h-9 w-[200px] ${!r.accountId ? "border-destructive" : ""}`}
                              data-testid={`select-split-account-${l.id}`}
                            >
                              <SelectValue placeholder="Cuenta destino" />
                            </SelectTrigger>
                            <SelectContent>
                              {activeAccounts.map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>
                  );
                })}
                {destinationLocals.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">No hay otros locales para repartir.</p>
                )}
              </div>
            </div>

            {/* Control de suma: es el candado del saldo */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="text-sm">
                <p className="text-muted-foreground">Total asignado</p>
                <p className="text-xs text-muted-foreground">
                  {selectedLocalIds.length} préstamo{selectedLocalIds.length === 1 ? "" : "s"} ·{" "}
                  {selectedLocalIds.length * 2} movimientos en los destinos
                </p>
              </div>
              <div className="text-right">
                <p className={`font-mono text-lg font-semibold ${sumaExacta ? "text-green-600" : "text-amber-600"}`}>
                  {formatCurrency(fromCents(computed.assignedCents))}
                </p>
                <p className="text-xs text-muted-foreground">
                  {diffCents === 0
                    ? "Coincide exacto con el original"
                    : `${diffCents > 0 ? "Sobran" : "Faltan"} ${formatCurrency(Math.abs(fromCents(diffCents)))}`}
                </p>
              </div>
            </div>

            {missingAccounts.length > 0 && (
              <p className="text-xs text-destructive">
                Falta elegir la cuenta destino de {missingAccounts.length} local
                {missingAccounts.length === 1 ? "" : "es"}.
              </p>
            )}
            {(missingCategories || missingOriginCategory) && (
              <p className="text-xs text-destructive">
                Falta la categoría: elegí una general o una por local.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={createMut.isPending}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => createMut.mutate()}
              disabled={!canSubmit || createMut.isPending}
              data-testid="button-confirm-split-locals"
            >
              {createMut.isPending ? "Dividiendo…" : "Dividir movimiento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
