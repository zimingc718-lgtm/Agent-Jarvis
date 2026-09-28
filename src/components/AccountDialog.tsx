"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { ConfigWarning } from "./ConfigWarning";
import { Dialog } from "./Dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/components/LanguageProvider";

export type GoogleOAuthUiState = { configured: true; missing: [] } | { configured: false; missing: string[] };

type AccountDialogProps = {
  authenticated: boolean;
  googleOAuth: GoogleOAuthUiState;
};

export function AccountDialog({ authenticated, googleOAuth }: AccountDialogProps) {
  const t = useT();
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
        {t("account.open")}
      </Button>
      <Dialog open={open} title={t("account.dialogTitle")} onClose={() => setOpen(false)}>
        <p className="dialog__note text-sm text-muted-foreground" role="status">
          {authenticated ? t("account.signedIn") : t("account.signedOut")}
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
              hint={t("account.oauthHint")}
            />
          )}
        </div>

        <Separator className="my-4" />

        <p className="dialog__note text-sm text-muted-foreground">
          {t("account.credentialsNote")}
        </p>
      </Dialog>
    </>
  );
}
