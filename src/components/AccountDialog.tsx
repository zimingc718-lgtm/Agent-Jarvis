"use client";

import { useState } from "react";
import { ConfigWarning } from "./ConfigWarning";
import { Dialog } from "./Dialog";

export type GoogleOAuthUiState = { configured: true; missing: [] } | { configured: false; missing: string[] };

type AccountDialogProps = {
  authenticated: boolean;
  googleOAuth: GoogleOAuthUiState;
};

export function AccountDialog({ authenticated, googleOAuth }: AccountDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        账号登录
      </button>
      <Dialog open={open} title="Agent-Jarvis 账号" onClose={() => setOpen(false)}>
        <p className="dialog__note" role="status">
          {authenticated ? "已登录 Agent-Jarvis。" : "尚未登录 Agent-Jarvis。"}
        </p>

        <div className="dialog__section">
          {authenticated ? (
            <a href="/api/auth/signout">Sign out</a>
          ) : googleOAuth.configured ? (
            <a href="/api/auth/signin">Sign in with Google</a>
          ) : (
            <ConfigWarning
              title="Google OAuth configuration required"
              missing={googleOAuth.missing}
              hint="在 .env.local 中设置后重启开发服务器；Google 控制台的回调地址需为 <NEXTAUTH_URL>/api/auth/callback/google。"
            />
          )}
        </div>

        <p className="dialog__note">
          Agent-Jarvis 账号 ≠ 模型授权。OpenAI、DeepSeek、本地模型的凭据在「配置」中单独设置。
        </p>
      </Dialog>
    </>
  );
}
