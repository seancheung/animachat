import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Confirmer } from "@/components/confirm";
import { NavTabs } from "@/components/NavTabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AnimaChat",
  description: "AI-driven virtual character chat with a visual-novel soul",
};

function Nav() {
  return (
    <nav className="flex items-center gap-1 px-4 h-12 border-b border-base-400 bg-base-100 shrink-0">
      <Link
        href="/"
        className="font-semibold tracking-wide text-primary-500 mr-4 inline-flex items-center gap-1.5"
      >
        <Sparkles size={16} /> AnimaChat
      </Link>
      <NavTabs />
      <span className="flex-1" />
      <ThemeToggle />
    </nav>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full flex flex-col overflow-hidden">
        {/* apply the stored theme before paint; auto (follow the system) is the default */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem("animachat-theme");if(m!=="dark"&&m!=="light"){m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=m}catch(e){document.documentElement.dataset.theme="light"}`,
          }}
        />
        <Nav />
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        <Toaster position="bottom-right" />
        <Confirmer />
      </body>
    </html>
  );
}
