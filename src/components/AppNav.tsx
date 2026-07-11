"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/NavTabs";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Top navigation bar — hidden on chat pages, which are full-bleed VN stages
 *  with their own floating back button. */
export function AppNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/chat/")) return null;
  return (
    <nav className="flex items-center gap-1 px-4 h-12 border-b border-base-400 bg-base-100 shrink-0">
      <Link href="/" className="font-semibold tracking-wide mr-4">
        Anima<span className="text-primary-500">Chat</span>
      </Link>
      <NavTabs />
      <span className="flex-1" />
      <ThemeToggle />
    </nav>
  );
}
