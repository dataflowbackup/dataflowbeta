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
  }) as Handler;
  return cachedHandler;
}

export const handler: Handler = async (event, context) => {
  const h = await getHandler();
  return h(event, context);
};
