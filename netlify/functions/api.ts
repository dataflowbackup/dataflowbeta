import "../../server/env";
import type { Handler } from "@netlify/functions";
import serverless from "serverless-http";
import { createApiApp } from "../../server/createApiApp";

let cachedHandler: Handler | null = null;

async function getHandler(): Promise<Handler> {
  if (cachedHandler) return cachedHandler;

  const app = await createApiApp();
  cachedHandler = serverless(app as any, {
    provider: "aws",
    basePath: "/.netlify/functions/api",
    // Importante: respuestas binarias (xlsx, etc.) deben ir como base64,
    // si no el body se serializa como string y el archivo queda corrupto.
    binary: [
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/zip",
    ],
  }) as Handler;
  return cachedHandler;
}

export const handler: Handler = async (event, context) => {
  const h = await getHandler();
  const result: any = await h(event, context);

  // Hardening: aun con `binary` configurado, en algunos entornos Netlify puede
  // no marcar `isBase64Encoded` y el XLSX se corrompe.
  const headers = (result?.headers || {}) as Record<string, string>;
  const contentType =
    headers["content-type"] ||
    headers["Content-Type"] ||
    "";

  const isXlsx =
    typeof contentType === "string" &&
    (contentType.includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) ||
      contentType.includes("application/vnd.ms-excel"));

  if (isXlsx && result && result.isBase64Encoded !== true) {
    const body = result.body;
    if (body != null) {
      // `serverless-http` puede devolver string "binario" (latin1).
      const buf = Buffer.isBuffer(body)
        ? body
        : Buffer.from(String(body), "binary");
      result.body = buf.toString("base64");
      result.isBase64Encoded = true;
    }
  }

  return result;
};
