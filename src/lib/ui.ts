/* Client-side helpers shared across pages. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { v4 as uuidv4 } from "uuid";

export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => fetchJson<T>(url),
  post: <T = any>(url: string, body?: any) =>
    fetchJson<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T = any>(url: string, body?: any) =>
    fetchJson<T>(url, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T = any>(url: string, body?: any) =>
    fetchJson<T>(url, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T = any>(url: string) => fetchJson<T>(url, { method: "DELETE" }),
};

/** POST returning an SSE stream; invokes onEvent per parsed data payload.
 *  An async onEvent is awaited before the next event — the chat page uses that to let
 *  one speaker's reply finish typing out before the next speaker's starts. */
export async function streamSse(
  url: string,
  body: any,
  onEvent: (ev: any) => void | Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop()!;
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev: any;
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue; // skip malformed
      }
      await onEvent(ev);
    }
  }
}

/** Client-side id — uuid instead of crypto.randomUUID, which doesn't exist on insecure origins (plain-HTTP LAN access). */
export function uid(): string {
  return uuidv4();
}

export function assetUrl(id: string | null | undefined): string | null {
  return id ? `/api/assets/${id}` : null;
}

async function sha256HexOf(buf: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // crypto.subtle doesn't exist on insecure origins (plain-HTTP LAN access)
  const { sha256 } = await import("js-sha256");
  return sha256(new Uint8Array(buf));
}

/** Direct-to-bucket upload: hash the file, get a presigned PUT (a known hash
 *  skips the upload — content-addressed dedup), PUT straight to storage, then
 *  finalize to register the asset. The bytes never pass through the app server. */
export async function uploadFile(file: File | Blob, name = "file"): Promise<string> {
  const filename = file instanceof File ? file.name : name;
  const mime = file.type || "application/octet-stream";
  const buf = await file.arrayBuffer();
  const hash = await sha256HexOf(buf);
  const presign = await api.post("/api/assets/presign", { hash, mime, size: buf.byteLength, filename });
  if (presign.existing) return presign.id as string;
  const put = await fetch(presign.url, { method: "PUT", headers: presign.headers, body: buf });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  await api.post("/api/assets/finalize", { hash, mime, filename });
  return presign.id as string;
}

export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.click();
}

export async function downloadBlob(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition");
  // filename* (RFC 5987) carries unicode names; the plain filename is its ascii fallback
  const star = cd?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let name = cd?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  if (star) {
    try {
      name = decodeURIComponent(star);
    } catch {
      /* malformed — keep the plain one */
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
