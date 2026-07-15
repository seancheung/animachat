import { bad, handler } from "@/lib/api";
import { AiConfigError, resolveModel, streamLlm } from "@/lib/ai/client";
import { debugResponseLogEnabled, writeDebugLog } from "@/lib/debugLog";
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
    `"name": string; "description": string (the PREMISE — the situation as play opens, spoiler-free: everyone sees it; put hidden truths in secrets, not here); ` +
    `"destination": string (one line naming where the story is headed and what "the end" means — seen only by the narrator; steers the ending without scripting the route); ` +
    `"secrets": [{"title": "short handle", "content": "the hidden truth — PRESENT TENSE, already true as play opens", "knownByNames": ["cast", "names", "who", "ALREADY", "know", "at", "open"], "revealHint": "when/how it wants to surface"}] (the story's hidden truths — knownByNames may be empty for a truth nobody on stage knows; it lists who already knows as play OPENS, never who the secret concerns — a character meant to learn it mid-story is left out); ` +
    `"castNames": ["ordered", "character", "names"] (the story's cast — characters in the library or this batch, linked by name on save; order matters); ` +
    `"scenes": [{"sceneName": string, "castNames": ["who", "opens", "the scene"], "goal": "what the scene is FOR dramatically", "obstacles": "what resists", "exit": "what done looks like — the cue to advance", "pressures": "what moves ELSEWHERE while this scene plays — offstage momentum surfacing only as consequences", "successors": [{"sceneName": "an allowed next scene", "hint": "condition guidance — when this road is the one (never a mechanical gate)"}]}] (ordered scene sequence with each scene's contract; goal/obstacles/exit/pressures are optional but give the scene a job; successors are optional AUTHORED BRANCHING — omit to fall through to the next scene in order; list 2+ roads to make a branch point. A scene named as some scene's successor is reached ONLY by its road, never by fallthrough — so a branch target with no successors of its own is an ending: several such final scenes = several endings); ` +
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

/** Cap per attached file so a huge source dump can't blow the context (chars, not tokens — CJK text runs ~1–1.5 tokens per char, so this is far more tokens for Chinese than for English). */
const ATTACHMENT_CHAR_CAP = 200_000;

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
        (st.destination ? `\nDestination: ${st.destination}` : "") +
        (cast.length ? `\nCast in order: ${cast.join(", ")}` : "") +
        (scenes.length ? `\nScenes in order: ${scenes.join(" → ")}` : "") +
        (st.secrets.length
          ? `\nSecrets:\n${st.secrets
              .map((s) => {
                const who = s.knownBy.map((cid) => getCharacter(cid)?.name).filter(Boolean);
                return `- "${s.title}": ${s.content} (held by: ${who.join(", ") || "nobody"})`;
              })
              .join("\n")}`
          : "")
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
    (isLibrary || body.entityType === "story"
      ? `STORY DESIGN PRINCIPLE — author situations, not plots. A story records what is TRUE and under what PRESSURE, never a sequence of events: the player's freedom breaks sequences, it cannot break truths.\n` +
        `- The premise is the situation as play opens — a web of wants, debts and tensions, spoiler-free. Hidden truths belong in secrets, never in the premise.\n` +
        `- Secrets carry the drama: give each a holder (or none), a truth that stays true whatever the player does, and a reveal hint naming the KIND of moment that surfaces it — not a scheduled scene.\n` +
        `- Secrets are STANDING TRUTHS in present tense: a "will happen" is authored as the intention or arrangement already in place ("she has already signed the order", not "she will sign it in scene 3").\n` +
        `- knownByNames = who already knows as play OPENS, never who the secret concerns. A character meant to LEARN a truth mid-story starts outside it — extracting from a novel, mark who knows at the story's opening, not who knows by its end.\n` +
        `- Scene contracts are jobs, not scripts: a goal (what the scene is for), obstacles (what resists), an exit condition (what done looks like). Never "then X happens" — write what pulls and what blocks, and let play find the path.\n` +
        `- Offstage pressures keep the world moving: an optional per-scene line naming what advances ELSEWHERE while the scene plays ("the rival's men search the docks tonight") — it surfaces as consequences, never as a scheduled event.\n` +
        `- Branches are situations the truths make reachable, not scripted routes: give a scene successors only where the truths genuinely open more than one road, each with a condition hint ("if trust has grown → Moonlit Confession") — guidance for the narrator's judgment, never a gate. Multiple final scenes are multiple endings; the destination says what "the end" MEANS, each final scene is one way of answering it.\n` +
        `- The destination names where the story is headed, not the route or the twists.\n` +
        `- If the user asks to script a beat ("then in scene 3 she betrays him"), don't put it in a scene or the premise — convert it into the truths and pressures that make that moment likely (a secret with a reveal hint, a motive in a character sheet, an obstacle), and say that's what you did.\n\n`
      : "") +
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
          // the fields block is held back until it parses — tell the client the
          // assistant is now writing into the form, not stalled
          send({ type: "drafting" });
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

      let truncated = false;
      try {
        for await (const ev of streamLlm({
          modelRef,
          system,
          messages: body.messages,
          maxTokens: isLibrary ? 32000 : 2000, // item batches (e.g. novel extraction) need room
          feature: "assist",
          signal: abort.signal,
        })) {
          if (ev.type === "text") {
            buf += ev.text;
            flush();
          } else if (ev.type === "stop") {
            truncated = ev.truncated;
          }
        }
        if (!inFields && visible.length < buf.length) {
          send({ type: "text", text: buf.slice(visible.length) });
        }
        const fieldsRe = new RegExp(`${OPEN}([\\s\\S]*?)(?:${CLOSE}|$)`);
        const m = buf.match(fieldsRe);
        if (m) {
          // On a parse failure, feed the error back to the model for a fixup, up to the
          // configured retry count — pointless after a maxTokens cutoff, where the cure
          // is a shorter batch, not better syntax.
          const fixupRetries = truncated ? 0 : Math.max(0, settings.assistFixupRetries);
          const fixups: string[] = [];
          let raw = m[1].trim();
          let lastReply = buf;
          let fields;
          let parsed = false;
          let parseErr: unknown = null;
          for (let attempt = 0; ; attempt++) {
            try {
              fields = JSON.parse(raw);
              parsed = true;
              break;
            } catch (e) {
              parseErr = e;
              if (attempt >= fixupRetries || abort.signal.aborted) break;
              console.error(`assist: fields block failed to parse, requesting fixup ${attempt + 1}/${fixupRetries}:`, e);
              // the panel keeps showing its "drafting" indicator while this runs
              let fixed = "";
              try {
                for await (const ev of streamLlm({
                  modelRef,
                  system,
                  messages: [
                    ...body.messages,
                    { role: "assistant", content: lastReply },
                    {
                      role: "user",
                      content:
                        `Your ${OPEN} block is not valid JSON — JSON.parse failed with: ` +
                        `${e instanceof Error ? e.message : String(e)}\n` +
                        `Re-emit the ENTIRE block corrected: reply with only ${OPEN}...${CLOSE} — same content, valid JSON, no prose.`,
                    },
                  ],
                  maxTokens: isLibrary ? 32000 : 2000,
                  feature: "assist",
                  signal: abort.signal,
                })) {
                  if (ev.type === "text") fixed += ev.text;
                }
              } catch (fixupErr) {
                console.error("assist: fixup request failed:", fixupErr);
                break;
              }
              fixups.push(fixed);
              lastReply = fixed;
              const fm = fixed.match(fieldsRe);
              raw = (fm ? fm[1] : fixed).trim();
            }
          }
          if (parsed) {
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
          } else {
            const e = parseErr;
            console.error("assist: fields block failed to parse:", e);
            send({
              type: "text",
              text: truncated
                ? "\n(My reply hit the response length limit before the fields were complete — ask me to continue, or to produce fewer items at a time.)"
                : "\n(I produced malformed field data — ask me to try again.)",
            });
            if (debugResponseLogEnabled()) {
              try {
                const url = writeDebugLog(
                  "assist",
                  [
                    "AnimaChat assist debug log — the <fields> block failed to parse",
                    `time: ${new Date().toISOString()}`,
                    `entityType: ${body.entityType}`,
                    `truncated by maxTokens: ${truncated}`,
                    `fixup attempts: ${fixups.length}`,
                    "",
                    "--- error (last attempt) ---",
                    e instanceof Error ? (e.stack ?? e.message) : String(e),
                    "",
                    "--- raw model response ---",
                    buf,
                    ...fixups.flatMap((f, i) => ["", `--- fixup attempt ${i + 1} response ---`, f]),
                  ].join("\n")
                );
                send({ type: "log", url });
              } catch (logErr) {
                console.error("assist: could not write debug log:", logErr);
              }
            }
          }
        } else if (truncated) {
          send({
            type: "text",
            text: "\n(My reply hit the response length limit — ask me to continue.)",
          });
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
