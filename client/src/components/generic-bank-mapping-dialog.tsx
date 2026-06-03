import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ClientBank } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NONE = "__none__";

/** Índice 0-based → "A", "B", ... "Z", "AA", ... */
function colLabel(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

type MappingState = {
  headerRows: number;
  dateCol: number | null;
  desc1Col: number | null;
  desc2Col: number | null;
  useDebitCredit: boolean;
  debitCol: number | null;
  creditCol: number | null;
  amountCol: number | null;
};

const emptyMapping: MappingState = {
  headerRows: 1,
  dateCol: null,
  desc1Col: null,
  desc2Col: null,
  useDebitCredit: true,
  debitCol: null,
  creditCol: null,
  amountCol: null,
};

export function GenericBankMappingDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [rows, setRows] = useState<any[][]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [m, setM] = useState<MappingState>(emptyMapping);

  const { data: clientBanks = [] } = useQuery<ClientBank[]>({
    queryKey: ["/api/client-banks"],
    enabled: open,
  });

  const selectedBank = useMemo(
    () => clientBanks.find((b) => String(b.id) === selectedBankId),
    [clientBanks, selectedBankId],
  );

  // Pre-cargar el mapeo existente del banco seleccionado.
  useEffect(() => {
    const cm = (selectedBank?.columnMapping as any) ?? null;
    if (cm && typeof cm === "object") {
      setM({
        headerRows: Number.isFinite(cm.headerRows) ? Number(cm.headerRows) : 1,
        dateCol: cm.dateCol ?? null,
        desc1Col: cm.desc1Col ?? null,
        desc2Col: cm.desc2Col ?? null,
        useDebitCredit: cm.amountCol == null,
        debitCol: cm.debitCol ?? null,
        creditCol: cm.creditCol ?? null,
        amountCol: cm.amountCol ?? null,
      });
    } else {
      setM(emptyMapping);
    }
  }, [selectedBankId]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxCols = useMemo(
    () => rows.reduce((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0),
    [rows],
  );
  const colOptions = useMemo(
    () => Array.from({ length: maxCols }, (_, i) => i),
    [maxCols],
  );

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as any[][];
      setRows(data.slice(0, 8));
      setFileName(file.name);
    } catch (e: any) {
      toast({ title: "No se pudo leer el Excel", description: e?.message, variant: "destructive" });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBank) throw new Error("Elegí un banco");
      if (m.dateCol == null) throw new Error("Mapeá la columna de Fecha");
      if (m.useDebitCredit && m.debitCol == null && m.creditCol == null)
        throw new Error("Mapeá Débito y/o Crédito");
      if (!m.useDebitCredit && m.amountCol == null)
        throw new Error("Mapeá la columna de Monto");

      const columnMapping: Record<string, number> = {
        headerRows: m.headerRows,
        dateCol: m.dateCol,
      };
      if (m.desc1Col != null) columnMapping.desc1Col = m.desc1Col;
      if (m.desc2Col != null) columnMapping.desc2Col = m.desc2Col;
      if (m.useDebitCredit) {
        if (m.debitCol != null) columnMapping.debitCol = m.debitCol;
        if (m.creditCol != null) columnMapping.creditCol = m.creditCol;
      } else if (m.amountCol != null) {
        columnMapping.amountCol = m.amountCol;
      }

      const res = await apiRequest(
        "PUT",
        `/api/client-banks/${selectedBank.id}/column-mapping`,
        { columnMapping },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-banks"] });
      toast({ title: "Mapeo guardado", description: "El extracto de este banco se importará con estas columnas." });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "No se pudo guardar el mapeo", description: e.message, variant: "destructive" }),
  });

  const ColSelect = ({
    label,
    value,
    onChange,
    optional,
  }: {
    label: string;
    value: number | null;
    onChange: (v: number | null) => void;
    optional?: boolean;
  }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}{optional ? " (opcional)" : ""}</Label>
      <Select
        value={value == null ? NONE : String(value)}
        onValueChange={(v) => onChange(v === NONE ? null : parseInt(v, 10))}
      >
        <SelectTrigger className="h-8">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value={NONE}>—</SelectItem>}
          {colOptions.map((i) => (
            <SelectItem key={i} value={String(i)}>
              Col {colLabel(i)} ({i})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Mapear columnas de banco genérico</DialogTitle>
          <DialogDescription>
            Subí un extracto de muestra y asigná qué columna es cada dato. El mapeo se guarda por
            banco y se reutiliza en cada importación. El saldo inicial se ingresa al importar y se
            valida contra el cierre del último extracto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label className="text-xs">Banco</Label>
            <Select value={selectedBankId} onValueChange={setSelectedBankId}>
              <SelectTrigger data-testid="select-generic-bank">
                <SelectValue placeholder="Elegí un banco configurado" />
              </SelectTrigger>
              <SelectContent>
                {clientBanks.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.displayName || b.bankId}
                    {b.columnMapping ? " ✓" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Extracto de muestra (.xlsx)</Label>
            <Input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              data-testid="input-sample-file"
            />
            {fileName && <p className="text-xs text-muted-foreground">Archivo: {fileName}</p>}
          </div>

          {rows.length > 0 && (
            <div className="rounded-md border overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    {colOptions.map((i) => (
                      <th key={i} className="px-2 py-1 text-left font-medium border-b whitespace-nowrap">
                        Col {colLabel(i)} ({i})
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri} className="border-b">
                      {colOptions.map((ci) => (
                        <td key={ci} className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate">
                          {String(r?.[ci] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Filas de encabezado</Label>
              <Input
                type="number"
                min={0}
                value={m.headerRows}
                onChange={(e) => setM({ ...m, headerRows: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                className="h-8"
                data-testid="input-header-rows"
              />
            </div>
            <ColSelect label="Fecha" value={m.dateCol} onChange={(v) => setM({ ...m, dateCol: v })} />
            <ColSelect label="Descripción 1" value={m.desc1Col} onChange={(v) => setM({ ...m, desc1Col: v })} optional />
            <ColSelect label="Descripción 2" value={m.desc2Col} onChange={(v) => setM({ ...m, desc2Col: v })} optional />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3 bg-muted/30">
            <div className="space-y-0.5">
              <Label className="text-sm">Débito / Crédito en columnas separadas</Label>
              <p className="text-xs text-muted-foreground">
                Apagá si el extracto trae un único monto con signo (+ ingreso / − egreso).
              </p>
            </div>
            <Switch
              checked={m.useDebitCredit}
              onCheckedChange={(v) => setM({ ...m, useDebitCredit: v })}
              data-testid="switch-debit-credit"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {m.useDebitCredit ? (
              <>
                <ColSelect label="Débitos (egresos)" value={m.debitCol} onChange={(v) => setM({ ...m, debitCol: v })} optional />
                <ColSelect label="Créditos (ingresos)" value={m.creditCol} onChange={(v) => setM({ ...m, creditCol: v })} optional />
              </>
            ) : (
              <ColSelect label="Monto (con signo)" value={m.amountCol} onChange={(v) => setM({ ...m, amountCol: v })} />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !selectedBank}
            data-testid="button-save-mapping"
          >
            {saveMutation.isPending ? "Guardando..." : "Guardar mapeo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
