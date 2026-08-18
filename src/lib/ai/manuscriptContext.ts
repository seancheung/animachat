import { estimateTokens, type LlmMessage, type ResolvedModel } from "./client";
import { taskMaxTokens, type Settings } from "@/lib/types";

export type ManuscriptGenerationAction =
  | "continue"
  | "rewrite"
  | "assistant"
  | "settings-assistant"
  | "character-design"
  | "synopsis"
  | "style"
  | "character"
  | "conversation-chat";

/** Route manuscript features to the reply-length control matching their output. */
export function manuscriptResponseTokens(
  settings: Settings,
  action: ManuscriptGenerationAction
): number {
  if (action === "conversation-chat") return taskMaxTokens(settings, "chat");
  if (action === "continue" || action === "rewrite") {
    return taskMaxTokens(settings, "manuscriptWrite");
  }
  return taskMaxTokens(settings, "assist");
}

export interface BuiltManuscriptPrompt {
  system: string;
  messages: LlmMessage[];
}

export interface ManuscriptContextState<T> {
  chapterContent: string | null;
  chapterTruncated: boolean;
  history: T[];
  historyTruncated: boolean;
}

export interface PackedManuscriptPrompt<T> extends ManuscriptContextState<T> {
  request: BuiltManuscriptPrompt;
  inputBudget: number;
  estimatedInputTokens: number;
  originalChapterTokens: number;
  includedChapterTokens: number;
  omittedHistoryMessages: number;
  overBudget: boolean;
}

const requestTokens = (request: BuiltManuscriptPrompt) =>
  estimateTokens(request.system) + request.messages.reduce(
    (total, message) => total + estimateTokens(message.content) + 8,
    0
  );

export function manuscriptInputBudget(
  settings: Settings,
  model: ResolvedModel,
  responseTokens: number
): number {
  const responseReserve = Math.max(settings.outputReserve, responseTokens);
  return Math.max(
    1,
    Math.min(settings.contextBudgetCap, model.model.contextWindow - responseReserve)
  );
}

function excerptChapter(
  value: string,
  maxTokens: number,
  focus?: { start: number; end: number }
): {
  content: string;
  truncated: boolean;
  originalTokens: number;
  includedTokens: number;
} {
  const originalTokens = estimateTokens(value);
  if (originalTokens <= maxTokens) {
    return { content: value, truncated: false, originalTokens, includedTokens: originalTokens };
  }
  if (maxTokens <= 0 || !value) {
    return { content: "", truncated: true, originalTokens, includedTokens: 0 };
  }

  const validFocus = focus
    && focus.start >= 0
    && focus.end >= focus.start
    && focus.end <= value.length
    ? focus
    : null;
  const candidate = (retainedCharacters: number) => {
    const intervals = validFocus
      ? (() => {
          const headCharacters = Math.floor(retainedCharacters * 0.15);
          const focusCharacters = Math.floor(retainedCharacters * 0.55);
          const tailCharacters = retainedCharacters - headCharacters - focusCharacters;
          const focusCenter = Math.floor((validFocus.start + validFocus.end) / 2);
          const focusStart = Math.max(
            0,
            Math.min(value.length - focusCharacters, focusCenter - Math.floor(focusCharacters / 2))
          );
          return [
            [0, headCharacters],
            [focusStart, focusStart + focusCharacters],
            [value.length - tailCharacters, value.length],
          ];
        })()
      : [
          [0, Math.floor(retainedCharacters * 0.25)],
          [value.length - Math.ceil(retainedCharacters * 0.75), value.length],
        ];
    const merged: [number, number][] = [];
    for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
      if (end <= start) continue;
      const previous = merged.at(-1);
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else merged.push([start, end]);
    }
    const segments = merged.map(([start, end]) => value.slice(start, end));
    const includedTokens = segments.reduce((total, segment) => total + estimateTokens(segment), 0);
    const omittedTokens = Math.max(0, originalTokens - includedTokens);
    return {
      content: segments.join(
        `\n\n[Active chapter content omitted: approximately ${omittedTokens.toLocaleString("en-US")} tokens not included.]\n\n`
      ),
      includedTokens,
    };
  };

  let low = 0;
  let high = value.length;
  let best = { content: "", includedTokens: 0 };
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const next = candidate(middle);
    if (estimateTokens(next.content) <= maxTokens) {
      best = next;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return {
    content: best.content,
    truncated: true,
    originalTokens,
    includedTokens: best.includedTokens,
  };
}

/**
 * Fit an active chapter and recent history into a model-aware input budget.
 * Full context is kept when it fits. On overflow, the newest message is kept,
 * older history receives up to 25% of the remaining room, and the chapter uses
 * a beginning-and-ending excerpt (25/75) so setup and current continuity remain.
 */
export function packManuscriptPrompt<T>({
  chapterContent,
  history,
  inputBudget,
  build,
  preserveHistoryItem,
  chapterFocus,
}: {
  chapterContent: string | null;
  history: T[];
  inputBudget: number;
  build: (state: ManuscriptContextState<T>) => BuiltManuscriptPrompt;
  preserveHistoryItem?: (item: T, index: number) => boolean;
  chapterFocus?: { start: number; end: number };
}): PackedManuscriptPrompt<T> {
  const fullState: ManuscriptContextState<T> = {
    chapterContent,
    chapterTruncated: false,
    history,
    historyTruncated: false,
  };
  const fullRequest = build(fullState);
  const fullTokens = requestTokens(fullRequest);
  const originalChapterTokens = chapterContent === null ? 0 : estimateTokens(chapterContent);
  if (fullTokens <= inputBudget) {
    return {
      ...fullState,
      request: fullRequest,
      inputBudget,
      estimatedInputTokens: fullTokens,
      originalChapterTokens,
      includedChapterTokens: originalChapterTokens,
      omittedHistoryMessages: 0,
      overBudget: false,
    };
  }

  const pinnedIndexes = new Set<number>();
  if (history.length) pinnedIndexes.add(history.length - 1);
  history.forEach((item, index) => {
    if (preserveHistoryItem?.(item, index)) pinnedIndexes.add(index);
  });
  const optionalIndexes = history
    .map((_, index) => index)
    .filter((index) => !pinnedIndexes.has(index));
  const historyAt = (extraIndexes: Set<number>) => history.filter(
    (_, index) => pinnedIndexes.has(index) || extraIndexes.has(index)
  );
  const pinnedHistory = historyAt(new Set());
  const emptyChapter = chapterContent === null ? null : "";
  const minimumState: ManuscriptContextState<T> = {
    chapterContent: emptyChapter,
    chapterTruncated: chapterContent !== null,
    history: pinnedHistory,
    historyTruncated: pinnedHistory.length < history.length,
  };
  const minimumTokens = requestTokens(build(minimumState));
  const variableRoom = Math.max(0, inputBudget - minimumTokens);
  const historyAllowance = Math.floor(variableRoom * 0.25);
  const keptOptionalIndexes = new Set<number>();

  for (let position = optionalIndexes.length - 1; position >= 0; position--) {
    const index = optionalIndexes[position];
    const candidateIndexes = new Set([...keptOptionalIndexes, index]);
    const candidateHistory = historyAt(candidateIndexes);
    const candidateState: ManuscriptContextState<T> = {
      ...minimumState,
      history: candidateHistory,
      historyTruncated: candidateHistory.length < history.length,
    };
    const extraTokens = requestTokens(build(candidateState)) - minimumTokens;
    if (extraTokens > historyAllowance) break;
    keptOptionalIndexes.add(index);
  }

  let keptHistory = historyAt(keptOptionalIndexes);
  const makeState = (content: string | null, truncated: boolean): ManuscriptContextState<T> => ({
    chapterContent: content,
    chapterTruncated: truncated,
    history: keptHistory,
    historyTruncated: keptHistory.length < history.length,
  });
  const chapterlessState = makeState(emptyChapter, chapterContent !== null);
  let chapterRoom = Math.max(0, inputBudget - requestTokens(build(chapterlessState)));
  let excerpt = chapterContent === null
    ? { content: "", truncated: false, originalTokens: 0, includedTokens: 0 }
    : excerptChapter(chapterContent, chapterRoom, chapterFocus);
  let state = makeState(chapterContent === null ? null : excerpt.content, excerpt.truncated);
  let request = build(state);
  let estimatedInputTokens = requestTokens(request);

  for (let attempt = 0; estimatedInputTokens > inputBudget && chapterRoom > 0 && attempt < 12; attempt++) {
    chapterRoom = Math.max(0, chapterRoom - (estimatedInputTokens - inputBudget) - 16);
    excerpt = chapterContent === null
      ? excerpt
      : excerptChapter(chapterContent, chapterRoom, chapterFocus);
    state = makeState(chapterContent === null ? null : excerpt.content, excerpt.truncated);
    request = build(state);
    estimatedInputTokens = requestTokens(request);
  }

  while (estimatedInputTokens > inputBudget && keptOptionalIndexes.size) {
    const oldestOptionalIndex = Math.min(...keptOptionalIndexes);
    keptOptionalIndexes.delete(oldestOptionalIndex);
    keptHistory = historyAt(keptOptionalIndexes);
    state = makeState(chapterContent === null ? null : excerpt.content, excerpt.truncated);
    request = build(state);
    estimatedInputTokens = requestTokens(request);
  }

  return {
    ...state,
    request,
    inputBudget,
    estimatedInputTokens,
    originalChapterTokens,
    includedChapterTokens: excerpt.includedTokens,
    omittedHistoryMessages: history.length - keptHistory.length,
    overBudget: estimatedInputTokens > inputBudget,
  };
}
