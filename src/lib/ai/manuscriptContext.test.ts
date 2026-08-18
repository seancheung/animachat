import { describe, expect, it } from "vitest";
import { estimateTokens, type LlmMessage, type ResolvedModel } from "./client";
import {
  manuscriptChapterContextForAction,
  manuscriptGenerationModelTask,
  manuscriptInputBudget,
  manuscriptResponseTokens,
  packManuscriptPrompt,
  type ManuscriptContextState,
} from "./manuscriptContext";
import { DEFAULT_SETTINGS } from "@/lib/types";

const build = (state: ManuscriptContextState<LlmMessage>) => ({
  system: JSON.stringify({
    chapter: state.chapterContent,
    chapterTruncated: state.chapterTruncated,
    historyTruncated: state.historyTruncated,
  }),
  messages: state.history,
});

describe("manuscript context packing", () => {
  it("routes chapter summaries through the system summarization model", () => {
    expect(manuscriptGenerationModelTask("chapter-summary")).toBe("memory");
    expect(manuscriptGenerationModelTask("assistant")).toBe("manuscriptWrite");
    expect(manuscriptGenerationModelTask("conversation-chat")).toBe("chat");
  });

  it("applies the selected chapter attachment to structured assistants", () => {
    expect(manuscriptChapterContextForAction("settings-assistant")).toBe("none");
    expect(manuscriptChapterContextForAction("settings-assistant", "invalid" as never)).toBe("none");
    expect(manuscriptChapterContextForAction("character-design", "summary")).toBe("summary");
    expect(manuscriptChapterContextForAction("settings-assistant", "full")).toBe("full");
    expect(manuscriptChapterContextForAction("assistant", "none")).toBe("full");
    expect(manuscriptChapterContextForAction("continue", "summary")).toBe("full");
    expect(manuscriptChapterContextForAction("chapter-summary", "none")).toBe("full");
  });

  it("routes each manuscript feature to the intended response cap", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      taskMaxTokens: { chat: 111, assist: 222, manuscriptWrite: 333, chapterSummary: 444 },
    };
    for (const action of [
      "assistant",
      "settings-assistant",
      "character-design",
      "synopsis",
      "style",
      "character",
    ] as const) {
      expect(manuscriptResponseTokens(settings, action)).toBe(222);
    }
    expect(manuscriptResponseTokens(settings, "continue")).toBe(333);
    expect(manuscriptResponseTokens(settings, "rewrite")).toBe(333);
    expect(manuscriptResponseTokens(settings, "conversation-chat")).toBe(111);
    expect(manuscriptResponseTokens(settings, "chapter-summary")).toBe(444);
  });

  it("uses the model window, configured cap, and response reserve", () => {
    const model = {
      model: { contextWindow: 10_000 },
    } as ResolvedModel;
    expect(manuscriptInputBudget(DEFAULT_SETTINGS, model, 1_800)).toBe(8_000);
    expect(manuscriptInputBudget(
      { ...DEFAULT_SETTINGS, contextBudgetCap: 4_000 },
      model,
      1_800
    )).toBe(4_000);
  });

  it("keeps the full chapter and history when they fit", () => {
    const history: LlmMessage[] = [{ role: "user", content: "Review this chapter." }];
    const packed = packManuscriptPrompt({
      chapterContent: "A short chapter.",
      history,
      inputBudget: 1_000,
      build,
    });
    expect(packed.chapterContent).toBe("A short chapter.");
    expect(packed.chapterTruncated).toBe(false);
    expect(packed.history).toEqual(history);
    expect(packed.overBudget).toBe(false);
  });

  it("keeps the chapter beginning and ending when it must shorten it", () => {
    const chapter = `OPENING ${"middle passage ".repeat(2_000)} ENDING`;
    const packed = packManuscriptPrompt({
      chapterContent: chapter,
      history: [{ role: "user", content: "Continue." }],
      inputBudget: 600,
      build,
    });
    expect(packed.chapterTruncated).toBe(true);
    expect(packed.chapterContent).toContain("OPENING");
    expect(packed.chapterContent).toContain("ENDING");
    expect(packed.chapterContent).toContain("content omitted");
    expect(packed.includedChapterTokens).toBeLessThan(packed.originalChapterTokens);
    expect(packed.estimatedInputTokens).toBeLessThanOrEqual(packed.inputBudget);
  });

  it("keeps the newest history while dropping older turns by token budget", () => {
    const history: LlmMessage[] = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: `message-${index} ${"detail ".repeat(80)}`,
    }));
    const packed = packManuscriptPrompt({
      chapterContent: "chapter ".repeat(1_000),
      history,
      inputBudget: 700,
      build,
    });
    expect(packed.history.at(-1)?.content).toBe(history.at(-1)?.content);
    expect(packed.omittedHistoryMessages).toBeGreaterThan(0);
    expect(packed.estimatedInputTokens).toBeLessThanOrEqual(packed.inputBudget);
  });

  it("keeps explicitly pinned history even when newer messages exist", () => {
    const history: LlmMessage[] = [
      { role: "user", content: `author request ${"important ".repeat(100)}` },
      { role: "assistant", content: `first reply ${"detail ".repeat(100)}` },
      { role: "assistant", content: `latest reply ${"detail ".repeat(100)}` },
    ];
    const packed = packManuscriptPrompt({
      chapterContent: "chapter ".repeat(1_000),
      history,
      inputBudget: 700,
      build,
      preserveHistoryItem: (_message, index) => index === 0,
    });
    expect(packed.history).toContain(history[0]);
    expect(packed.history.at(-1)).toBe(history.at(-1));
  });

  it("keeps nearby context around selected text in an oversized chapter", () => {
    const chapter = `OPENING ${"early ".repeat(2_000)}BEFORE_SELECTION SELECTED AFTER_SELECTION${" late".repeat(2_000)} ENDING`;
    const start = chapter.indexOf("SELECTED");
    const packed = packManuscriptPrompt({
      chapterContent: chapter,
      chapterFocus: { start, end: start + "SELECTED".length },
      history: [{ role: "user", content: "Discuss the selected passage." }],
      inputBudget: 700,
      build,
    });
    expect(packed.chapterContent).toContain("OPENING");
    expect(packed.chapterContent).toContain("BEFORE_SELECTION");
    expect(packed.chapterContent).toContain("SELECTED");
    expect(packed.chapterContent).toContain("AFTER_SELECTION");
    expect(packed.chapterContent).toContain("ENDING");
    expect(packed.estimatedInputTokens).toBeLessThanOrEqual(packed.inputBudget);
  });

  it("reports chapter token counts independently of the omission marker", () => {
    const chapter = "内容".repeat(2_000);
    const packed = packManuscriptPrompt({
      chapterContent: chapter,
      history: [{ role: "user", content: "Analyze it." }],
      inputBudget: 500,
      build,
    });
    expect(packed.originalChapterTokens).toBe(estimateTokens(chapter));
    expect(packed.includedChapterTokens).toBeLessThan(packed.originalChapterTokens);
  });
});
