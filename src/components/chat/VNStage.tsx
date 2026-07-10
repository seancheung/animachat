"use client";

import { assetUrl, cls } from "@/lib/ui";
import type { Character } from "@/lib/types";

export interface StageEmotions {
  /** characterId -> current emotion name */
  [characterId: string]: string;
}

export function resolveSprite(char: Character, emotion: string | null): string | null {
  const e = (emotion ?? "neutral").toLowerCase();
  return assetUrl(char.sprites[e] ?? char.sprites["neutral"] ?? null);
}

export function VNStage({
  characters,
  emotions,
  speakingId,
  backgroundUrl,
  tall,
}: {
  characters: Character[];
  emotions: StageEmotions;
  speakingId: string | null;
  backgroundUrl: string | null;
  tall?: boolean;
}) {
  return (
    <div className={cls("relative overflow-hidden shrink-0 select-none", tall ? "h-full" : "h-64 md:h-80")}>
      {backgroundUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={backgroundUrl} src={backgroundUrl} alt="" className="bg-art absolute inset-0 w-full h-full object-cover fade-in" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#241f38] to-[var(--bg)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      <div className="absolute inset-x-0 bottom-0 top-4 flex items-end justify-center gap-[2%] px-4">
        {characters.map((c) => {
          const sprite = resolveSprite(c, emotions[c.id] ?? null);
          const speaking = speakingId === null || speakingId === c.id;
          return (
            <div
              key={c.id}
              className={cls("sprite h-full max-w-[45%] flex items-end justify-center", speaking ? "sprite-idle" : "sprite-dim")}
              style={{ aspectRatio: "2/3" }}
              title={`${c.name}${emotions[c.id] ? ` (${emotions[c.id]})` : ""}`}
            >
              {sprite ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={sprite} src={sprite} alt={c.name} className="sprite-img h-full w-full object-cover object-top fade-in" />
              ) : (
                <div
                  className="h-[92%] w-full"
                  style={{
                    WebkitMaskImage: "url(/defaults/sprite-placeholder.svg)",
                    maskImage: "url(/defaults/sprite-placeholder.svg)",
                    WebkitMaskRepeat: "no-repeat",
                    maskRepeat: "no-repeat",
                    WebkitMaskPosition: "bottom center",
                    maskPosition: "bottom center",
                    WebkitMaskSize: "contain",
                    maskSize: "contain",
                    backgroundColor: "var(--text-dim)",
                    opacity: 0.55,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
