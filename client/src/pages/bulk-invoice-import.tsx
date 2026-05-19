import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, Download, Upload, Info, AlertCircle } from "lucide-react";

type AccessResponse =
  | { allowed: true; mode: string; hint?: string }
  | { allowed: false; message?: string };

export default function BulkInvoiceImportPage() {
  const { toast } = useToast();
  const { data: access, isLoading } = useQuery<AccessResponse>({
    queryKey: ["/api/admin/bulk-invoices/access"],
  });

  const [parserFile, setParserFile] = useState<File | null>(null);
  const [revisionFile, setRevisionFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function downloadRevision() {
    if (!parserFile) {
      toast({
        title: "Falta el Excel",
        description: "Elegí el archivo que generó el programa parser.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    setLastResult(null);
    try {
      const fd = new FormData();
      fd.append("file", parserFile);
      const res = await fetch("/api/admin/bulk-invoices/precheck-supplies?format=xlsx", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "revision_insumos.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Planilla descargada",
        description:
          "Abrila en Excel, completá «ID insumo definitivo» donde haga falta, guardá el archivo y usala en el paso 3.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "No se pudo generar la planilla", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!parserFile || !revisionFile) {
      toast({
        title: "Faltan archivos",
        description: "Necesitás el mismo Excel del parser y la planilla revision_insumos.xlsx ya revisada.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    setLastResult(null);
    try {
      const fd = new FormData();
      fd.append("file", parserFile);
      fd.append("revision", revisionFile);
      const q = dryRun ? "?dryRun=true" : "";
      const res = await fetch(`/api/admin/bulk-invoices/commit${q}`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
      if (!res.ok) {
        const msg =
          typeof body === "object" && body && "message" in body
            ? String((body as { message: unknown }).message)
            : text;
        throw new Error(msg);
      }
      const data = body as {
        dryRun?: boolean;
        createdCount?: number;
        processedInvoiceRows?: number;
        errors?: string[];
        skipped?: string[];
      };
      const lines: string[] = [];
      lines.push(
        data.dryRun
          ? "Simulación: no se guardó nada en Dataflow."
          : "Listo: los cambios se aplicaron en Dataflow.",
      );
      lines.push(`Filas de facturas en el Excel: ${data.processedInvoiceRows ?? "?"}`);
      lines.push(`Facturas dadas de alta en esta corrida: ${data.createdCount ?? 0}`);
      if (data.skipped?.length) {
        lines.push(
          `Omitidas (${data.skipped.length}): ${data.skipped.slice(0, 5).join("; ")}${data.skipped.length > 5 ? "…" : ""}`,
        );
      }
      if (data.errors?.length) {
        lines.push(
          `Problemas (${data.errors.length}): ${data.errors.slice(0, 10).join("; ")}${data.errors.length > 10 ? "…" : ""}`,
        );
      }
      const summary = lines.join("\n");
      setLastResult(summary);
      toast({
        title: data.dryRun ? "Simulación lista" : "Importación lista",
        description: "Los detalles están abajo en «Último resultado».",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResult(`Error:\n${msg}`);
      toast({ title: "No se pudo completar", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Importar facturas desde Excel"
          description="Comprobando si tu usuario puede usar esta herramienta…"
        />
      </div>
    );
  }

  if (!access || !("allowed" in access) || access.allowed === false) {
    return (
      <div className="space-y-4 max-w-3xl">
        <PageHeader
          title="Importar facturas desde Excel"
          description="Para facturas preparadas con el parser OCR (archivo Excel)."
        />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No podés usar esta pantalla con tu usuario actual</AlertTitle>
          <AlertDescription>
            {access && "message" in access && access.message
              ? access.message
              : "No tenés permiso. Si deberías tenerlo, revisá tu rol en Equipo (Socio o Administrador)."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Importar facturas desde Excel"
        description="Tres pasos: subís el Excel del parser, descargás la planilla para revisar insumos, y después importás (primero podés simular sin guardar)."
      />
      {access.hint ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{access.hint}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Antes de que entre algo a Dataflow</CardTitle>
          <CardDescription>
            Tu revisión es el archivo <strong>revision_insumos.xlsx</strong> del paso 2. Ahí ves cada texto que salió en las facturas y marcás el{" "}
            <strong>ID insumo definitivo</strong> según tu catálogo (menú Insumos). Recomendación: dejá marcada «Solo simular» la primera vez y leé el
            resultado abajo; si todo se ve bien, volvé a ejecutar sin simular.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="h-5 w-5 shrink-0" />
            Paso 1 — Excel que sale del parser
          </CardTitle>
          <CardDescription>
            Tiene las hojas «Facturas» e «Items de Facturas» (y suele traer más). Es el mismo archivo que vas a usar en el paso 3.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="parser-xlsx">Archivo Excel del parser</Label>
            <Input
              id="parser-xlsx"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setParserFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5 shrink-0" />
            Paso 2 — Planilla para revisar insumos
          </CardTitle>
          <CardDescription>
            Se llama <strong>revision_insumos.xlsx</strong>. Abrila en Excel, completá la columna de ID definitivo donde corresponda y guardala.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => void downloadRevision()} disabled={busy || !parserFile}>
            Descargar revision_insumos.xlsx
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="h-5 w-5 shrink-0" />
            Paso 3 — Importar (o simular)
          </CardTitle>
          <CardDescription>
            Subís otra vez el Excel del parser y la planilla que ya revisaste. Podés probar sin guardar datos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="parser-xlsx-2">Excel del parser (mismo del paso 1)</Label>
            <Input
              id="parser-xlsx-2"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setParserFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="revision-xlsx">Planilla revisada (revision_insumos.xlsx)</Label>
            <Input
              id="revision-xlsx"
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setRevisionFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="dry-run" checked={dryRun} onCheckedChange={(c) => setDryRun(c === true)} />
            <Label htmlFor="dry-run" className="text-sm font-normal leading-snug cursor-pointer">
              Solo simular (recomendado la primera vez: no crea facturas en Dataflow)
            </Label>
          </div>
          <Button type="button" onClick={() => void runCommit()} disabled={busy}>
            {busy ? "Procesando…" : dryRun ? "Ejecutar simulación" : "Importar de verdad"}
          </Button>
        </CardContent>
      </Card>

      {lastResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Último resultado</CardTitle>
            <CardDescription>Leé esto antes de volver a Facturas en el menú principal.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-sm whitespace-pre-wrap rounded-md border bg-muted/40 p-4 overflow-x-auto font-sans">
              {lastResult}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
