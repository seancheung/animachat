import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
      <Link href="/" className="font-semibold tracking-wide text-[var(--accent)] mr-4">
        ✦ AnimaChat
      </Link>
      <Link href="/" className="btn btn-ghost btn-sm">
        Chats
      </Link>
      <Link href="/library" className="btn btn-ghost btn-sm">
        Library
      </Link>
      <Link href="/settings" className="btn btn-ghost btn-sm">
        Settings
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
