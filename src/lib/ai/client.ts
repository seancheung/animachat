import { getModel, getProvider, getSettings, logUsage } from "@/lib/store";
import type { AiTask, Chat, Model, Provider } from "@/lib/types";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  modelRef: ResolvedModel;
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  feature: AiTask;
  chatId?: string | null;
  signal?: AbortSignal;
}

export interface ResolvedModel {
  model: Model;
  provider: Provider;
}

export class AiConfigError extends Error {}

/** ~4 chars per token is a decent cross-provider estimate; the output reserve absorbs the error. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Resolution order: per-character model (group chats) -> per-chat model
 * -> task's assigned model -> global default.
 */
export function resolveModel(task: AiTask, chat?: Chat | null, characterId?: string | null): ResolvedModel {
  const settings = getSettings();
  const candidates: (string | null | undefined)[] = [
    task === "chat" && characterId ? chat?.charModels?.[characterId] : null,
    task === "chat" || task === "narrator" ? chat?.modelId : null,
    settings.taskModels[task],
    settings.defaultModelId,
  ];
  for (const id of candidates) {
    if (!id) continue;
    const model = getModel(id);
    if (!model) continue;
    const provider = getProvider(model.providerId);
    if (provider) return { model, provider };
  }
  throw new AiConfigError(
    "No model configured. Add a provider and model in Settings, then set a default model."
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function deepMerge(base: any, extra: any): any {
  if (extra === undefined) return base;
  if (
    base && extra &&
    typeof base === "object" && typeof extra === "object" &&
    !Array.isArray(base) && !Array.isArray(extra)
  ) {
    const out: any = { ...base };
    for (const k of Object.keys(extra)) out[k] = deepMerge(base[k], extra[k]);
    return out;
  }
  return extra;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "usage"; input: number; cacheRead: number; cacheWrite: number; output: number };

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("data:")) yield t.slice(5).trim();
    }
  }
  if (buf.trim().startsWith("data:")) yield buf.trim().slice(5).trim();
}

async function raiseHttpError(res: Response, provider: Provider): Promise<never> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* ignore */
  }
  throw new Error(`${provider.name} returned ${res.status}: ${detail || res.statusText}`);
}

async function* streamAnthropic(req: LlmRequest): AsyncGenerator<StreamEvent> {
  const { model, provider } = req.modelRef;
  const body = deepMerge(
    {
      model: model.modelId,
      max_tokens: req.maxTokens ?? 2048,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      system: req.system || undefined,
      messages: req.messages,
      stream: true,
    },
    model.customBody ?? {}
  );
  const res = await fetch(joinUrl(provider.baseUrl, "/v1/messages"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok || !res.body) await raiseHttpError(res, provider);
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let output = 0;
  for await (const data of sseLines(res)) {
    if (!data || data === "[DONE]") continue;
    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    if (ev.type === "message_start") {
      // input_tokens excludes cache reads/writes — those arrive in their own fields
      const u = ev.message?.usage;
      input = u?.input_tokens ?? 0;
      cacheRead = u?.cache_read_input_tokens ?? 0;
      cacheWrite = u?.cache_creation_input_tokens ?? 0;
    } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      yield { type: "text", text: ev.delta.text };
    } else if (ev.type === "message_delta") {
      output = ev.usage?.output_tokens ?? output;
    } else if (ev.type === "error") {
      throw new Error(`${provider.name} stream error: ${ev.error?.message ?? "unknown"}`);
    }
  }
  yield { type: "usage", input, cacheRead, cacheWrite, output };
}

async function* streamOpenAi(req: LlmRequest): AsyncGenerator<StreamEvent> {
  const { model, provider } = req.modelRef;
  const messages = [
    ...(req.system ? [{ role: "system", content: req.system }] : []),
    ...req.messages,
  ];
  const body = deepMerge(
    {
      model: model.modelId,
      max_tokens: req.maxTokens ?? 2048,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      messages,
      stream: true,
      stream_options: { include_usage: true },
    },
    model.customBody ?? {}
  );
  const res = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok || !res.body) await raiseHttpError(res, provider);
  let prompt = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let output = 0;
  for await (const data of sseLines(res)) {
    if (!data || data === "[DONE]") continue;
    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = ev.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) yield { type: "text", text: delta };
    if (ev.usage) {
      // prompt_tokens includes cache reads and writes; split them out so each bills at
      // its own price. Reads: cached_tokens (DeepSeek: prompt_cache_hit_tokens). Writes:
      // cache_write_tokens, reported by GPT-5.6+ — absent on models that bill writes as input.
      const det = ev.usage.prompt_tokens_details;
      prompt = ev.usage.prompt_tokens ?? prompt;
      cacheRead = det?.cached_tokens ?? ev.usage.prompt_cache_hit_tokens ?? cacheRead;
      cacheWrite = det?.cache_write_tokens ?? cacheWrite;
      output = ev.usage.completion_tokens ?? output;
    }
  }
  yield { type: "usage", input: Math.max(0, prompt - cacheRead - cacheWrite), cacheRead, cacheWrite, output };
}

/**
 * Stream a completion. Yields text deltas, then a final usage event.
 * Usage is logged to the usage_log automatically (estimated when the provider omits it).
 */
export async function* streamLlm(req: LlmRequest): AsyncGenerator<StreamEvent> {
  const gen = req.modelRef.provider.type === "anthropic" ? streamAnthropic(req) : streamOpenAi(req);
  let collected = "";
  let usage: { input: number; cacheRead: number; cacheWrite: number; output: number } | null = null;
  for await (const ev of gen) {
    if (ev.type === "text") {
      collected += ev.text;
      yield ev;
    } else {
      usage = ev;
    }
  }
  const promptText = req.system + req.messages.map((m) => m.content).join("\n");
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  // estimate only when the provider reported no prompt usage at all — a fully cached
  // prompt legitimately has input 0
  const input = usage && usage.input + cacheRead + cacheWrite > 0 ? usage.input : estimateTokens(promptText);
  const output = usage?.output || estimateTokens(collected);
  logUsage({
    provider: req.modelRef.provider.name,
    model: req.modelRef.model.modelId,
    feature: req.feature,
    chatId: req.chatId ?? null,
    inputTokens: input,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
  });
  yield { type: "usage", input, cacheRead, cacheWrite, output };
}

/** Non-streaming convenience for utility tasks (orchestrator, memory, title, impersonate...). */
export async function callLlm(req: LlmRequest): Promise<string> {
  let text = "";
  for await (const ev of streamLlm(req)) {
    if (ev.type === "text") text += ev.text;
  }
  return text;
}

/** Extract the first JSON object/array from model output (tolerates prose or code fences around it). */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.search(/[[{]/);
    if (start === -1) continue;
    for (let end = c.length; end > start; end--) {
      const slice = c.slice(start, end).trim();
      if (!slice) continue;
      try {
        return JSON.parse(slice) as T;
      } catch {
        /* keep shrinking */
      }
    }
  }
  return null;
}
