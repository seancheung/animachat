import { afterEach, describe, expect, it, vi } from "vitest";
import { extractJson, streamLlm, type ResolvedModel, type StreamEvent } from "./client";
import type { Model, Provider } from "@/lib/types";

vi.mock("@/lib/store", () => ({
  getModel: vi.fn(),
  getProvider: vi.fn(),
  getSettings: vi.fn(),
  logUsage: vi.fn(),
}));

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"next":"narrator"}')).toEqual({ next: "narrator" });
  });

  it("parses JSON inside a code fence", () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON surrounded by prose", () => {
    expect(extractJson('Sure! {"summary": "text", "facts": []} Hope that helps.')).toEqual({
      summary: "text",
      facts: [],
    });
  });

  it("returns null when there is no JSON", () => {
    expect(extractJson("no json here")).toBeNull();
  });

  it("parses arrays", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });
});

describe("streamLlm stop event", () => {
  afterEach(() => vi.unstubAllGlobals());

  function modelRef(type: Provider["type"]): ResolvedModel {
    return {
      model: { modelId: "test-model" } as Model,
      provider: { type, name: "test", baseUrl: "http://localhost", apiKey: "k" } as Provider,
    };
  }

  async function collect(type: Provider["type"], sse: string): Promise<StreamEvent[]> {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })));
    const events: StreamEvent[] = [];
    for await (const ev of streamLlm({
      modelRef: modelRef(type),
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      feature: "assist",
    })) {
      events.push(ev);
    }
    return events;
  }

  it("reports truncation when Anthropic stops on max_tokens", async () => {
    const events = await collect(
      "anthropic",
      [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":5}}',
      ].join("\n\n")
    );
    expect(events).toContainEqual({ type: "stop", truncated: true });
  });

  it("reports a clean Anthropic end_turn as not truncated", async () => {
    const events = await collect(
      "anthropic",
      [
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
      ].join("\n\n")
    );
    expect(events).toContainEqual({ type: "stop", truncated: false });
  });

  it("reports truncation when an OpenAI-compatible model stops on length", async () => {
    const events = await collect(
      "openai",
      [
        'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
        "data: [DONE]",
      ].join("\n\n")
    );
    expect(events).toContainEqual({ type: "stop", truncated: true });
  });

  it("reports a clean OpenAI stop as not truncated", async () => {
    const events = await collect(
      "openai",
      [
        'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
        "data: [DONE]",
      ].join("\n\n")
    );
    expect(events).toContainEqual({ type: "stop", truncated: false });
  });
});
