import "../../server/env";
import type { Handler } from "@netlify/functions";
import { processInvoiceExtractionJobBody } from "../../server/invoiceExtraction";

/**
 * Factura Digital: la lectura del comprobante con IA puede pasarse del límite de ~26s de la
 * función API, así que corre acá (background functions llegan a 15 min).
 * Mismo patrón que `process-financial-import-background`.
 * Ver: https://docs.netlify.com/build/functions/background-functions/
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "" };
  }
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    await processInvoiceExtractionJobBody(String(body.jobToken || ""), String(body.triggerKey || ""));
  } catch (e) {
    console.error("[extract-invoice-background]", e);
  }
  return { statusCode: 202, body: "" };
};
