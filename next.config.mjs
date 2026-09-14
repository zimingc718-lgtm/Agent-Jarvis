/**
 * @type {import('next').NextConfig}
 *
 * `next build` and `next dev` share one build directory by default, so running a
 * production build while an interactive dev server is up (or running the smoke
 * and e2e servers back to back) corrupts the running server's webpack runtime —
 * routes it later recompiles fail with `Cannot find module './vendor-chunks/…'`.
 *
 * Every non-interactive entry point sets NEXT_DIST_DIR to its own directory so
 * it can never collide with a developer's `.next`. See docs/WORKFLOW.md.
 */
import { execSync } from "node:child_process";

/**
 * 服务器供的是哪个提交（DEC-210 ①）。
 *
 * `env` 里的值会被编译进产物（实测：`.next-prod/server/**` 里能 grep 到这个 SHA），所以
 * 它记录的是「**这份产物是从哪份代码构建出来的**」——`next start` 不会重新取。生产模式下
 * 这正是要比对的事实：用户看到的字节来自那次构建。`next dev` 下配置在服务器启动时读一次、
 * 页面按需编译，于是等同于「这台进程从哪份代码起来的」。
 *
 * 取不到（浅克隆、无 git、打包镜像）时留空：宁可让检查报「拿不到」，也不要编一个值。
 */
function buildSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_SHA: buildSha() },
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // CR-20260909-corner-menu: the app owns the bottom-left corner (☰ menu), so move
  // the dev-only Next.js indicator out of the way. No effect on production builds.
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
