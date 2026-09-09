import type { Metadata } from "next";
import { themeBootstrapScript } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent-Jarvis",
  description: "Floating LLM chat for Agent-Jarvis"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* Applies the stored theme before the page paints, so a dark-mode user
            never sees a light flash on load. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        {children}
      </body>
    </html>
  );
}
