/**
 * Factura Digital — lectura del comprobante con Claude y resolución contra el catálogo.
 *
 * Corre en una background function: una lectura puede pasarse del timeout de ~26s de la función
 * API (ver `netlify.toml`), igual que el import de Mercado Pago.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { gunzipSync } from "zlib";
import { storage } from "./storage";
import {
  extractedInvoiceSchema,
  INVOICE_EXTRACTION_PROMPT,
  buildInvoiceDraft,
  normalizeItemDescription,
  validateExtraction,
  type ExtractedInvoice,
  type InvoiceDraft,
} from "@shared/invoiceExtraction";
import { digitsOnly, scoreSupplyMatch } from "@shared/bulkInvoiceImportHelpers";

const MODEL = "claude-opus-5";

/** Score mínimo para sugerir un insumo por parecido. Debajo de esto se deja sin sugerir. */
const MIN_SUPPLY_SCORE = 0.6;

/** Tipos que la API acepta como bloque `image`; el PDF va como `document`. */
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function isSupportedInvoiceMediaType(mediaType: string): boolean {
  return IMAGE_TYPES.has(mediaType) || mediaType === "application/pdf";
}

function buildClient(): Anthropic {
  // Se resuelve sola desde ANTHROPIC_API_KEY; se chequea antes para dar un error entendible.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "Falta configurar ANTHROPIC_API_KEY en el servidor: sin esa clave no se puede leer facturas con IA.",
    );
  }
  return new Anthropic();
}

/** Le manda el comprobante al modelo y devuelve lo leído, sin resolver todavía contra el catálogo. */
export async function readInvoiceFile(
  fileBuffer: Buffer,
  mediaType: string,
): Promise<{ extracted: ExtractedInvoice; inputTokens: number; outputTokens: number }> {
  const client = buildClient();
  const data = fileBuffer.toString("base64");

  const fileBlock: Anthropic.ContentBlockParam = IMAGE_TYPES.has(mediaType)
    ? {
        type: "image",
        source: { type: "base64", media_type: mediaType as "image/jpeg", data },
      }
    : {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      };

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    // La lectura es minuciosa pero acotada: no hace falta el esfuerzo máximo y así entra en tiempo.
    output_config: {
      effort: "medium",
      format: zodOutputFormat(extractedInvoiceSchema),
    },
    messages: [
      {
        role: "user",
        // El archivo va antes del texto: es lo recomendado para documentos e imágenes.
        content: [fileBlock, { type: "text", text: INVOICE_EXTRACTION_PROMPT }],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("El modelo no pudo procesar este archivo. Probá con otra foto del comprobante.");
  }
  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("No se pudo interpretar la respuesta de la lectura. Probá de nuevo.");
  }

  return {
    extracted: parsed,
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
  };
}

/**
 * Completa el borrador con lo que ya sabe DataFlow: proveedor por CUIT, e insumo por
 * memoria del proveedor primero y por parecido después.
 *
 * El orden importa: la memoria es una confirmación explícita de una persona, así que le gana
 * siempre a un parecido de texto, por más alto que sea el score.
 */
export async function resolveDraftAgainstCatalog(
  clientId: number,
  draft: InvoiceDraft,
): Promise<InvoiceDraft> {
  const cuit = digitsOnly(draft.supplierCuit);
  const supplier = cuit ? await storage.getSupplierByCuit(clientId, cuit) : undefined;

  const resolved: InvoiceDraft = {
    ...draft,
    supplierId: supplier?.id ?? null,
    supplierName: supplier?.tradeName ?? supplier?.businessName ?? draft.supplierName,
  };

  // Listado liviano: `getSupplies` arma joins y la última compra de cada insumo, que acá no se usan.
  const supplies = await storage.listSuppliesForMatching(clientId);
  const supplyById = new Map(supplies.map((s) => [s.id, s]));

  // Memoria descripción → insumo de ESTE proveedor.
  const memory = supplier
    ? await storage.listSupplierSupplyMappings(clientId, supplier.id)
    : [];
  const memoryByDesc = new Map(memory.map((m) => [m.normalizedDescription, m.supplyId]));

  resolved.items = draft.items.map((item) => {
    const key = normalizeItemDescription(item.description);
    const remembered = key ? memoryByDesc.get(key) : undefined;
    if (remembered != null && supplyById.has(remembered)) {
      const s = supplyById.get(remembered)!;
      return { ...item, supplyId: s.id, supplyName: s.name, matchSource: "memoria", matchScore: 1 };
    }

    let best: { id: number; name: string; score: number } | null = null;
    for (const s of supplies) {
      const score = scoreSupplyMatch(item.description, s.name);
      if (!best || score > best.score) best = { id: s.id, name: s.name, score };
    }
    if (best && best.score >= MIN_SUPPLY_SCORE) {
      return { ...item, supplyId: best.id, supplyName: best.name, matchSource: "parecido", matchScore: best.score };
    }
    return { ...item, supplyId: null, supplyName: null, matchSource: null, matchScore: null };
  });

  // Impuestos del catálogo: se matchea por porcentaje, que es lo único estable ("IVA 21%" vs "I.V.A. 21,00").
  const taxes = await storage.getTaxes(clientId);
  resolved.taxes = draft.taxes.map((t) => {
    if (t.percentage == null) return t;
    const match = taxes.find((x) => Math.abs((parseFloat(String(x.percentage)) || 0) - t.percentage!) < 0.01);
    return { ...t, taxId: match?.id ?? null };
  });

  return resolved;
}

/** Job completo: descomprime, lee, resuelve y valida. */
export async function processInvoiceExtractionJobBody(jobToken: string, triggerKey: string): Promise<void> {
  if (!jobToken || !triggerKey) {
    console.warn("[FACTURA-DIGITAL] Falta jobToken o triggerKey");
    return;
  }

  const job = await storage.claimInvoiceExtractionJobForProcessing(jobToken, triggerKey);
  if (!job) {
    console.log("[FACTURA-DIGITAL] No hay job pending (token inválido o ya tomado)");
    return;
  }

  try {
    const buffer = gunzipSync(Buffer.from(job.fileGzipBase64, "base64"));
    const { extracted, inputTokens, outputTokens } = await readInvoiceFile(buffer, job.fileMediaType);
    const draft = await resolveDraftAgainstCatalog(job.clientId, buildInvoiceDraft(extracted));
    const issues = validateExtraction(draft);

    await storage.updateInvoiceExtractionJob(job.id, {
      status: "done",
      resultJson: JSON.stringify({ draft, issues }),
      inputTokens,
      outputTokens,
      // El archivo ya no hace falta: no se guarda el comprobante (decisión del 28-ago-2026).
      fileGzipBase64: "",
    });
  } catch (e: any) {
    console.error("[FACTURA-DIGITAL]", e);
    await storage.updateInvoiceExtractionJob(job.id, {
      status: "failed",
      errorMessage: e?.message || "Error al leer la factura",
      fileGzipBase64: "",
    });
  }
}
