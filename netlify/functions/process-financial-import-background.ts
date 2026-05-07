import "../../server/env";
import type { Handler } from "@netlify/functions";
import { processFinancialImportJobBody } from "../../server/processFinancialImportJob";

/**
 * Import pesado (p. ej. Mercado Pago con miles de líneas) fuera del límite ~26s de la función API.
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
    await processFinancialImportJobBody(String(body.jobToken || ""), String(body.triggerKey || ""));
  } catch (e) {
    console.error("[process-financial-import-background]", e);
  }
  return { statusCode: 202, body: "" };
};
