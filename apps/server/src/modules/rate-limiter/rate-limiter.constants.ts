import { join } from 'path';

/** Namespace for the per-identity sorted sets in Redis. */
export const RATE_LIMIT_KEY_PREFIX = 'rate-limit:';

/** Fallback quota for identities without an explicit config. */
export const DEFAULT_RATE_LIMIT = 100;

/** Fallback window length (1 minute). */
export const DEFAULT_WINDOW_MS = 60_000;

// Resolves in both runtimes: Jest executes this file in place, so the script
// sits in ./scripts next to it; the webpack build bundles everything into
// dist and copies the script to dist/scripts (assets in webpack.config.js).
export const SLIDING_WINDOW_SCRIPT_PATH = join(
  __dirname,
  'scripts',
  'sliding-window.lua',
);
