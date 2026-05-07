import { gunzipSync } from "zlib";
import { storage } from "./storage";
import { parseStoredImportParams, runBankStatementImport } from "./bankStatementImport";

/**
 * Ejecuta un job de importación (Netlify Background Function o ruta local).
 * Idempotente: solo toma jobs en `pending` con token+clave correctos.
 */
export async function processFinancialImportJobBody(jobToken: string, triggerKey: string): Promise<void> {
  if (!jobToken || !triggerKey) {
    console.warn("[IMPORT-JOB] Falta jobToken o triggerKey");
    return;
  }

  const job = await storage.claimFinancialImportJobForProcessing(jobToken, triggerKey);
  if (!job) {
    console.log("[IMPORT-JOB] No hay job pending para procesar (token inválido o ya tomado)");
    return;
  }

  const jobId = job.id;

  try {
    const buffer = gunzipSync(Buffer.from(job.fileGzipBase64, "base64"));
    const params = parseStoredImportParams(job.paramsJson);
    const result = await runBankStatementImport({
      clientId: job.clientId,
      userId: job.createdBy ?? undefined,
      buffer,
      bankAccountId: params.bankAccountId,
      bankId: params.bankId,
      defaultLocalId: params.defaultLocalId,
      openingBalanceRaw: params.openingBalanceRaw,
      closingBalanceRaw: params.closingBalanceRaw,
      skipContinuityCheck: params.skipContinuityCheck,
      mpGrossOverrides: params.mpGrossOverrides,
    });

    if (result.kind === "success" || result.kind === "reconciliation") {
      await storage.updateFinancialImportJob(jobId, {
        status: "done",
        resultJson: JSON.stringify(result.body),
        resultHttpStatus: 200,
      });
      return;
    }

    await storage.updateFinancialImportJob(jobId, {
      status: "failed",
      resultHttpStatus: result.status,
      resultJson: JSON.stringify(result.body),
      errorMessage: String((result.body as { message?: string }).message || "Error en importación"),
    });
  } catch (e: any) {
    console.error("[IMPORT-JOB]", e);
    await storage.updateFinancialImportJob(jobId, {
      status: "failed",
      resultHttpStatus: 500,
      errorMessage: e?.message || "Error interno",
      resultJson: JSON.stringify({ message: e?.message || "Error interno" }),
    });
  }
}
