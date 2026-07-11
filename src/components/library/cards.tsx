"use client";

import type { ComponentType, ReactNode } from "react";
import {
  BookOpen,
  Download,
  LibraryBig,
  Mountain,
  Trash2,
  UserRound,
  VenetianMask,
} from "lucide-react";
import { mutate } from "swr";
import { confirmDialog } from "@/components/confirm";
import Button from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api, assetUrl } from "@/lib/ui";
import { cn } from "@/utils/cn";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface LibraryCardProps {
  item: any;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function CardShell({
  item,
  onOpen,
  onExport,
  onDelete,
  cover,
  coverAspect = "video",
  sub,
  extraActions,
}: LibraryCardProps & {
  cover: ReactNode;
  coverAspect?: "square" | "video";
  sub: string;
  extraActions?: ReactNode;
}) {
  return (
    <div
      className="panel overflow-hidden cursor-pointer hover:border-primary-500 transition-colors relative"
      onClick={onOpen}
    >
      <div
        className={cn(
          "w-full flex items-center justify-center text-content-300 bg-base-200 overflow-hidden",
          coverAspect === "square" ? "aspect-square" : "aspect-video"
        )}
      >
        {cover}
      </div>
      <div className="p-2.5">
        <div className="font-medium text-sm truncate">{item.name}</div>
        <div className="text-xs text-content-300 line-clamp-2 h-8">{sub}</div>
        <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
          {extraActions}
          <Button variant="ghost" size="sm" shape="square" title="Export" onClick={onExport}>
            <Download />
          </Button>
          <Button variant="ghost" size="sm" shape="square" title="Delete" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CoverImage({ src, top }: { src: string; top?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={cn("w-full h-full object-cover", top && "object-top")} />;
}

export function CharacterCard(props: LibraryCardProps) {
  const avatar = assetUrl(props.item.avatarAsset);
  const neutral = assetUrl(props.item.sprites?.neutral);
  const createPersona = async () => {
    if (
      !(await confirmDialog({
        title: "Create persona",
        message: `Create a new persona from "${props.item.name}"? Its name and description are copied as a snapshot — later edits to the character won't carry over.`,
        confirmLabel: "Create",
      }))
    )
      return;
    try {
      // in a persona sheet the self-tag is [user_name]; a positional [char_name] would be wrong
      const description = (props.item.description ?? "").replace(/\[char_name\]/gi, "[user_name]");
      await api.post("/api/personas", { name: props.item.name, description });
      await mutate("/api/personas");
      toast.success(`Persona "${props.item.name}" created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <CardShell
      {...props}
      coverAspect="square"
      sub={props.item.description?.slice(0, 90) ?? ""}
      extraActions={
        <Button variant="ghost" size="sm" shape="square" title="Create persona from this character" onClick={createPersona}>
          <VenetianMask />
        </Button>
      }
      cover={
        avatar ? (
          <CoverImage src={avatar} />
        ) : neutral ? (
          // 2:3 sprite cropped into the square cover — keep the face
          <CoverImage src={neutral} top />
        ) : (
          <UserRound size={32} />
        )
      }
    />
  );
}

export function PersonaCard(props: LibraryCardProps) {
  return (
    <CardShell
      {...props}
      sub={props.item.description?.slice(0, 90) ?? ""}
      cover={<VenetianMask size={32} />}
    />
  );
}

export function LocationCard(props: LibraryCardProps) {
  const artwork = assetUrl(props.item.artworkAsset);
  return (
    <CardShell
      {...props}
      sub={props.item.description?.slice(0, 90) ?? ""}
      cover={artwork ? <CoverImage src={artwork} /> : <Mountain size={32} />}
    />
  );
}

export function SceneCard(props: LibraryCardProps) {
  const artwork = assetUrl(props.item.artworkAsset);
  return (
    <CardShell
      {...props}
      sub={props.item.setup?.slice(0, 90) ?? ""}
      cover={artwork ? <CoverImage src={artwork} /> : <Mountain size={32} />}
    />
  );
}

export function StoryCard(props: LibraryCardProps) {
  const { item } = props;
  return (
    <CardShell
      {...props}
      sub={`${item.sceneIds?.length ?? 0} scenes — ${(item.description ?? "").slice(0, 70)}`}
      cover={<BookOpen size={32} />}
    />
  );
}

export function LorebookCard(props: LibraryCardProps) {
  const { item } = props;
  return (
    <CardShell
      {...props}
      sub={`${item.entries?.length ?? 0} entries — ${(item.description ?? "").slice(0, 70)}`}
      cover={<LibraryBig size={32} />}
    />
  );
}

export const LIBRARY_CARDS = {
  character: CharacterCard,
  persona: PersonaCard,
  location: LocationCard,
  scene: SceneCard,
  story: StoryCard,
  lorebook: LorebookCard,
} satisfies Record<string, ComponentType<LibraryCardProps>>;
