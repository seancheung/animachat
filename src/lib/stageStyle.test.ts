import { describe, expect, it } from "vitest";
import { readableOn, stagePanelBackground, stageStyleVars } from "./stageStyle";

describe("readableOn", () => {
  it("returns dark text for light backgrounds and light text for dark ones", () => {
    expect(readableOn("#E8DCC8")).toBe("#211d29");
    expect(readableOn("#1d3325")).toBe("#f1eef7");
  });

  it("returns null for anything that isn't #rrggbb", () => {
    expect(readableOn("red")).toBeNull();
    expect(readableOn("#fff")).toBeNull();
  });
});

describe("stageStyleVars", () => {
  it("returns nothing for an empty style", () => {
    expect(stageStyleVars({})).toEqual({});
  });

  it("bubble text follows messageFg, muted variant included", () => {
    const v = stageStyleVars({ messageBg: "#E8DCC8", messageFg: "#2d241f" });
    expect(v["--bubble-text"]).toBe("#2d241f");
    expect(v["--bubble-text-muted"]).toContain("#2d241f");
  });

  it("bubble text auto-contrasts with messageBg when messageFg is unset", () => {
    expect(stageStyleVars({ messageBg: "#E8DCC8" })["--bubble-text"]).toBe("#211d29");
    expect(stageStyleVars({ messageBg: "#1d3325" })["--bubble-text"]).toBe("#f1eef7");
  });

  it("panel text auto-contrasts with the panel tint when unset", () => {
    const v = stageStyleVars({ panelBg: "#3A2E28" });
    expect(v.color).toBe("#f1eef7"); // light text on a dark tint
    expect(v["--color-content-100"]).toBe("#f1eef7");
    expect(v["--color-base-400"]).toContain("#f1eef7");
    expect(stageStyleVars({ panelBg: "#e8e2d5" }).color).toBe("#211d29");
  });

  it("panelFg drives the chrome ladder but never the bubble text", () => {
    const v = stageStyleVars({ panelFg: "#fcfcfc" });
    expect(v.color).toBe("#fcfcfc");
    expect(v["--color-content-100"]).toBe("#fcfcfc");
    expect(v["--color-content-300"]).toContain("#fcfcfc");
    expect(v["--bubble-text"]).toBeUndefined();
  });

  it("input/badge/border surfaces derive from the panel tint, not the bubble tint", () => {
    const v = stageStyleVars({ panelBg: "#3A2E28", messageBg: "#E8DCC8", panelFg: "#fcfcfc" });
    expect(v["--color-base-100"]).toContain("#3A2E28");
    expect(v["--color-base-400"]).toContain("#3A2E28");
    expect(v["--color-base-100"]).not.toContain("#E8DCC8");
    // the bubble tint only feeds the bubble surfaces
    expect(v["--bubble-bg"]).toContain("#E8DCC8");
    expect(v["--bubble-bg-solid"]).toContain("#E8DCC8");
  });

  it("without a panel tint, chips/borders derive as translucent tints of the panel text", () => {
    const v = stageStyleVars({ panelFg: "#fcfcfc" });
    expect(v["--color-base-400"]).toBe("color-mix(in srgb, #fcfcfc 22%, transparent)");
    expect(v["--color-base-300"]).toBe("color-mix(in srgb, #fcfcfc 12%, transparent)");
    // inputs keep the theme surface — only the chip/hover tiers lift from the text
    expect(v["--color-base-100"]).toBeUndefined();
  });

  it("accent produces the primary ladder with hover/active shades and contrasting on-accent text", () => {
    const v = stageStyleVars({ accent: "#D4A84B" });
    expect(v["--color-primary-500"]).toBe("#D4A84B");
    expect(v["--color-primary-400"]).toContain("white");
    expect(v["--color-primary-600"]).toContain("black");
    expect(v["--color-primary-content"]).toBe("#211d29"); // dark text on a light gold accent
    expect(stageStyleVars({ accent: "#3b2a66" })["--color-primary-content"]).toBe("#f1eef7");
  });
});

describe("decorative accent fallbacks", () => {
  it("keeps the accent where it's readable, falls back to family text where it isn't", () => {
    // gold on cream: unreadable -> the bubble's own ink; gold on near-black: keep the accent
    const cream = stageStyleVars({ accent: "#D4A84B", messageBg: "#E8DCC8", messageFg: "#2d241f" });
    expect(cream["--accent-on-bubble"]).toBe("#2d241f");
    const dark = stageStyleVars({ accent: "#D4A84B", messageBg: "#141210" });
    expect(dark["--accent-on-bubble"]).toBe("#D4A84B");
  });

  it("checks the accent against the derived chip color for avatar initials", () => {
    // light chip (light panel + auto dark text mixed in) vs gold accent -> fall back to panel text
    const v = stageStyleVars({ accent: "#D4A84B", panelBg: "#e8e2d5" });
    expect(v["--accent-on-chip"]).toBe("#211d29");
  });

  it("sets nothing when the family colors aren't specified", () => {
    const v = stageStyleVars({ accent: "#D4A84B" });
    expect(v["--accent-on-bubble"]).toBeUndefined();
    expect(v["--accent-on-chip"]).toBeUndefined();
  });
});

describe("stagePanelBackground", () => {
  it("mixes the tint at the given opacity", () => {
    expect(stagePanelBackground({ panelBg: "#3A2E28", panelOpacity: 0.85 })).toBe(
      "color-mix(in srgb, #3A2E28 85%, transparent)"
    );
  });

  it("uses the theme surface when only opacity is set, and null when neither is", () => {
    expect(stagePanelBackground({ panelOpacity: 0.6 })).toContain("var(--color-base-200)");
    expect(stagePanelBackground({})).toBeNull();
  });
});
