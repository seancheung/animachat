import { describe, expect, it } from "vitest";
import {
  addressedManuscriptCharacters,
  buildManuscriptCharacterRequest,
  buildManuscriptOrchestratorRequest,
  tagManuscriptConversationMentions,
  truncateManuscriptConversationAtUserMessage,
} from "./manuscriptConversation";
import type { ManuscriptCharacter, ManuscriptConversationMessage } from "@/lib/types";

const cast: ManuscriptCharacter[] = [
  { id: "mira", name: "Mira", description: "Alchemist", personality: "Guarded", appearance: "Apron", voice: "Dry" },
  { id: "kael", name: "Kael", description: "Collector", personality: "Patient", appearance: "Coat", voice: "Measured" },
];

const userMessage = (content: string): ManuscriptConversationMessage => ({
  role: "user",
  characterId: null,
  content,
  createdAt: 1,
});

describe("manuscript conversation routing", () => {
  it("deletes an author message and every message after it", () => {
    const messages: ManuscriptConversationMessage[] = [
      userMessage("First"),
      { role: "character", characterId: "mira", content: "First reply", createdAt: 2 },
      { ...userMessage("Second"), createdAt: 3 },
      { role: "character", characterId: "kael", content: "Second reply", createdAt: 4 },
    ];
    expect(truncateManuscriptConversationAtUserMessage(messages, 2)).toEqual(messages.slice(0, 2));
    expect(truncateManuscriptConversationAtUserMessage(messages, 1)).toBe(messages);
  });

  it("routes exact author mentions without the orchestrator", () => {
    const tagged = tagManuscriptConversationMentions("Ask @Kael, then @Mira", cast);
    expect(addressedManuscriptCharacters(tagged, cast).map((character) => character.id))
      .toEqual(["kael", "mira"]);
  });

  it("routes @all in fixed cast order", () => {
    const tagged = tagManuscriptConversationMentions("@all What do you think?", cast);
    expect(addressedManuscriptCharacters(tagged, cast).map((character) => character.id))
      .toEqual(["mira", "kael"]);
  });

  it("gives the orchestrator candidate ids and an author-labelled transcript", () => {
    const request = buildManuscriptOrchestratorRequest([userMessage("Who should answer?")], cast);
    expect(request.system).toContain('"mira" = Mira');
    expect(request.messages[0].content).toContain("Author: Who should answer?");
  });

  it("builds each character history from that character's own seat", () => {
    const messages: ManuscriptConversationMessage[] = [
      userMessage("Hello"),
      { role: "character", characterId: "mira", content: "Welcome.", createdAt: 2 },
      { role: "character", characterId: "kael", content: "Careful.", createdAt: 3 },
    ];
    const request = buildManuscriptCharacterRequest({ title: "Debt" }, messages, cast, cast[0], "English");
    expect(request.system).toContain("CORE RELATIONSHIP — HIGHEST PRIORITY");
    expect(request.system).toContain("It is not an in-story scene or roleplay");
    expect(request.system).toContain("When the author says “I” or “me,”");
    expect(request.system).toContain("never the conversation's current setting");
    expect(request.system).toContain("Do not include actions, narration, stage directions");
    expect(request.system.indexOf("CORE RELATIONSHIP")).toBeLessThan(
      request.system.indexOf("MANUSCRIPT REFERENCE MATERIAL")
    );
    expect(request.messages).toEqual([
      { role: "user", content: "Author: Hello" },
      { role: "assistant", content: "Welcome." },
      { role: "user", content: "Kael: Careful." },
    ]);
  });
});
