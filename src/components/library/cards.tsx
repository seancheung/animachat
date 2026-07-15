"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import {
  BookOpen,
  Download,
  Eye,
  LibraryBig,
  Mountain,
  Trash2,
  UserRound,
  VenetianMask,
} from "lucide-react";
import { Modal } from "@/components/app";
import { confirmDialog } from "@/components/confirm";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useInvalidate } from "@/lib/queries";
import { EMOTIONS } from "@/lib/types";
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
          "w-full flex items-center justify-center text-content-300 bg-base-300 overflow-hidden",
          coverAspect === "square" ? "aspect-square" : "aspect-video"
        )}
      >
        {cover}
      </div>
      <div className="p-2.5">
        <div className="font-medium text-sm truncate">{item.name}</div>
        <div className="text-xs text-content-300 line-clamp-2 h-8">{sub}</div>
        {item.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.tags.map((t: string) => (
              <Badge key={t} variant="secondary" rounded>
                {t}
              </Badge>
            ))}
          </div>
        )}
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

/** Full-size sprite preview with an expression switcher — how the character reads on stage. */
function CharacterPreview({
  item,
  open,
  onClose,
}: {
  item: any;
  open: boolean;
  onClose: () => void;
}) {
  const sprites: Record<string, string> = item.sprites ?? {};
  // standard vocabulary first, then custom expressions that have an upload
  const names = [
    ...EMOTIONS.filter((e) => sprites[e]),
    ...Object.keys(sprites).filter((k) => !(EMOTIONS as readonly string[]).includes(k)),
  ];
  const [emo, setEmo] = useState<string>(names[0] ?? "neutral");
  const src = assetUrl(sprites[emo] ?? sprites.neutral);
  return (
    <Modal open={open} onClose={onClose} title={item.name}>
      <div className="flex gap-4">
        <div className="w-56 shrink-0 aspect-[2/3] bg-base-300 rounded-md overflow-hidden flex items-center justify-center">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={`${item.name} — ${emo}`} className="w-full h-full object-cover" />
          ) : (
            <div
              className="w-2/3 h-5/6 bg-base-400"
              style={{
                WebkitMaskImage: "url(/defaults/sprite-placeholder.svg)",
                maskImage: "url(/defaults/sprite-placeholder.svg)",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }}
            />
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {names.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {names.map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={n === emo ? "secondary" : "ghost"}
                  onClick={() => setEmo(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-content-400">no sprites uploaded yet</div>
          )}
          <div className="text-xs text-content-300 whitespace-pre-wrap overflow-y-auto max-h-72">
            {item.description}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function CharacterCard(props: LibraryCardProps) {
  const [preview, setPreview] = useState(false);
  const invalidate = useInvalidate();
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
      await invalidate("/api/personas", "/api/library/search");
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
        <>
          <Button variant="ghost" size="sm" shape="square" title="Preview sprites" onClick={() => setPreview(true)}>
            <Eye />
          </Button>
          <Button variant="ghost" size="sm" shape="square" title="Create persona from this character" onClick={createPersona}>
            <VenetianMask />
          </Button>
          <CharacterPreview item={props.item} open={preview} onClose={() => setPreview(false)} />
        </>
      }
      cover={
        neutral ? (
          // the sprite makes the better cover — the avatar is sized for tiny chat chips;
          // the 2:3 portrait is cropped into the square with the face kept
          <CoverImage src={neutral} top />
        ) : avatar ? (
          <CoverImage src={avatar} />
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
      sub={`${item.characterIds?.length ?? 0} cast, ${item.scenes?.length ?? 0} scenes — ${(item.description ?? "").slice(0, 70)}`}
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
