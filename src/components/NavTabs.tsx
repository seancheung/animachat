"use client";

import { usePathname, useRouter } from "next/navigation";
import { BookMarked, BookOpen, MessagesSquare, PenLine, Settings } from "lucide-react";
import Tabs from "@/components/ui/tab";
import { confirmNavigation } from "@/lib/navigationGuard";

const ITEMS = [
  { value: "/", label: (<span className="flex h-full items-center gap-1.5"><MessagesSquare size={14} /> Chats</span>) },
  { value: "/stories", label: (<span className="flex h-full items-center gap-1.5"><BookOpen size={14} /> Stories</span>) },
  { value: "/library", label: (<span className="flex h-full items-center gap-1.5"><BookMarked size={14} /> Library</span>) },
  { value: "/writing", label: (<span className="flex h-full items-center gap-1.5"><PenLine size={14} /> Writing</span>) },
  { value: "/settings", label: (<span className="flex h-full items-center gap-1.5"><Settings size={14} /> Settings</span>) },
];

/** Main navigation as tabs; the active tab derives from the route (chat pages belong to Chats). */
export function NavTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const active = ITEMS.find((i) => i.value !== "/" && pathname.startsWith(i.value))?.value ?? "/";
  return (
    <Tabs
      className="h-full items-stretch border-transparent"
      items={ITEMS}
      value={active}
      onChange={async (v) => {
        if (v !== active && await confirmNavigation()) router.push(v);
      }}
    />
  );
}
