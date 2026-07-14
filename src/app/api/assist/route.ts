import { bad, handler } from "@/lib/api";
import { AiConfigError, resolveModel, streamLlm } from "@/lib/ai/client";
import { normalizeSelfTags } from "@/lib/ai/placeholders";
import {
  getCharacter,
  getLocation,
  getLorebook,
  getPersona,
  getScene,
  getSettings,
  getStory,
} from "@/lib/store";

export const dynamic = "force-dynamic";

const STAGE_STYLE_DOC =
  `"stageStyle": {"enabled": true, "stageBg": "#hex", "panelBg": "#hex", "panelFg": "#hex", "messageBg": "#hex", "messageFg": "#hex", "accent": "#hex", "accentFg": "#hex"} or null ` +
  `(optional chat-UI palette while this place is active — colors only, opacity is a user setting — organized as Bg/Fg SURFACE PAIRS — each Fg is the text ON its own Bg and must contrast with that Bg, never judge it against another surface: ` +
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
    `"imagePrompt": string (text-to-image prompt for their neutral sprite — see IMAGE PROMPT RULES; cover, in order: physical appearance (body, face, hair), outfit, a neutral standing pose, the framing/view distance (e.g. "full-body shot"), and end with a solid flat single-color background); ` +
    `"customExpressions": [{"name": "kebab-case", "description": "when to use it"}]`,
  persona: `"name": string; "description": string (who the user is in the roleplay)`,
  location:
    `"name": string; "description": string (the place, its atmosphere, sensory details); ` +
    `"imagePrompt": string (text-to-image prompt for the background artwork of this place — see IMAGE PROMPT RULES); ` +
    STAGE_STYLE_DOC,
  scene:
    `"name": string; "setup": string (the situation: what is happening, stakes, how it starts); ` +
    `"imagePrompt": string (text-to-image prompt for the background artwork of this scene — see IMAGE PROMPT RULES); ` +
    STAGE_STYLE_DOC,
  story:
    `"name": string; "description": string (premise and arc of the story); ` +
    `"castNames": ["ordered", "character", "names"] (the story's cast — characters in the library or this batch, linked by name on save; order matters); ` +
    `"scenes": [{"sceneName": string, "castNames": ["who", "opens", "the scene"]}] (ordered scene sequence — each castNames is the subset of the story cast on stage when that scene opens; linked by name on save); ` +
    `"lorebookNames": ["lorebook", "names"] (optional — attached to every playthrough of the story)`,
  lorebook:
    `"name": string; "description": string; ` +
    `"entries": [{"id": "keep existing id or omit for new", "title": string, "keywords": ["trigger", "words"], "content": string, "scanDepth": 8}]`,
};

// multi-item "library guide" mode: one batch of items across all entity types
FIELD_DOCS.library =
  `"items": [{"type": "character" | "persona" | "location" | "scene" | "story" | "lorebook", ...fields for that type}]\n` +
  `Per-type fields:\n` +
  `- character: ${FIELD_DOCS.character}\n` +
  `- persona: ${FIELD_DOCS.persona}\n` +
  `- location: ${FIELD_DOCS.location}\n` +
  `- scene: ${FIELD_DOCS.scene}; "locationName": string (optional — the name of a location among these items or in the library, linked on save)\n` +
  `- story: ${FIELD_DOCS.story}\n` +
  `- lorebook: ${FIELD_DOCS.lorebook}`;

interface AssistBody {
  entityType: keyof typeof FIELD_DOCS;
  fields: Record<string, unknown>;
  messages: { role: "user" | "assistant"; content: string }[];
  /** library items attached by the user as background context */
  references?: { type: string; id: string }[];
  /** text files attached by the user as source material */
  attachments?: { name: string; text: string }[];
}

/** Cap per attached file so a whole novel can't blow the context. */
const ATTACHMENT_CHAR_CAP = 60_000;

/** Serialize an attached library item for the system prompt; null if it no longer exists. */
function referenceText(ref: { type: string; id: string }): string | null {
  switch (ref.type) {
    case "character": {
      const c = getCharacter(ref.id);
      if (!c) return null;
      return `CHARACTER "${c.name}"\n${c.description}${c.exampleDialogue ? `\nExample dialogue:\n${c.exampleDialogue}` : ""}`;
    }
    case "persona": {
      const p = getPersona(ref.id);
      return p && `PERSONA "${p.name}" (an identity the user plays)\n${p.description}`;
    }
    case "location": {
      const l = getLocation(ref.id);
      return l && `LOCATION "${l.name}"\n${l.description}`;
    }
    case "scene": {
      const s = getScene(ref.id);
      if (!s) return null;
      const loc = s.locationId ? getLocation(s.locationId) : null;
      return `SCENE "${s.name}"${loc ? ` (at location "${loc.name}")` : ""}\n${s.setup}`;
    }
    case "story": {
      const st = getStory(ref.id);
      if (!st) return null;
      const cast = st.characterIds.map((cid) => getCharacter(cid)?.name).filter(Boolean);
      const scenes = st.scenes
        .map((e) => {
          const s = getScene(e.sceneId);
          if (!s) return null;
          const who = e.cast.map((cid) => getCharacter(cid)?.name).filter(Boolean);
          return `${s.name}${who.length ? ` (on stage: ${who.join(", ")})` : ""}`;
        })
        .filter(Boolean);
      return (
        `STORY "${st.name}"\n${st.description}` +
        (cast.length ? `\nCast in order: ${cast.join(", ")}` : "") +
        (scenes.length ? `\nScenes in order: ${scenes.join(" → ")}` : "")
      );
    }
    case "lorebook": {
      const lb = getLorebook(ref.id);
      if (!lb) return null;
      return `LOREBOOK "${lb.name}"${lb.description ? ` — ${lb.description}` : ""}\n${lb.entries
        .map((e) => `- ${e.title}: ${e.content}`)
        .join("\n")}`;
    }
  }
  return null;
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
  const isLibrary = body.entityType === "library";
  const refTexts = (body.references ?? []).map(referenceText).filter(Boolean) as string[];
  const attachTexts = (body.attachments ?? [])
    .filter((a) => a?.text)
    .map((a) => {
      const t = String(a.text);
      return `FILE "${a.name}"\n${t.slice(0, ATTACHMENT_CHAR_CAP)}${t.length > ATTACHMENT_CHAR_CAP ? "\n…(truncated)" : ""}`;
    });

  const system =
    `You are a creative co-writing assistant inside the editor of a visual-novel roleplay app. ` +
    (isLibrary
      ? `You are helping the user populate their library: create one or more items — characters, personas, locations, scenes, stories, lorebooks — in one session, often extracted from attached source material or built as a themed set. `
      : `You are helping the user create/refine a ${body.entityType}. `) +
    `Discuss ideas conversationally in ${settings.language}, ask at most one question at a time, and be concrete.\n\n` +
    `CURRENT FORM STATE:\n${JSON.stringify(body.fields, null, 2)}\n\n` +
    (refTexts.length
      ? `REFERENCE MATERIAL — library items the user attached for context. Use them to make the new content fit that cast and world (read-only background — don't copy them into the fields verbatim unless asked):\n\n${refTexts.join("\n\n")}\n\n`
      : "") +
    (attachTexts.length
      ? `SOURCE MATERIAL — text files the user attached (novels, notes, transcripts). Draw items from them when asked — stay faithful to the source:\n\n${attachTexts.join("\n\n")}\n\n`
      : "") +
    `FIELDS YOU MAY SET:\n${FIELD_DOCS[body.entityType]}\n\n` +
    `Text fields support placeholder tags replaced with live chat values: [user_name] (the user's persona), ` +
    `[loc_name], [scene_name], [story_name], and — inside a character's own fields — [char_name] for the character themselves. ` +
    `Prefer tags over hardcoded names where they fit, so content stays reusable across chats; referring to OTHER specific characters by their literal name is fine. ` +
    `Tags are literal strings the app substitutes at chat time — write them verbatim, brackets and all (exactly "[char_name]", NEVER the actual name inside brackets like "[Tom]").\n\n` +
    (isLibrary || ["character", "location", "scene"].includes(body.entityType)
      ? `IMAGE PROMPT RULES — every "imagePrompt" field is fed directly to a text-to-image generator:\n` +
        `- STRICTLY VISUAL: describe only what a camera would capture. Never include names, placeholder tags, personality, feelings, backstory, or lore — translate such traits into visible details instead (e.g. "a battle-worn veteran" → "scratched armor, a faded scar across the brow").\n` +
        `- Always write it in English, whatever the conversation language, unless the user explicitly asks for the prompt in another language.\n` +
        `- Never mention aspect ratio or image dimensions.\n` +
        `- Character sprites only: no environment or scenery — cover appearance, outfit, pose and framing, then end with a solid flat single-color background (pick a color that complements the design).\n\n`
      : "") +
    `Whenever you and the user have converged on content (or the user asks you to write it), apply it: end your reply with\n` +
    (isLibrary
      ? `${OPEN}{ "items": [ ...only items you are adding or changing... ] }${CLOSE}\n` +
        `An item is identified by its "type" + "name": a new name creates an item, an existing name updates it (only the fields you include change). ` +
        `To RENAME an item, add "renameFrom": "its current name" alongside the new "name" — a bare new name would create a duplicate. ` +
        `When a rename changes a name other items refer to (a story's castNames/scenes, a scene's locationName, lorebookNames), re-emit those fields with the new name too. ` +
        `Give new items complete fields. Never re-emit unchanged items.\n`
      : `${OPEN}{ ...only the fields you are changing... }${CLOSE}\n`) +
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
          maxTokens: isLibrary ? 8000 : 2000, // item batches (e.g. novel extraction) need room
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
            } else if (isLibrary && Array.isArray(fields.items)) {
              fields.items = fields.items.map((it: unknown) => {
                const item = it as { type?: string; name?: string };
                return item?.type === "character"
                  ? normalizeSelfTags(item, typeof item.name === "string" ? item.name : null)
                  : it;
              });
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
