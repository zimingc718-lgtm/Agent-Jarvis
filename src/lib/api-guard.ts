import { NextResponse } from "next/server";
import { requestTranslator } from "./i18n-request";
import { getStorageConfig } from "./runtime-config";

/**
 * Returns a readable 503 when the server cannot open its store, or null when it
 * can. Call it after the auth check in every route that touches the store, so a
 * missing JARVIS_SECRET_KEY surfaces as a diagnosable response instead of an
 * unhandled throw.
 */
export function storageUnavailable(): NextResponse | null {
  const status = getStorageConfig();
  if (status.configured) {
    return null;
  }
  return NextResponse.json(
    {
      // The store cannot be opened here, so this is Chinese unless a language could be read (it cannot) — registered limitation.
      message: requestTranslator()("guard.storageNotConfigured", { missing: status.missing.join(", ") }),
      missing: status.missing,
    },
    { status: 503 }
  );
}
