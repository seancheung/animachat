"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import Button from "@/components/ui/button";
import Checkbox from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import { assetUrl, cropToRatio, uploadFile } from "@/lib/ui";
import { cn } from "@/utils/cn";

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
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <div className="text-xs uppercase tracking-wider text-content-300">{label}</div>
      )}
      <div
        className={cn(
          "relative border border-dashed border-base-400 rounded-md overflow-hidden bg-base-200 group",
          kind === "image" ? "flex items-center justify-center" : "p-2"
        )}
        style={kind === "image" ? { aspectRatio: `${ratio ?? 1}` } : undefined}
      >
        {kind === "image" ? (
          value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(value)!} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-content-400 text-xs">no image</span>
          )
        ) : value ? (
          <audio controls src={assetUrl(value)!} className="w-full h-8" />
        ) : (
          <span className="text-content-400 text-xs">no audio</span>
        )}
        <div className="absolute inset-x-0 bottom-0 flex gap-1 justify-center p-1 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "…" : value ? "Replace" : "Upload"}
          </Button>
          {value && (
            <Button type="button" variant="danger" size="sm" shape="square" onClick={() => onChange(null)}>
              <X />
            </Button>
          )}
        </div>
      </div>
      {kind === "image" && ratio && (
        <Checkbox
          className="text-xs text-content-300"
          value={crop}
          onChange={setCrop}
          label="crop to ratio on upload"
        />
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
