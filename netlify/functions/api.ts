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
  return h(event, context);
};
