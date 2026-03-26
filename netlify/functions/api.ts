import type { Handler } from "@netlify/functions";
import serverless from "serverless-http";
import { createApp } from "../../server/createApp";

let cachedHandler: Handler | null = null;

async function getHandler(): Promise<Handler> {
  if (cachedHandler) return cachedHandler;

  const { app } = await createApp({ serveClient: false });
  cachedHandler = serverless(app, {
    provider: "aws",
    basePath: "/.netlify/functions/api",
  }) as Handler;
  return cachedHandler;
}

export const handler: Handler = async (event, context) => {
  const h = await getHandler();
  return h(event, context);
};
