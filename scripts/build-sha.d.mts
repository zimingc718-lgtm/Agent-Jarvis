/** Types for `build-sha.mjs` (the module is plain ESM so `next.config.mjs` can import it without a build step). */
export function gitHead(): string;
export function resolveBuildSha(env?: Record<string, string | undefined>, head?: () => string): string;
