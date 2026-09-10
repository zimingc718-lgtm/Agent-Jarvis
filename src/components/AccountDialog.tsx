"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { ConfigWarning } from "./ConfigWarning";
import { Dialog } from "./Dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export type GoogleOAuthUiState = { configured: true; missing: [] } | { configured: false; missing: string[] };

type AccountDialogProps = {
  authenticated: boolean;
  googleOAuth: GoogleOAuthUiState;
};

export function AccountDialog({ authenticated, googleOAuth }: AccountDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start gap-2"
        onClick={() => setOpen(true)}
      >
        <UserRound aria-hidden="true" className="size-4" />
        账号登录
      </Button>
      <Dialog open={open} title="Agent-Jarvis 账号" onClose={() => setOpen(false)}>
        <p className="dialog__note text-sm text-muted-foreground" role="status">
          {authenticated ? "已登录 Agent-Jarvis。" : "尚未登录 Agent-Jarvis。"}
        </p>

        <div className="dialog__section mt-4">
          {authenticated ? (
            <a
              href="/api/auth/signout"
              className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign out
            </a>
          ) : googleOAuth.configured ? (
            <a
              href="/api/auth/signin"
              className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in with Google
            </a>
          ) : (
            <ConfigWarning
              title="Google OAuth configuration required"
              missing={googleOAuth.missing}
              hint="在 .env.local 中设置后重启开发服务器；Google 控制台的回调地址需为 <NEXTAUTH_URL>/api/auth/callback/google。"
            />
          )}
        </div>

        <Separator className="my-4" />

        <p className="dialog__note text-sm text-muted-foreground">
          Agent-Jarvis 账号 ≠ 模型授权。OpenAI、DeepSeek、本地模型的凭据在「配置」中单独设置。
        </p>
      </Dialog>
    </>
  );
}
