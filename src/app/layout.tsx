import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppNav } from "@/components/AppNav";
import { Providers } from "@/components/Providers";
import { Confirmer } from "@/components/confirm";
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
        <Providers>
          <AppNav />
          <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
          <Toaster position="bottom-right" />
          <Confirmer />
        </Providers>
      </body>
    </html>
  );
}
