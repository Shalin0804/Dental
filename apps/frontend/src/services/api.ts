const BASE = import.meta.env.VITE_API_URL ?? "/api";

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;

let refreshing: Promise<boolean> | null = null;
/** Single-flight refresh: concurrent 401s share one /auth/refresh call. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include", headers: { "x-sdc-csrf": "1" } })
    .then(async (r) => {
      if (!r.ok || r.status === 204) { setAccessToken(null); return false; }
      setAccessToken((await r.json()).data.accessToken);
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

type Opts = Omit<RequestInit, "body"> & { body?: unknown; query?: Record<string, string | number | boolean | undefined | null> };

export async function api<T>(path: string, { body, query, headers, ...init }: Opts = {}, retry = true): Promise<T> {
  const qs = query
    ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]))
    : "";
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}${path}${qs}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      "x-sdc-csrf": "1",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 401 && retry && accessToken && (await refreshSession())) return api<T>(path, { body, query, headers, ...init }, false);
  if (res.status === 204) return undefined as T;

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiRequestError(res.status, e?.code ?? "UNKNOWN", e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return json as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
