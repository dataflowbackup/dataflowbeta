import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/formatters";
import type { Transaction, Local, BankAccount, TransactionCategory, InternalLoan } from "@shared/schema";

type RowTx = Pick<Transaction, "id" | "source" | "localId" | "amount" | "description" | "type" | "parentTransactionId">;

/**
 * Punto 10 (jul-27): acción por fila "Préstamo interno a otro local".
 * Sobre un movimiento (Cabildo pagó un gasto de Córdoba) permite: elegir local destino,
 * cuenta destino y categoría del gasto; el backend recategoriza el origen a "Préstamo" y crea
 * en el destino un "Préstamo a favor" + el gasto real (netean 0). Si el movimiento ya es el
 * origen de un préstamo interno activo, ofrece deshacerlo.
 *
 * jul-29: los 2 movimientos del destino pasaron de caer en una caja de efectivo a caer en una
 * Cuenta (bank_accounts), igual que la división por locales. Como netean 0, el saldo de esa
 * cuenta no cambia.
 */
export function InternalLoanButton({ transaction }: { transaction: RowTx }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [toLocalId, setToLocalId] = useState<string>("");
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [expenseCategoryId, setExpenseCategoryId] = useState<string>("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({ queryKey: ["/api/bank-accounts"] });
  const { data: categories = [] } = useQuery<TransactionCategory[]>({ queryKey: ["/api/transaction-categories"] });
  const { data: internalLoans = [] } = useQuery<InternalLoan[]>({ queryKey: ["/api/internal-loans"] });

  const existingLoan = useMemo(
    () => internalLoans.find((l) => l.originTransactionId === transaction.id && l.status === "active"),
    [internalLoans, transaction.id],
  );

  const expenseCategories = useMemo(
    () =>
      [...categories]
        .filter((c) => c.active !== false && c.type === "expense" && c.specialType == null)
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
    [categories],
  );

  const activeAccounts = useMemo(
    () => bankAccounts.filter((a) => a.active !== false),
    [bankAccounts],
  );

  // Al elegir el local destino, se sugiere su propia cuenta.
  const suggestedAccountId = useMemo(() => {
    if (!toLocalId) return "";
    const lid = parseInt(toLocalId, 10);
    const own = activeAccounts.find((a) => a.localId === lid);
    return own ? String(own.id) : "";
  }, [toLocalId, activeAccounts]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/internal-loans"] });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/internal-loans", {
        originTransactionId: transaction.id,
        toLocalId: parseInt(toLocalId, 10),
        bankAccountId: parseInt(bankAccountId || suggestedAccountId, 10),
        expenseCategoryId: parseInt(expenseCategoryId, 10),
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Préstamo interno creado" });
      setOpen(false);
      setToLocalId("");
      setBankAccountId("");
      setExpenseCategoryId("");
      invalidate();
    },
    onError: (e: any) => toast({ title: e?.message ?? "No se pudo crear el préstamo", variant: "destructive" }),
  });

  const undoMut = useMutation({
    mutationFn: async () => {
      if (!existingLoan) return;
      const res = await apiRequest("DELETE", `/api/internal-loans/${existingLoan.id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Préstamo interno deshecho" });
      setConfirmUndo(false);
      invalidate();
    },
    onError: (e: any) => toast({ title: e?.message ?? "No se pudo deshacer", variant: "destructive" }),
  });

  // Los movimientos generados por un préstamo no ofrecen la acción.
  if (transaction.source === "internal_loan") return null;
  // Las partes de una división no pueden ser origen de un préstamo (salvo que ya lo sean, caso imposible).
  if (!existingLoan && transaction.parentTransactionId != null) return null;

  const amount = Math.abs(parseFloat(String(transaction.amount)) || 0);
  const sameLocalSelected = toLocalId !== "" && transaction.localId != null && parseInt(toLocalId, 10) === transaction.localId;
  const effectiveAccountId = bankAccountId || suggestedAccountId;
  const canSubmit = toLocalId !== "" && effectiveAccountId !== "" && expenseCategoryId !== "" && !sameLocalSelected;

  if (existingLoan) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-amber-600"
          title="Deshacer préstamo interno"
          data-testid={`button-undo-internal-loan-${transaction.id}`}
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
              <AlertDialogTitle>Deshacer préstamo interno</AlertDialogTitle>
              <AlertDialogDescription>
                Se borrarán los dos movimientos creados en el local destino (préstamo a favor y gasto) y este
                movimiento volverá a su categoría original. ¿Confirmás?
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

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="Préstamo interno a otro local"
        data-testid={`button-internal-loan-${transaction.id}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <ArrowLeftRight className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Préstamo interno a otro local</DialogTitle>
            <DialogDescription>
              Este movimiento ({formatCurrency(amount)}) se recategoriza como <strong>Préstamo</strong>. En el local
              destino se crean un <strong>Préstamo a favor</strong> y el <strong>gasto real</strong> por el mismo
              importe (netean 0, no cambian el saldo del destino).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Local destino (el que absorbe el gasto)</Label>
              <Select value={toLocalId} onValueChange={setToLocalId}>
                <SelectTrigger data-testid="select-internal-loan-local">
                  <SelectValue placeholder="Elegí el local destino" />
                </SelectTrigger>
                <SelectContent>
                  {locals.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)} disabled={transaction.localId != null && l.id === transaction.localId}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sameLocalSelected && (
                <p className="text-xs text-destructive">El local destino debe ser distinto al de origen.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Cuenta destino (donde caen los dos movimientos)</Label>
              <Select value={effectiveAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger data-testid="select-internal-loan-cuenta">
                  <SelectValue placeholder="Elegí la cuenta destino" />
                </SelectTrigger>
                <SelectContent>
                  {activeAccounts.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeAccounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay cuentas. Creá una en Extractos.</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Los dos movimientos netean $0: el saldo de esta cuenta no cambia.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Categoría del gasto (ej. Luz)</Label>
              <Select value={expenseCategoryId} onValueChange={setExpenseCategoryId}>
                <SelectTrigger data-testid="select-internal-loan-categoria">
                  <SelectValue placeholder="Elegí la categoría del gasto" />
                </SelectTrigger>
                <SelectContent>
                  {expenseCategories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={createMut.isPending}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => createMut.mutate()}
              disabled={!canSubmit || createMut.isPending}
              data-testid="button-confirm-internal-loan"
            >
              {createMut.isPending ? "Creando…" : "Crear préstamo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
