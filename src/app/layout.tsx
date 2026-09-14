import type { Metadata } from "next";
import { themeBootstrapScript } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent-Jarvis",
  description: "Floating LLM chat for Agent-Jarvis",
  // 这份产物是从哪个提交构建出来的（DEC-210 ①）。`check-dev-server` 拿它与 HEAD 比对，
  // 于是「服务器供的是旧构建」会当场报错，而不是靠人发现某个改动没生效。
  //
  // 必须走 Metadata API：App Router 会把 layout 里手写的 <head> 整个丢掉——第一版就是
  // 这么写的，单测全绿、页面上一个字都没有，直到真跑一次才看见。这正是这条建议本身
  // 要治的毛病，写在这里免得下一个人再踩。
  other: { "jarvis-build": process.env.NEXT_PUBLIC_BUILD_SHA ?? "" }
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
