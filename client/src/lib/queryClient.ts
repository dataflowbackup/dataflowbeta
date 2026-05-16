import { QueryClient, QueryFunction } from "@tanstack/react-query";

function mapNetworkFetchError(err: unknown): Error {
  if (!(err instanceof Error)) return new Error(String(err));
  const m = err.message;
  const looksLikeNetworkFailure =
    m === "Failed to fetch" ||
    m.includes("Failed to fetch") ||
    m.includes("NetworkError when attempting to fetch resource") ||
    m.includes("Network request failed") ||
    m.includes("Load failed");
  if (!looksLikeNetworkFailure) return err;
  return new Error(
    "Sin respuesta del servidor (red/CORS/servidor caído). En desarrollo usá «npm run dev» y abrí la app en http://localhost:5000 (o dejá el backend en marcha en ese puerto si usás Vite solo en 5173). En producción revisá el deploy y los logs de la función API.",
  );
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
  } catch (e) {
    throw mapNetworkFetchError(e);
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    let res: Response;
    try {
      res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
      });
    } catch (e) {
      throw mapNetworkFetchError(e);
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
