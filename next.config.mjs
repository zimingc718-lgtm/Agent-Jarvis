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
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
