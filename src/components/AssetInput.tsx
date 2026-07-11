"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import Button from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { assetUrl, uploadFile } from "@/lib/ui";
import { cn } from "@/utils/cn";

/**
 * Image upload (2:3 sprites, 1:1 avatars, 16:9 artwork — `ratio` = width/height
 * sizes the tile; other ratios display cover-fit) or audio upload with preview.
 * The whole tile is clickable to upload/replace.
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

  async function handleFile(file: File) {
    setBusy(true);
    try {
      onChange(await uploadFile(file));
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
          "cursor-pointer transition-colors hover:border-primary-500/60",
          kind === "image" ? "flex items-center justify-center" : "p-2"
        )}
        style={kind === "image" ? { aspectRatio: `${ratio ?? 1}` } : undefined}
        title={value ? `Click to replace ${kind}` : `Click to upload ${kind}`}
        onClick={() => !busy && fileRef.current?.click()}
      >
        {kind === "image" ? (
          value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assetUrl(value)!} alt="" className="w-full h-full object-cover" />
          ) : (
            <Plus size={20} className="text-content-400" />
          )
        ) : value ? (
          <audio controls src={assetUrl(value)!} className="w-full h-8" onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="flex justify-center"><Plus size={20} className="text-content-400" /></span>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-black/50 text-xs text-white">
            uploading…
          </span>
        )}
        {value && (
          <Button
            type="button"
            variant="danger"
            size="sm"
            shape="square"
            title="Remove"
            className="absolute top-1 right-1 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            <X />
          </Button>
        )}
      </div>
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
