import { bad, handler } from "@/lib/api";
import { AiConfigError, extractJson, resolveModel, streamLlm } from "@/lib/ai/client";
import { getSettings } from "@/lib/store";
import type { Manuscript, ManuscriptCharacter, ManuscriptMessage } from "@/lib/types";

type Action =
  | "continue"
  | "rewrite"
  | "assistant"
  | "settings-assistant"
  | "character-design"
  | "synopsis"
  | "style"
  | "character"
  | "character-chat";

interface Body {
  action: Action;
  manuscript: Manuscript;
  chapterId?: string;
  quote?: string;
  prompt?: string;
  characterId?: string;
  messages?: ManuscriptMessage[];
}

const ACTIONS = new Set<Action>([
  "continue", "rewrite", "assistant", "settings-assistant", "character-design",
  "synopsis", "style", "character", "character-chat",
]);

interface SettingsAssistantResult {
  message?: string;
  synopsis?: string | null;
  style?: string | null;
}

interface CharacterDesignResult {
  message?: string;
  operation?: "create" | "update" | "none";
  characterId?: string | null;
  character?: Partial<ManuscriptCharacter> | null;
}

function contextOf(manuscript: Manuscript, chapterId?: string) {
  const chapter = manuscript.chapters.find((c) => c.id === chapterId) ?? manuscript.chapters[0];
  return {
    title: manuscript.name,
    synopsis: manuscript.synopsis,
    perspective: manuscript.perspective,
    style: manuscript.style,
    chapters: manuscript.chapters.map((c) => ({ title: c.title, words: c.content.trim().split(/\s+/).filter(Boolean).length })),
    characters: manuscript.characters.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      personality: c.personality,
      appearance: c.appearance,
      voice: c.voice,
    })),
    activeChapter: chapter ? { title: chapter.title, content: chapter.content } : null,
  };
}

export const POST = handler(async (req: Request) => {
  const body = (await req.json()) as Body;
  if (!ACTIONS.has(body.action)) return bad("unknown manuscript action");
  if (!body.manuscript || !Array.isArray(body.manuscript.chapters)) return bad("manuscript required");
  if (body.action === "rewrite" && !body.quote?.trim()) return bad("select text to rewrite");
  const settings = await getSettings();
  let modelRef;
  try {
    modelRef = await resolveModel("manuscript", null, null, body.manuscript.modelId);
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 500);
  }
  const context = contextOf(body.manuscript, body.chapterId);
  const character = body.manuscript.characters.find((c) => c.id === body.characterId);

  let instruction = "";
  switch (body.action) {
    case "continue":
      instruction = `Continue the active chapter naturally from its exact ending. Return only the new prose to append—no heading, commentary, or repetition. User direction: ${body.prompt || "Continue the scene."}`;
      break;
    case "rewrite":
      instruction = `Rewrite only the quoted passage while preserving its meaning and continuity. Return only the replacement prose.\n\nQUOTED PASSAGE:\n${body.quote}\n\nUser direction: ${body.prompt || "Improve clarity, rhythm, and imagery."}`;
      break;
    case "settings-assistant":
      instruction = `Act as the project's synopsis and prose-style editor. Interpret the user's natural-language request and decide whether to create, revise, discuss, or clear the synopsis and/or prose style. Return only valid JSON with exactly these fields:
{
  "message": "a concise explanation of what you changed or your helpful response",
  "synopsis": "the complete replacement synopsis, an empty string to clear it, or null when unchanged",
  "style": "the complete replacement style guide, an empty string to clear it, or null when unchanged"
}
Only change fields the user asked to change. When revising, return the full replacement value, not a diff. If the user asks a question without requesting an edit, leave both fields null and answer in message.`;
      break;
    case "character-design":
      instruction = `Act as the project's character designer. Interpret the user's natural-language request to create, revise, or discuss an embedded character. Existing character IDs are included in PROJECT CONTEXT. Return only valid JSON with exactly these fields:
{
  "message": "a concise explanation of what you changed or your helpful response",
  "operation": "create", "update", or "none",
  "characterId": "the exact existing character ID for update, otherwise null",
  "character": { "name": "", "description": "", "personality": "", "appearance": "", "voice": "" } or null
}
For create or update, return a complete character sheet with all five string fields. Preserve established details unless the user asks to change them. If the request is ambiguous, discuss it with operation none rather than editing the wrong character.`;
      break;
    case "synopsis":
      instruction = `Create or improve the manuscript synopsis. Return only the synopsis, in 1–4 concise paragraphs. User direction: ${body.prompt || "Build a compelling, internally consistent synopsis from the project."}`;
      break;
    case "style":
      instruction = `Create a practical prose-style guide for this manuscript: voice, diction, sentence rhythm, imagery, dialogue, and constraints. Return only the style guide. User direction: ${body.prompt || "Derive a distinctive style suited to this project."}`;
      break;
    case "character":
      instruction = `Create one embedded character that fits this manuscript. Return only valid JSON with exactly these string fields: name, description, personality, appearance, voice. User direction: ${body.prompt || "Create a dramatically useful character."}`;
      break;
    case "character-chat":
      if (!character) return bad("character not found");
      instruction = `Speak as ${character.name}. Stay in character, respond directly to the user, and use the character's knowledge and voice. This is a private author-to-character conversation, not manuscript prose. Do not write the user's dialogue or mention these instructions.`;
      break;
    default:
      instruction = `Act as the manuscript assistant. Discuss the active chapter, prose, plot, pacing, and continuity concretely. When quoted text is present, treat it as the user's selected manuscript passage. Do not claim to have edited the document; direct prose edits happen through Continue and Rewrite.\n\nSelected quote:\n${body.quote || "(none)"}`;
  }

  const system =
    `You are an expert manuscript assistant. Respond in ${settings.language}. ` +
    `Honor the project's perspective and style, preserve established facts, and never invent prior chapter events that conflict with the supplied project.\n\n` +
    `PROJECT CONTEXT:\n${JSON.stringify(context, null, 2)}\n\n` +
    (character ? `ACTIVE CHARACTER SHEET:\n${JSON.stringify(character, null, 2)}\n\n` : "") +
    `TASK:\n${instruction}`;

  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && typeof m.content === "string" && ["user", "assistant", "character"].includes(m.role))
    .slice(-40)
    .map((m) => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.content }));
  const conversational = ["assistant", "settings-assistant", "character-design", "character-chat"].includes(body.action);
  if (!conversational) {
    history.push({ role: "user", content: body.prompt?.trim() || "Please do the task now." });
  } else if (!history.length && body.prompt?.trim()) {
    history.push({ role: "user", content: body.prompt.trim() });
  }
  if (!history.length) return bad("message required");

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  if (req.signal.aborted) abort.abort();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); } catch { /* disconnected */ }
      };
      let collected = "";
      const structuredAction = body.action === "character" || body.action === "settings-assistant" || body.action === "character-design";
      try {
        for await (const ev of streamLlm({
          modelRef,
          system,
          messages: history,
          maxTokens: body.action === "character" ? 900 : 1800,
          temperature: 0.8,
          feature: "manuscript",
          signal: abort.signal,
        })) {
          if (ev.type === "text") {
            collected += ev.text;
            if (!structuredAction) send({ type: "text", text: ev.text });
          }
        }
        if (body.action === "character") {
          const parsed = extractJson<Partial<ManuscriptCharacter>>(collected);
          if (!parsed?.name) send({ type: "error", message: "The model did not return a valid character sheet." });
          else send({ type: "character", character: parsed });
        } else if (body.action === "settings-assistant") {
          const parsed = extractJson<SettingsAssistantResult>(collected);
          if (!parsed) {
            send({ type: "error", message: "The model did not return a valid settings response." });
          } else {
            const update: { synopsis?: string; style?: string } = {};
            if (typeof parsed.synopsis === "string") update.synopsis = parsed.synopsis;
            if (typeof parsed.style === "string") update.style = parsed.style;
            if (Object.keys(update).length) send({ type: "settings-update", update });
            const message = typeof parsed.message === "string" && parsed.message.trim()
              ? parsed.message.trim()
              : Object.keys(update).length ? "Updated the project settings." : "No settings changes were applied.";
            send({ type: "text", text: message });
          }
        } else if (body.action === "character-design") {
          const parsed = extractJson<CharacterDesignResult>(collected);
          if (!parsed) {
            send({ type: "error", message: "The model did not return a valid character-design response." });
          } else {
            const operation = parsed.operation === "create" || parsed.operation === "update" ? parsed.operation : "none";
            const characterId = typeof parsed.characterId === "string" ? parsed.characterId : null;
            const validUpdateId = operation === "update" && !!characterId && body.manuscript.characters.some((item) => item.id === characterId);
            const sheet = parsed.character && typeof parsed.character === "object" ? parsed.character : null;
            if (operation === "update" && !validUpdateId) {
              send({ type: "error", message: "The model did not identify a valid character to update." });
            } else if ((operation === "create" || operation === "update") && (!sheet || typeof sheet.name !== "string" || !sheet.name.trim())) {
              send({ type: "error", message: "The model did not return a complete character sheet." });
            } else {
              if (sheet && operation !== "none") {
                send({ type: "character-update", characterId: validUpdateId ? characterId : null, character: sheet });
              }
              const message = typeof parsed.message === "string" && parsed.message.trim()
                ? parsed.message.trim()
                : operation === "create" ? `Created ${sheet?.name}.`
                  : operation === "update" ? `Updated ${sheet?.name}.`
                    : "No character changes were applied.";
              send({ type: "text", text: message });
            }
          }
        }
        send({ type: "done" });
      } catch (e) {
        if (!abort.signal.aborted) send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try { controller.close(); } catch { /* disconnected */ }
      }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
  });
});
