import { getDevUserId } from "./userId";

/** apps/web/README.md: "Never holds a provider API key. All map/tile/POI
 * provider access is server-side proxied." This constant is the ONLY base
 * URL this app ever talks to — every map tile, footprint, coverage, and
 * project call goes through the SODEJA API, never an external provider
 * directly. */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
}

function readMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return `request failed with status ${status}`;
}

/**
 * The single fetch wrapper every API call in this app goes through —
 * attaches the dev `x-user-id` placeholder (lib/userId.ts) and normalizes
 * both JSON success and error bodies (including `ProviderErrorFilter`'s
 * `toSafeJSON()` shape and NestJS's `BadRequestException` shape) into one
 * `ApiError`.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-user-id": getDevUserId(),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const text = await res.text();
  const data: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(readMessage(data, res.status), res.status, data);
  }
  return data as T;
}
