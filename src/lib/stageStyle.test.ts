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

  it("bubble text follows textColor, muted variant included", () => {
    const v = stageStyleVars({ messageTint: "#E8DCC8", textColor: "#2d241f" });
    expect(v["--bubble-text"]).toBe("#2d241f");
    expect(v["--bubble-text-muted"]).toContain("#2d241f");
  });

  it("bubble text auto-contrasts with messageTint when textColor is unset", () => {
    expect(stageStyleVars({ messageTint: "#E8DCC8" })["--bubble-text"]).toBe("#211d29");
    expect(stageStyleVars({ messageTint: "#1d3325" })["--bubble-text"]).toBe("#f1eef7");
  });

  it("panelTextColor drives the chrome ladder but never the bubble text", () => {
    const v = stageStyleVars({ panelTextColor: "#fcfcfc" });
    expect(v.color).toBe("#fcfcfc");
    expect(v["--color-content-100"]).toBe("#fcfcfc");
    expect(v["--color-content-300"]).toContain("#fcfcfc");
    expect(v["--bubble-text"]).toBeUndefined();
  });

  it("input/badge/border surfaces derive from the panel tint, not the bubble tint", () => {
    const v = stageStyleVars({ panelTint: "#3A2E28", messageTint: "#E8DCC8", panelTextColor: "#fcfcfc" });
    expect(v["--color-base-100"]).toContain("#3A2E28");
    expect(v["--color-base-400"]).toContain("#3A2E28");
    expect(v["--color-base-100"]).not.toContain("#E8DCC8");
    // the bubble tint only feeds the bubble surfaces
    expect(v["--bubble-bg"]).toContain("#E8DCC8");
    expect(v["--bubble-bg-solid"]).toContain("#E8DCC8");
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

describe("stagePanelBackground", () => {
  it("mixes the tint at the given opacity", () => {
    expect(stagePanelBackground({ panelTint: "#3A2E28", panelOpacity: 0.85 })).toBe(
      "color-mix(in srgb, #3A2E28 85%, transparent)"
    );
  });

  it("uses the theme surface when only opacity is set, and null when neither is", () => {
    expect(stagePanelBackground({ panelOpacity: 0.6 })).toContain("var(--color-base-200)");
    expect(stagePanelBackground({})).toBeNull();
  });
});
