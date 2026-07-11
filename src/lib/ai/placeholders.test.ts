import { describe, expect, it } from "vitest";
import { substitutePlaceholders } from "./placeholders";

const values = {
  characterNames: ["Mira", "Kael"],
  userName: "Traveler",
  locationName: "The Moonlit Tavern",
  sceneName: "A Notice on the Door",
  storyName: "The Alchemist's Debt",
};

describe("substitutePlaceholders", () => {
  it("replaces the core tags", () => {
    expect(
      substitutePlaceholders("[char_name] meets [user_name] at [loc_name] during [scene_name] of [story_name]", values)
    ).toBe("Mira meets Traveler at The Moonlit Tavern during A Notice on the Door of The Alchemist's Debt");
  });

  it("resolves indexed character names, 1-based", () => {
    expect(substitutePlaceholders("[char1_name] and [char2_name]", values)).toBe("Mira and Kael");
  });

  it("binds [char_name] to selfName when substituting a character's own sheet", () => {
    expect(substitutePlaceholders("[char_name] polishes his sword", { ...values, selfName: "Kael" })).toBe(
      "Kael polishes his sword"
    );
    // indexed tags stay positional even with a self binding
    expect(substitutePlaceholders("[char1_name] and [char2_name]", { ...values, selfName: "Kael" })).toBe(
      "Mira and Kael"
    );
    // without a self binding, [char_name] falls back to the first character
    expect(substitutePlaceholders("[char_name]", values)).toBe("Mira");
  });

  it("treats persona_name as an alias of user_name", () => {
    expect(substitutePlaceholders("[persona_name]", values)).toBe("Traveler");
  });

  it("is case-insensitive", () => {
    expect(substitutePlaceholders("[Char_Name] / [USER_NAME]", values)).toBe("Mira / Traveler");
  });

  it("uses neutral fallbacks for unresolvable tags", () => {
    expect(substitutePlaceholders("[char3_name]", values)).toBe("another character");
    expect(substitutePlaceholders("[loc_name]", { characterNames: [] })).toBe("the current place");
    expect(substitutePlaceholders("[scene_name]", { characterNames: [] })).toBe("the current scene");
    expect(substitutePlaceholders("[story_name]", { characterNames: [] })).toBe("the story");
    expect(substitutePlaceholders("[user_name]", { characterNames: [] })).toBe("the user");
  });

  it("leaves unknown bracketed text alone", () => {
    expect(substitutePlaceholders("[something_else] stays", values)).toBe("[something_else] stays");
    expect(substitutePlaceholders("[char_2_name] is no longer a tag", values)).toBe("[char_2_name] is no longer a tag");
  });

  it("returns text without brackets untouched", () => {
    expect(substitutePlaceholders("no tags here", values)).toBe("no tags here");
  });
});
