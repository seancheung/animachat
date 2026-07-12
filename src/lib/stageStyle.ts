import type { StageStyle } from "@/lib/types";

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? ([0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number]) : null;
}

/** Pick a readable near-black/near-white text color for a solid #rrggbb background. */
export function readableOn(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#211d29" : "#f1eef7";
}

/** WCAG contrast ratio between two #rrggbb colors (1..21), or null if either fails to parse. */
export function contrastRatio(a: string, b: string): number | null {
  const rel = (hex: string) => {
    const rgb = parseHex(hex);
    if (!rgb) return null;
    const lin = rgb.map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const la = rel(a);
  const lb = rel(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mix two #rrggbb colors (weight = share of `b`). */
function mixHex(a: string, b: string, weight: number): string | null {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return null;
  return (
    "#" +
    pa.map((x, i) => Math.round(x * (1 - weight) + pb[i] * weight).toString(16).padStart(2, "0")).join("")
  );
}

/** The accent when readable (WCAG ≥ 3) on `bg`, otherwise the family's own text color. */
function accentOn(accent: string, bg: string, familyText: string | null): string | null {
  const ratio = contrastRatio(accent, bg);
  if (ratio === null) return null;
  return ratio >= 3 ? accent : familyText;
}

/** The floating panel's background: its tint (style's panelBg or the theme surface)
 *  at the system panel-opacity setting. Styles supply color only, never opacity. */
export function stagePanelBackground(panelBg: string | null | undefined, opacity: number): string {
  const pct = Math.round(opacity * 100);
  return `color-mix(in srgb, ${panelBg ?? "var(--color-base-200)"} ${pct}%, transparent)`;
}

/**
 * CSS overrides for a chat styled by the active scene/location. Each surface pairs its
 * own text with its own background, so one color never bleeds into another surface:
 *
 *  - panel (panelBg + panelFg): chrome text ladder (content-100..400) and the
 *    input/button/badge/border surfaces (base-100/300/400) all derive from the PANEL pair
 *  - bubbles (messageBg + messageFg): --bubble-color and --bubble-text(/-muted),
 *    consumed only by .msg-bubble surfaces (character bubbles, VN dialogue box) —
 *    bubbles render the tint solid; the VN dialogue box mixes it with the
 *    chat-panel-opacity system setting; messageFg auto-contrasts when unset
 *  - chips (badges, avatar circles, borders) reuse the panel pair: lifted from
 *    panelBg when set, otherwise translucent tints of panelFg
 *  - accent (+ accentFg): the primary ladder (500 plus hover/active shades) and its text
 */
export function stageStyleVars(style: StageStyle): Record<string, string> {
  const vars: Record<string, string> = {};
  // panelFg auto-contrasts with panelBg when not explicitly set, so the theme's
  // text color never lands on a custom tint it wasn't chosen for
  const chrome = style.panelFg ?? (style.panelBg ? readableOn(style.panelBg) : null);

  if (style.accent) {
    vars["--color-primary-500"] = style.accent;
    vars["--color-primary-400"] = `color-mix(in srgb, ${style.accent} 80%, white)`;
    vars["--color-primary-600"] = `color-mix(in srgb, ${style.accent} 80%, black)`;
    // text on accent surfaces (e.g. the Send button) must contrast with the accent itself
    const onAccent = style.accentFg ?? readableOn(style.accent);
    if (onAccent) vars["--color-primary-content"] = onAccent;
  }

  if (style.panelBg && chrome) {
    vars["--color-base-100"] = `color-mix(in srgb, ${style.panelBg} 92%, ${chrome})`;
    vars["--color-base-300"] = `color-mix(in srgb, ${style.panelBg} 82%, ${chrome})`;
    vars["--color-base-400"] = `color-mix(in srgb, ${style.panelBg} 68%, ${chrome})`;
  } else if (chrome) {
    // no panel tint to lift surfaces from — derive chips/hovers/borders (badges, avatar
    // circles, dividers) as translucent tints of the panel text so they can't clash
    vars["--color-base-300"] = `color-mix(in srgb, ${chrome} 12%, transparent)`;
    vars["--color-base-400"] = `color-mix(in srgb, ${chrome} 22%, transparent)`;
  }

  if (chrome) {
    vars.color = chrome;
    vars["--color-content-100"] = chrome;
    vars["--color-content-200"] = `color-mix(in srgb, ${chrome} 85%, transparent)`;
    vars["--color-content-300"] = `color-mix(in srgb, ${chrome} 65%, transparent)`;
    vars["--color-content-400"] = `color-mix(in srgb, ${chrome} 45%, transparent)`;
  }

  if (style.messageBg) {
    vars["--bubble-color"] = style.messageBg;
  }
  const bubbleText = style.messageFg ?? (style.messageBg ? readableOn(style.messageBg) : null);
  if (bubbleText) {
    // the same three-step ladder the theme uses: dialogue full, narration soft, actions muted
    vars["--bubble-text"] = bubbleText;
    vars["--bubble-text-soft"] = `color-mix(in srgb, ${bubbleText} 85%, transparent)`;
    vars["--bubble-text-muted"] = `color-mix(in srgb, ${bubbleText} 70%, transparent)`;
  }

  // decorative accent text (VN speaker names, caret, avatar initials) falls back to the
  // backing family's text color when the accent isn't readable on that family
  if (style.accent) {
    if (style.messageBg) {
      const onBubble = accentOn(style.accent, style.messageBg, bubbleText);
      if (onBubble) vars["--accent-on-bubble"] = onBubble;
    }
    if (style.panelBg && chrome) {
      const chipBg = mixHex(style.panelBg, chrome, 0.32);
      const onChip = chipBg ? accentOn(style.accent, chipBg, chrome) : null;
      if (onChip) vars["--accent-on-chip"] = onChip;
    }
  }

  return vars;
}
