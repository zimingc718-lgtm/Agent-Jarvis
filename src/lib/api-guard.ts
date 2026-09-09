import { NextResponse } from "next/server";
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
      message: `服务端存储未配置：缺少 ${status.missing.join(", ")}。请在 .env.local 中设置后重启服务，参见 docs/LOCAL_CONFIGURATION.md。`,
      missing: status.missing,
    },
    { status: 503 }
  );
}
