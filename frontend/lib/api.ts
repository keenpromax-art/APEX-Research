const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function readDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const entry = item as { loc?: unknown[]; msg?: string };
        const loc = Array.isArray(entry.loc) ? entry.loc.filter((part) => part !== "body").join(".") : "";
        return [loc, entry.msg].filter(Boolean).join(": ");
      })
      .join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return fallback;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) {
    if (error.message === "Failed to fetch") {
      return "Cannot reach the API. Is the backend running on " + BASE + "?";
    }
    return error.message;
  }
  return String(error);
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch (error) {
    throw new ApiError(0, getErrorMessage(error));
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = readDetail(await res.json(), detail);
    } catch {
      try {
        detail = (await res.text()) || detail;
      } catch {
        // keep status text
      }
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiBlob(path: string, body: unknown): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(0, getErrorMessage(error));
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = readDetail(await res.json(), detail);
    } catch {
      // keep status text
    }
    throw new ApiError(res.status, detail);
  }
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const API_BASE = BASE;
