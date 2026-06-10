import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<any[][]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [m, setM] = useState<MappingState>(emptyMapping);

  const maxCols = useMemo(
    () => rows.reduce((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0),
    [rows],
  );
  const colOptions = useMemo(
    () => Array.from({ length: maxCols }, (_, i) => i),
    [maxCols],
  );

  const reset = () => {
    setFile(null);
    setRows([]);
    setFileName("");
    setM(emptyMapping);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (f: File) => {
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as any[][];
      setRows(data.slice(0, 8));
      setFile(f);
      setFileName(f.name);
    } catch (e: any) {
      toast({ title: "No se pudo leer el Excel", description: e?.message, variant: "destructive" });
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Subí el archivo del extracto");
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

      // Cuenta "Genérica" fija (idempotente). No toca bancos configurados.
      const accRes = await apiRequest("POST", "/api/bank-accounts/ensure-generic");
      const account = await accRes.json();

      const fd = new FormData();
      fd.append("file", file);
      fd.append("bankAccountId", String(account.id));
      fd.append("bankId", "generic");
      fd.append("columnMapping", JSON.stringify(columnMapping));
      fd.append("skipContinuityCheck", "1");

      const res = await fetch("/api/transactions/import", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      const imported = data?.imported ?? data?.inserted ?? data?.count;
      toast({
        title: "Extracto genérico importado",
        description:
          imported != null
            ? `Se importaron ${imported} movimiento(s) en la solapa "Genérica".`
            : `Los movimientos quedaron en la solapa "Genérica".`,
      });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "No se pudo importar", description: e.message, variant: "destructive" }),
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Importar extracto genérico</DialogTitle>
          <DialogDescription>
            Para extractos de un banco que no está predeterminado. Subí el archivo, asigná qué
            columna es cada dato y se importa al momento — los movimientos quedan en la solapa
            "Genérica". No se guarda ningún mapeo ni se modifica ningún banco configurado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label className="text-xs">Extracto (.xlsx)</Label>
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
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending || !file}
            data-testid="button-import-generic"
          >
            {importMutation.isPending ? "Importando..." : "Importar a Genérica"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
