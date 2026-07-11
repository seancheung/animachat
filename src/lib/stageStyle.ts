import type { StageStyle } from "@/lib/types";

/** Pick a readable near-black/near-white text color for a solid #rrggbb background. */
export function readableOn(hex: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#211d29" : "#f1eef7";
}

/** The floating panel's own background (tint at opacity), or null when the style doesn't set it. */
export function stagePanelBackground(style: StageStyle): string | null {
  if (!style.panelTint && style.panelOpacity == null) return null;
  const pct = Math.round((style.panelOpacity ?? 0.45) * 100);
  return `color-mix(in srgb, ${style.panelTint ?? "var(--color-base-200)"} ${pct}%, transparent)`;
}

/**
 * CSS overrides for a chat styled by the active scene/location. Each surface pairs its
 * own text with its own background, so one color never bleeds into another surface:
 *
 *  - panel (panelTint + panelTextColor): chrome text ladder (content-100..400) and the
 *    input/button/badge/border surfaces (base-100/300/400) all derive from the PANEL colors
 *  - bubbles (messageTint + textColor): --bubble-bg(/-solid) and --bubble-text(/-muted),
 *    consumed only by .msg-bubble surfaces (character bubbles, VN dialogue box);
 *    bubble text auto-contrasts with messageTint when textColor is unset
 *  - accent: the primary ladder (500 plus hover/active shades)
 */
export function stageStyleVars(style: StageStyle): Record<string, string> {
  const vars: Record<string, string> = {};
  const chrome = style.panelTextColor ?? null;

  if (style.accent) {
    vars["--color-primary-500"] = style.accent;
    vars["--color-primary-400"] = `color-mix(in srgb, ${style.accent} 80%, white)`;
    vars["--color-primary-600"] = `color-mix(in srgb, ${style.accent} 80%, black)`;
    // text on accent surfaces (e.g. the Send button) must contrast with the accent itself
    const onAccent = readableOn(style.accent);
    if (onAccent) vars["--color-primary-content"] = onAccent;
  }

  if (style.panelTint) {
    const text = chrome ?? "var(--color-content-100)";
    vars["--color-base-100"] = `color-mix(in srgb, ${style.panelTint} 92%, ${text})`;
    vars["--color-base-300"] = `color-mix(in srgb, ${style.panelTint} 82%, ${text})`;
    vars["--color-base-400"] = `color-mix(in srgb, ${style.panelTint} 68%, ${text})`;
  }

  if (chrome) {
    vars.color = chrome;
    vars["--color-content-100"] = chrome;
    vars["--color-content-200"] = `color-mix(in srgb, ${chrome} 85%, transparent)`;
    vars["--color-content-300"] = `color-mix(in srgb, ${chrome} 65%, transparent)`;
    vars["--color-content-400"] = `color-mix(in srgb, ${chrome} 45%, transparent)`;
  }

  if (style.messageTint) {
    vars["--bubble-bg"] = `color-mix(in srgb, ${style.messageTint} 85%, transparent)`;
    vars["--bubble-bg-solid"] = `color-mix(in srgb, ${style.messageTint} 94%, transparent)`;
  }
  const bubbleText = style.textColor ?? (style.messageTint ? readableOn(style.messageTint) : null);
  if (bubbleText) {
    vars["--bubble-text"] = bubbleText;
    vars["--bubble-text-muted"] = `color-mix(in srgb, ${bubbleText} 70%, transparent)`;
  }

  return vars;
}
