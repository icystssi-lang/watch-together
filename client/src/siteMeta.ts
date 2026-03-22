/**
 * Copyright and builder credit for the site footer.
 *
 * Product name defaults come from `./appName`. Override with Vite env at build time:
 * - VITE_APP_COPYRIGHT_HOLDER — name after © year
 * - VITE_APP_BUILT_BY — “Built by …”
 */

import { APP_DISPLAY_NAME } from "./appName";

function envTrim(key: "VITE_APP_COPYRIGHT_HOLDER" | "VITE_APP_BUILT_BY"): string {
  const v = import.meta.env[key];
  return typeof v === "string" ? v.trim() : "";
}

const DEFAULT_COPYRIGHT_HOLDER = APP_DISPLAY_NAME;

/** Default “built by” credit — change to your name, team, or company. */
const DEFAULT_BUILT_BY = "ImNoobBut";

/** Legal copyright owner (shown after © year). */
export const COPYRIGHT_HOLDER =
  envTrim("VITE_APP_COPYRIGHT_HOLDER") || DEFAULT_COPYRIGHT_HOLDER;

/** Who built this app (shown as “Built by …”). */
export const BUILT_BY =
  envTrim("VITE_APP_BUILT_BY") || DEFAULT_BUILT_BY;

export const COPYRIGHT_YEAR = new Date().getFullYear();
