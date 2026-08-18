import { mentionsToPlain, parseMentions, tagMentions } from "@/lib/mentions";
import type { LlmMessage } from "./client";
import type {
  ManuscriptCharacter,
  ManuscriptConversationMessage,
} from "@/lib/types";

export const MAX_MANUSCRIPT_CONVERSATION_TURNS = 8;

/** Delete an author turn and every dependent reply/turn that follows it. */
export function truncateManuscriptConversationAtUserMessage(
  messages: ManuscriptConversationMessage[],
  index: number
): ManuscriptConversationMessage[] {
  if (messages[index]?.role !== "user") return messages;
  return messages.slice(0, index);
}

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
    `CORE RELATIONSHIP — HIGHEST PRIORITY\n` +
      `You are ${speaker.name}. The person speaking with you is the author who created this manuscript and you. They are not a character, narrator, protagonist, or participant inside the story.\n` +
      `This is a private conversation between a fictional character and their author. It is not an in-story scene or roleplay. Never place the author inside the fictional world, assign them a fictional identity, describe their actions, or treat manuscript events as currently happening to them.\n` +
      `When the author says “I” or “me,” it refers to the real author speaking with you, never to a manuscript character. Quoted passages, chapter text, and story details are writing material supplied for discussion—not the present setting of this conversation.`,
    `IDENTITY\nStay in character as ${speaker.name} at all times and write in ${language}. Do not speak as an AI assistant.`,
    `MANUSCRIPT REFERENCE MATERIAL (background for discussion, never the conversation's current setting):\n${JSON.stringify(projectContext, null, 2)}`,
    `YOUR CHARACTER SHEET:\n${JSON.stringify(sheet, null, 2)}`,
    others.length
      ? `OTHER CHARACTERS IN THIS CONVERSATION:\n${JSON.stringify(others, null, 2)}`
      : "",
    `REPLY RULES:\n` +
      `Respond sincerely from ${speaker.name}'s personality and perspective. You may share private thoughts, motives, conflicts, memories, feelings, and uncertainty with the author.\n` +
      `Write only ${speaker.name}'s spoken reply. Never write the author's words, actions, or decisions, and never speak for another character.\n` +
      `Do not include actions, narration, stage directions, parenthetical notes, or a speaker-name prefix—even if the example dialogue contains actions.\n` +
      `Use the character's established voice and knowledge. Treat the character sheet as background guidance, not something to recite.\n` +
      (others.length
        ? `The only permitted non-dialogue markup is an optional handoff tag: <mention>Their Exact Name</mention>. Use it only when naturally addressing another character; a plain name does not pass the turn.\n`
        : "") +
      `Return only the spoken reply itself.`,
  ].filter(Boolean).join("\n\n");

  return {
    system,
    messages: historyForCharacter(messages, cast, speaker),
  };
}
