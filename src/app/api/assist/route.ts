import { bad, handler } from "@/lib/api";
import { AiConfigError, resolveModel, streamLlm } from "@/lib/ai/client";
import { normalizeSelfTags } from "@/lib/ai/placeholders";
import { getSettings } from "@/lib/store";

export const dynamic = "force-dynamic";

const STAGE_STYLE_DOC =
  `"stageStyle": {"enabled": true, "stageBg": "#hex", "panelBg": "#hex", "panelFg": "#hex", "panelOpacity": 0.1-1, "messageBg": "#hex", "messageFg": "#hex", "accent": "#hex", "accentFg": "#hex"} or null ` +
  `(optional chat-UI palette while this place is active, organized as Bg/Fg SURFACE PAIRS — each Fg is the text ON its own Bg and must contrast with that Bg, never judge it against another surface: ` +
  `panelBg+panelFg = the floating chat panel and its controls (inputs, buttons, badges, borders all derive from this pair); ` +
  `messageBg+messageFg = the message bubbles; accent+accentFg = primary buttons & highlights; ` +
  `stageBg = the VN stage backdrop behind the sprites, no text ever sits on it. ` +
  `Every field optional — an omitted Fg auto-contrasts with its Bg. Match the place's mood; ` +
  `styles are OFF unless "enabled": true — include "enabled": true when the user wants the style applied)`;

const FIELD_DOCS: Record<string, string> = {
  character:
    `"name": string; "description": string (detailed personality, background, mannerisms — the character sheet); ` +
    `"greeting": string (their opening message, *actions* in asterisks, "dialogue" in quotes); ` +
    `"exampleDialogue": string (a few short sample lines showing their voice — one utterance per line, *actions* in asterisks, "dialogue" in quotes; to demonstrate a reply to the user, label the turns with the literal tags: "[user_name]: ..." then "[char_name]: ..."); ` +
    `"imagePrompt": string (text-to-image prompt for their neutral sprite: appearance, outfit, style; 2:3 portrait); ` +
    `"customExpressions": [{"name": "kebab-case", "description": "when to use it"}]`,
  persona: `"name": string; "description": string (who the user is in the roleplay)`,
  location:
    `"name": string; "description": string (the place, its atmosphere, sensory details); ` +
    `"imagePrompt": string (text-to-image prompt for a 16:9 background artwork of this place); ` +
    STAGE_STYLE_DOC,
  scene:
    `"name": string; "setup": string (the situation: what is happening, stakes, how it starts); ` +
    `"imagePrompt": string (text-to-image prompt for a 16:9 background artwork of this scene); ` +
    STAGE_STYLE_DOC,
  story: `"name": string; "description": string (premise and arc of the story)`,
  lorebook:
    `"name": string; "description": string; ` +
    `"entries": [{"id": "keep existing id or omit for new", "title": string, "keywords": ["trigger", "words"], "content": string, "scanDepth": 8}]`,
};

interface AssistBody {
  entityType: keyof typeof FIELD_DOCS;
  fields: Record<string, unknown>;
  messages: { role: "user" | "assistant"; content: string }[];
}

const OPEN = "<fields>";
const CLOSE = "</fields>";

export const POST = handler(async (req: Request) => {
  const body = (await req.json()) as AssistBody;
  if (!FIELD_DOCS[body.entityType]) return bad("unknown entityType");
  if (!body.messages?.length) return bad("messages required");

  let modelRef;
  try {
    modelRef = resolveModel("assist");
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), e instanceof AiConfigError ? 409 : 500);
  }
  const settings = getSettings();

  const system =
    `You are a creative co-writing assistant inside the editor of a visual-novel roleplay app. ` +
    `You are helping the user create/refine a ${body.entityType}. Discuss ideas conversationally in ${settings.language}, ask at most one question at a time, and be concrete.\n\n` +
    `CURRENT FORM STATE:\n${JSON.stringify(body.fields, null, 2)}\n\n` +
    `FIELDS YOU MAY SET:\n${FIELD_DOCS[body.entityType]}\n\n` +
    `Text fields support placeholder tags replaced with live chat values: [user_name] (the user's persona), ` +
    `[loc_name], [scene_name], [story_name], and — inside a character's own fields — [char_name] for the character themselves. ` +
    `Prefer tags over hardcoded names where they fit, so content stays reusable across chats; referring to OTHER specific characters by their literal name is fine. ` +
    `Tags are literal strings the app substitutes at chat time — write them verbatim, brackets and all (exactly "[char_name]", NEVER the actual name inside brackets like "[Tom]").\n\n` +
    `Whenever you and the user have converged on content (or the user asks you to write it), apply it: end your reply with\n` +
    `${OPEN}{ ...only the fields you are changing... }${CLOSE}\n` +
    `The JSON must be valid. Update fields incrementally as the conversation progresses — don't wait for everything to be decided. Keep the prose part of your reply short; the content goes in the fields.`;

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let visible = ""; // text already sent
      let buf = ""; // full accumulated text
      let inFields = false;

      const flush = () => {
        if (inFields) return;
        const idx = buf.indexOf(OPEN);
        if (idx !== -1) {
          const emit = buf.slice(visible.length, idx);
          if (emit) send({ type: "text", text: emit });
          visible = buf.slice(0, idx);
          inFields = true;
          return;
        }
        // hold back a tail that could be a partial "<fields>"
        let safeEnd = buf.length;
        for (let k = Math.min(OPEN.length - 1, buf.length); k > 0; k--) {
          if (buf.endsWith(OPEN.slice(0, k))) {
            safeEnd = buf.length - k;
            break;
          }
        }
        if (safeEnd > visible.length) {
          send({ type: "text", text: buf.slice(visible.length, safeEnd) });
          visible = buf.slice(0, safeEnd);
        }
      };

      try {
        for await (const ev of streamLlm({
          modelRef,
          system,
          messages: body.messages,
          maxTokens: 2000,
          feature: "assist",
          signal: abort.signal,
        })) {
          if (ev.type === "text") {
            buf += ev.text;
            flush();
          }
        }
        if (!inFields && visible.length < buf.length) {
          send({ type: "text", text: buf.slice(visible.length) });
        }
        const m = buf.match(new RegExp(`${OPEN}([\\s\\S]*?)(?:${CLOSE}|$)`));
        if (m) {
          try {
            let fields = JSON.parse(m[1].trim());
            if (body.entityType === "character") {
              // models sometimes fill the name into the tag brackets ("[Tom]") — undo that
              const selfName =
                (typeof fields.name === "string" && fields.name) ||
                (typeof body.fields?.name === "string" && (body.fields.name as string)) ||
                null;
              fields = normalizeSelfTags(fields, selfName);
            }
            send({ type: "fields", fields });
          } catch {
            send({ type: "text", text: "\n(I produced malformed field data — ask me to try again.)" });
          }
        }
        send({ type: "done" });
      } catch (e) {
        if (!abort.signal.aborted)
          send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
    },
  });
});
