"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NavTabs } from "@/components/NavTabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { confirmNavigation } from "@/lib/navigationGuard";

/** Top navigation bar — hidden on chat pages: the VN stage is full-bleed with its
 *  floating back button, and the casual messenger brings its own page header. */
export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname.startsWith("/chat/")) return null;
  return (
    <nav className="flex items-center gap-1 px-4 h-12 border-b border-base-400 bg-base-100 shrink-0">
      <Link
        href="/"
        className="font-semibold tracking-wide mr-4"
        onClick={async (event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (await confirmNavigation()) router.push("/");
        }}
      >
        Anima<span className="text-primary-500">Chat</span>
      </Link>
      <NavTabs />
      <span className="flex-1" />
      <ThemeToggle />
    </nav>
  );
}
