import { mentionsToPlain, parseMentions, tagMentions } from "@/lib/mentions";
import type { LlmMessage } from "./client";
import type {
  ManuscriptCharacter,
  ManuscriptConversationMessage,
} from "@/lib/types";

export const MAX_MANUSCRIPT_CONVERSATION_TURNS = 8;

export function tagManuscriptConversationMentions(
  text: string,
  cast: ManuscriptCharacter[]
): string {
  return tagMentions(text, cast.map((character) => character.name));
}

/** Explicit author mentions bypass the orchestrator, exactly as they do in normal chats. */
export function addressedManuscriptCharacters(
  text: string,
  cast: ManuscriptCharacter[],
  exceptId?: string
): ManuscriptCharacter[] {
  const mentions = parseMentions(text);
  if (mentions.all) return cast.filter((character) => character.id !== exceptId);
  const addressed: ManuscriptCharacter[] = [];
  for (const name of mentions.names) {
    const character = cast.find(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
    );
    if (character && character.id !== exceptId && !addressed.includes(character)) {
      addressed.push(character);
    }
  }
  return addressed;
}

export function manuscriptConversationTranscript(
  messages: ManuscriptConversationMessage[],
  cast: ManuscriptCharacter[],
  limit = 12
): string {
  return messages.slice(-limit).map((message) => {
    const speaker = message.role === "user"
      ? "Author"
      : cast.find((character) => character.id === message.characterId)?.name ?? "Unknown character";
    return `${speaker}: ${mentionsToPlain(message.content)}`;
  }).join("\n");
}

export function buildManuscriptOrchestratorRequest(
  messages: ManuscriptConversationMessage[],
  cast: ManuscriptCharacter[]
): { system: string; messages: LlmMessage[] } {
  const candidates = cast.map((character) => `"${character.id}" = ${character.name}`).join("\n");
  return {
    system:
      `You direct a private group conversation between a manuscript's author and its embedded characters. ` +
      `Given the recent transcript, decide which one character should respond next.\n` +
      `Candidates:\n${candidates}\n` +
      `Prefer the character who was directly addressed or has the most natural, useful reaction. ` +
      `Respond with ONLY a JSON object: {"next":"<candidate id>"}`,
    messages: [{
      role: "user",
      content: `Transcript:\n${manuscriptConversationTranscript(messages, cast)}\n\nWho responds next?`,
    }],
  };
}

function historyForCharacter(
  messages: ManuscriptConversationMessage[],
  cast: ManuscriptCharacter[],
  speaker: ManuscriptCharacter
): LlmMessage[] {
  const history: LlmMessage[] = [];
  const push = (role: LlmMessage["role"], content: string) => {
    if (!content.trim()) return;
    const previous = history.at(-1);
    if (previous?.role === role) previous.content += `\n\n${content}`;
    else history.push({ role, content });
  };

  for (const message of messages) {
    if (message.role === "character" && message.characterId === speaker.id) {
      push("assistant", message.content);
      continue;
    }
    const name = message.role === "user"
      ? "Author"
      : cast.find((character) => character.id === message.characterId)?.name ?? "Unknown character";
    push("user", `${name}: ${mentionsToPlain(message.content)}`);
  }
  if (!history.length || history[0].role === "assistant") {
    history.unshift({ role: "user", content: "[The conversation begins.]" });
  }
  if (history.at(-1)?.role === "assistant") {
    history.push({ role: "user", content: "[Continue.]" });
  }
  return history;
}

export function buildManuscriptCharacterRequest(
  projectContext: unknown,
  messages: ManuscriptConversationMessage[],
  cast: ManuscriptCharacter[],
  speaker: ManuscriptCharacter,
  language: string
): { system: string; messages: LlmMessage[] } {
  const others = cast.filter((character) => character.id !== speaker.id);
  const sheet = {
    name: speaker.name,
    description: speaker.description,
    personality: speaker.personality,
    appearance: speaker.appearance,
    voice: speaker.voice,
  };
  const system = [
    `You are ${speaker.name}, an embedded character in a private conversation with the author writing your manuscript. Stay in character at all times and write in ${language}.`,
    `MANUSCRIPT CONTEXT:\n${JSON.stringify(projectContext, null, 2)}`,
    `YOUR CHARACTER SHEET:\n${JSON.stringify(sheet, null, 2)}`,
    others.length
      ? `OTHER CHARACTERS IN THIS CONVERSATION:\n${JSON.stringify(others, null, 2)}`
      : "",
    `RULES:\n` +
      `The user is the author, not an in-story persona. Respond to them directly as ${speaker.name}.\n` +
      `Write only ${speaker.name}'s own reply. Never write the author's words, actions, or decisions, and never speak for another character.\n` +
      `Use the character's established voice and knowledge. Treat the character sheet as background guidance, not something to recite.\n` +
      (others.length
        ? `You may hand the conversation to another character by addressing them with the literal tag <mention>Their Exact Name</mention>. Use it only when a handoff is natural; a plain name does not pass the turn.\n`
        : "") +
      `Return only the reply itself, without a speaker-name prefix or commentary.`,
  ].filter(Boolean).join("\n\n");

  return {
    system,
    messages: historyForCharacter(messages, cast, speaker),
  };
}
