/* Client-side helpers shared across pages. */

/* eslint-disable @typescript-eslint/no-explicit-any */

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

/** POST returning an SSE stream; invokes onEvent per parsed data payload. */
export async function streamSse(
  url: string,
  body: any,
  onEvent: (ev: any) => void,
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
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        /* skip malformed */
      }
    }
  }
}

export function assetUrl(id: string | null | undefined): string | null {
  return id ? `/api/assets/${id}` : null;
}

export async function uploadFile(file: File | Blob, name = "file"): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, file instanceof File ? file.name : name);
  const res = await fetch("/api/assets", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "upload failed");
  return data.id as string;
}

export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.click();
}

export async function downloadBlob(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition");
  const name = cd?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
