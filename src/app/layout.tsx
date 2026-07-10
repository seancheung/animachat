import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { BookMarked, MessagesSquare, Settings, Sparkles } from "lucide-react";
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
    <nav className="flex items-center gap-1 px-4 h-12 border-b border-[var(--border)] bg-[var(--bg-soft)] shrink-0">
      <Link href="/" className="font-semibold tracking-wide text-[var(--accent)] mr-4 inline-flex items-center gap-1.5">
        <Sparkles size={16} /> AnimaChat
      </Link>
      <Link href="/" className="btn btn-ghost btn-sm">
        <MessagesSquare size={14} /> Chats
      </Link>
      <Link href="/library" className="btn btn-ghost btn-sm">
        <BookMarked size={14} /> Library
      </Link>
      <Link href="/settings" className="btn btn-ghost btn-sm">
        <Settings size={14} /> Settings
      </Link>
    </nav>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full flex flex-col overflow-hidden">
        <Nav />
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
