/**
 * Factura Digital — subir una foto o PDF del comprobante y que la IA lo lea.
 *
 * La pantalla de revisión NO es una pantalla nueva: al terminar la lectura se completa el
 * formulario de facturas de siempre, que el usuario ya sabe usar, y ahí revisa y corrige.
 * Este diálogo solo se ocupa de subir el archivo y esperar el resultado.
 *
 * La lectura corre en una background function de Netlify (puede pasarse del límite de ~26s de la
 * función API), así que el flujo es: subir → disparar el job → poll hasta que termina.
 */
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Sparkles, Upload, FileText, Loader2, AlertTriangle } from "lucide-react";
import type { InvoiceDraft, ValidationIssue } from "@shared/invoiceExtraction";

const ACCEPTED = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 15 * 1024 * 1024;

/** En desarrollo no hay background functions: el job se ejecuta por una ruta normal. */
function isLocalDevHost(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".local");
}

export interface ExtractionResult {
  draft: InvoiceDraft;
  issues: ValidationIssue[];
}

export function FacturaDigitalDialog({
  open,
  onOpenChange,
  onExtracted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExtracted: (result: ExtractionResult) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");

  const reset = () => {
    setFile(null);
    setBusy(false);
    setStep("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const pick = (f: File | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast({
        title: "El archivo es muy grande",
        description: "Máximo 15 MB. Sacá la foto con menos resolución o comprimí el PDF.",
        variant: "destructive",
      });
      return;
    }
    setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      setStep("Subiendo el comprobante…");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/invoices/digital/extract", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "No se pudo subir el comprobante.");
      }
      const { jobToken, triggerKey } = await res.json();

      setStep("Leyendo la factura…");
      if (isLocalDevHost()) {
        await apiRequest("POST", "/api/invoices/digital/execute-job", { jobToken, triggerKey });
      } else {
        const bg = await fetch("/.netlify/functions/extract-invoice-background", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobToken, triggerKey }),
        });
        if (!bg.ok) {
          throw new Error("No se pudo iniciar la lectura. Probá de nuevo.");
        }
      }

      // Tope generoso: una foto pesada de un comprobante largo puede tardar.
      const deadline = Date.now() + 5 * 60 * 1000;
      let last: { status?: string; result?: ExtractionResult | null; errorMessage?: string } | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const pr = await fetch(`/api/invoices/digital/jobs/${encodeURIComponent(jobToken)}`, {
          credentials: "include",
        });
        if (!pr.ok) throw new Error("Error al consultar el estado de la lectura.");
        last = await pr.json();
        if (last?.status === "done" || last?.status === "failed") break;
      }

      if (!last || (last.status !== "done" && last.status !== "failed")) {
        throw new Error("La lectura está tardando demasiado. Probá de nuevo o cargá la factura a mano.");
      }
      if (last.status === "failed" || !last.result) {
        throw new Error(last.errorMessage || "No se pudo leer la factura.");
      }

      onExtracted(last.result);
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast({ title: "No se pudo leer la factura", description: e?.message, variant: "destructive" });
      setBusy(false);
      setStep("");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Cerrar en medio de la lectura dejaría el job huérfano y al usuario sin resultado.
        if (busy) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Factura Digital
          </DialogTitle>
          <DialogDescription>
            Subí una foto o el PDF del comprobante y se completan solos los datos, los ítems y los
            impuestos. Después revisás todo en el formulario antes de guardar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />

          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60"
            data-testid="button-pick-invoice-file"
          >
            {file ? (
              <>
                <FileText className="h-6 w-6 text-primary" />
                <span className="font-medium">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(1)} MB · tocá para cambiarlo
                </span>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 text-muted-foreground" />
                <span className="font-medium">Elegí la foto o el PDF</span>
                <span className="text-xs text-muted-foreground">JPG, PNG, WEBP o PDF · hasta 15 MB</span>
              </>
            )}
          </button>

          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              La lectura es automática pero no infalible: revisá siempre los importes y el insumo de
              cada ítem antes de guardar. Los datos dudosos quedan marcados.
            </span>
          </div>

          {busy && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{step}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => { reset(); onOpenChange(false); }}>
            Cancelar
          </Button>
          <Button disabled={!file || busy} onClick={run} data-testid="button-run-extraction">
            {busy ? "Leyendo…" : "Leer factura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
