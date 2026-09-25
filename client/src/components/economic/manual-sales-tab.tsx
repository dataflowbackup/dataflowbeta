/**
 * Solapa VENTAS MANUALES del Estado de Resultado Económico.
 *
 * Ventas que no pasan por FUDO, Datalive ni Shares: eventos, catering, alquiler del salón, lo que
 * sea. Se suman a las ventas del mes en el informe.
 *
 * El medio de pago es opcional pero importa: define si esa venta entra en la base de IIBB cuando se
 * calcula por medio de pago. Sale de un desplegable con los mismos nombres que usa FUDO.
 *
 * "Facturada" define si se le quita el IVA en el informe (÷1,21) y si entra en la base de IIBB
 * sobre ventas facturadas.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Plus, Trash2, Pencil, X, Check, Receipt } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { Local } from "@shared/schema";
import { MANUAL_SALE_PAYMENT_METHODS, paymentMethodLabel } from "@shared/economicStatement";
import { ECON, MoneyInput, LocalPicker, EmptyHint } from "./econ-shared";

interface ManualSaleRow {
  id: number;
  localId: number;
  economicMonth: string;
  concept: string;
  paymentMethod: string | null;
  invoiced: boolean | null;
  amount: string | number | null;
  notes: string | null;
}

const num = (v: string | number | null | undefined) => parseFloat(String(v ?? "0")) || 0;

/** El Select no admite value="": "sin medio" se representa con esta clave. */
const SIN_MEDIO = "__none__";

function PaymentMethodSelect({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId?: string }) {
  // Una venta vieja cargada con texto libre ("transferencia bna") sigue apareciendo tal cual.
  const legacy = value && !MANUAL_SALE_PAYMENT_METHODS.some((m) => m.value === value) ? value : null;
  return (
    <Select value={value || SIN_MEDIO} onValueChange={(v) => onChange(v === SIN_MEDIO ? "" : v)}>
      <SelectTrigger className={ECON.ring} data-testid={testId}>
        <SelectValue placeholder="Elegí el medio" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SIN_MEDIO}>Sin especificar</SelectItem>
        {MANUAL_SALE_PAYMENT_METHODS.map((m) => (
          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
        ))}
        {legacy && <SelectItem value={legacy}>{legacy}</SelectItem>}
      </SelectContent>
    </Select>
  );
}

function InvoicedSelect({ value, onChange, testId }: { value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <Select value={value ? "si" : "no"} onValueChange={(v) => onChange(v === "si")}>
      <SelectTrigger className={ECON.ring} data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="si">Sí, facturada</SelectItem>
        <SelectItem value="no">No facturada</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function ManualSalesTab({
  locals,
  economicMonth,
  monthLabel,
}: {
  locals: Local[];
  economicMonth: string;
  monthLabel: string;
}) {
  const { toast } = useToast();
  const [localId, setLocalId] = useState<number | null>(locals[0]?.id ?? null);
  useEffect(() => {
    if (localId == null && locals.length > 0) setLocalId(locals[0].id);
  }, [locals, localId]);

  const [concept, setConcept] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [invoiced, setInvoiced] = useState(false);
  const [amount, setAmount] = useState(0);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editConcept, setEditConcept] = useState("");
  const [editMethod, setEditMethod] = useState("");
  const [editInvoiced, setEditInvoiced] = useState(false);
  const [editAmount, setEditAmount] = useState(0);

  useEffect(() => {
    setEditingId(null);
    setConcept("");
    setPaymentMethod("");
    setInvoiced(false);
    setAmount(0);
  }, [localId, economicMonth]);

  const { data: rows = [], isLoading } = useQuery<ManualSaleRow[]>({
    queryKey: ["/api/economic/manual-sales", localId, economicMonth],
    enabled: localId != null,
    queryFn: async () => {
      const res = await fetch(`/api/economic/manual-sales?localId=${localId}&economicMonth=${economicMonth}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/economic/manual-sales"] });

  const createMut = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/economic/manual-sales", {
        localId,
        economicMonth,
        concept: concept.trim(),
        paymentMethod: paymentMethod.trim() || null,
        invoiced,
        amount,
      })).json(),
    onSuccess: () => {
      invalidate();
      setConcept("");
      setPaymentMethod("");
      setInvoiced(false);
      setAmount(0);
      toast({ title: "Venta agregada" });
    },
    onError: (e: Error) => toast({ title: "No se pudo agregar", description: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async (id: number) =>
      (await apiRequest("PUT", `/api/economic/manual-sales/${id}`, {
        concept: editConcept.trim(),
        paymentMethod: editMethod.trim() || null,
        invoiced: editInvoiced,
        amount: editAmount,
      })).json(),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast({ title: "Venta actualizada" });
    },
    onError: (e: Error) => toast({ title: "No se pudo actualizar", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/economic/manual-sales/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Venta eliminada" });
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const startEdit = (r: ManualSaleRow) => {
    setEditingId(r.id);
    setEditConcept(r.concept);
    setEditMethod(r.paymentMethod ?? "");
    setEditInvoiced(!!r.invoiced);
    setEditAmount(num(r.amount));
  };

  const total = rows.reduce((s, r) => s + num(r.amount), 0);

  if (locals.length === 0) return <p className="text-sm text-muted-foreground">No hay locales cargados.</p>;

  return (
    <div className="space-y-4">
      <Card className={ECON.border}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className={`h-4 w-4 ${ECON.text}`} /> Ventas manuales de {monthLabel}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Ventas que no pasan por el sistema de gestión: eventos, catering, alquiler del salón. Se suman
            a las ventas del mes en el Estado de Resultado.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <LocalPicker locals={locals} value={localId} onChange={setLocalId} />
            <div className="space-y-1">
              <Label className="text-xs">Total de ventas manuales del mes</Label>
              <p className={`text-2xl font-bold font-mono ${ECON.text}`} data-testid="text-manual-sales-total">
                {formatCurrency(total)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_180px_150px_160px_auto] items-end">
            <div className="space-y-1">
              <Label className="text-xs">Concepto</Label>
              <Input
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="Ej: Evento cumpleaños 15/09"
                className={ECON.ring}
                data-testid="input-manual-sale-concept"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Medio de pago</Label>
              <PaymentMethodSelect value={paymentMethod} onChange={setPaymentMethod} testId="select-manual-sale-method" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">¿Facturada?</Label>
              <InvoicedSelect value={invoiced} onChange={setInvoiced} testId="select-manual-sale-invoiced" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Importe</Label>
              <MoneyInput value={amount} onChange={setAmount} testId="input-manual-sale-amount" />
            </div>
            <Button
              className={ECON.bgSolid}
              disabled={!concept.trim() || createMut.isPending || localId == null}
              onClick={() => createMut.mutate()}
              data-testid="button-add-manual-sale"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Agregar
            </Button>
          </div>

          {isLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyHint>No hay ventas manuales cargadas en {monthLabel} para este local.</EmptyHint>
          ) : (
            <div className="space-y-1">
              {rows.map((r) =>
                editingId === r.id ? (
                  <div key={r.id} className="grid gap-2 sm:grid-cols-[1fr_180px_150px_160px_auto] items-end py-1 border-b last:border-0">
                    <Input value={editConcept} onChange={(e) => setEditConcept(e.target.value)} className={ECON.ring} />
                    <PaymentMethodSelect value={editMethod} onChange={setEditMethod} />
                    <InvoicedSelect value={editInvoiced} onChange={setEditInvoiced} />
                    <MoneyInput value={editAmount} onChange={setEditAmount} />
                    <div className="flex gap-1">
                      <Button size="sm" className={ECON.bgSolid} onClick={() => updateMut.mutate(r.id)} disabled={updateMut.isPending}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div key={r.id} className="flex items-center gap-2 py-2 border-b last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{r.concept}</p>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                        {paymentMethodLabel(r.paymentMethod)}
                        <Badge variant={r.invoiced ? "secondary" : "outline"} className="text-[10px]">
                          {r.invoiced ? "Facturada" : "No facturada"}
                        </Badge>
                      </p>
                    </div>
                    <span className="font-mono text-sm shrink-0">{formatCurrency(num(r.amount))}</span>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMut.mutate(r.id)} disabled={deleteMut.isPending}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
