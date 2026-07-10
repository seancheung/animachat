"use client";

import { useRef, useState } from "react";
import { assetUrl, cls, cropToRatio, uploadFile } from "@/lib/ui";

/**
 * Image upload with crop-to-ratio (2:3 sprites, 1:1 avatars, 16:9 artwork),
 * or audio upload with preview. `ratio` = width/height; omit for audio.
 */
export function AssetInput({
  value,
  onChange,
  kind,
  ratio,
  label,
  className,
}: {
  value: string | null;
  onChange: (assetId: string | null) => void;
  kind: "image" | "audio";
  ratio?: number;
  label?: string;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [crop, setCrop] = useState(true);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      let blob: Blob = file;
      if (kind === "image" && ratio && crop) {
        try {
          blob = await cropToRatio(file, ratio);
        } catch {
          blob = file; // e.g. SVG — keep original
        }
      }
      const named = new File([blob], file.name, { type: blob.type || file.type });
      onChange(await uploadFile(named));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cls("space-y-1", className)}>
      {label && (
        <div className="text-xs uppercase tracking-wider text-[var(--text-dim)]">{label}</div>
      )}
      <div
        className={cls(
          "relative border border-dashed border-[var(--border)] rounded-lg overflow-hidden bg-[var(--bg-soft)] group",
          kind === "image" ? "flex items-center justify-center" : "p-2"
        )}
        style={kind === "image" ? { aspectRatio: `${ratio ?? 1}` } : undefined}
      >
        {kind === "image" ? (
          value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(value)!} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[var(--text-dim)] text-xs">no image</span>
          )
        ) : value ? (
          <audio controls src={assetUrl(value)!} className="w-full h-8" />
        ) : (
          <span className="text-[var(--text-dim)] text-xs">no audio</span>
        )}
        <div className="absolute inset-x-0 bottom-0 flex gap-1 justify-center p-1 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "…" : value ? "Replace" : "Upload"}
          </button>
          {value && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => onChange(null)}>
              ✕
            </button>
          )}
        </div>
      </div>
      {kind === "image" && ratio && (
        <label className="flex items-center gap-1 text-xs text-[var(--text-dim)] cursor-pointer">
          <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} />
          crop to ratio on upload
        </label>
      )}
      <input
        ref={fileRef}
        type="file"
        hidden
        accept={kind === "image" ? "image/*" : "audio/*"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
