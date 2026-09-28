"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { ConfigWarning } from "./ConfigWarning";
import { Dialog } from "./Dialog";
import { ModelSettings } from "./ModelSettings";
import { Button } from "@/components/ui/button";
import type { ProviderTemplate } from "@/lib/providers";
import { STORAGE_CONFIG_HINT, type RuntimeConfigStatus } from "@/lib/runtime-config";
import type { ProviderSummary } from "@/lib/types";
import { useT } from "@/components/LanguageProvider";

type SettingsDialogProps = {
  templates: ProviderTemplate[];
  providers: ProviderSummary[];
  /** When storage is unconfigured, provider settings cannot be saved at all. */
  storage?: RuntimeConfigStatus;
};

export function SettingsDialog({ templates, providers, storage }: SettingsDialogProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const storageBlocked = storage ? !storage.configured : false;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start gap-2"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        {t("settings.models")}
      </Button>
      <Dialog open={open} title={t("settings.providersAria")} onClose={() => setOpen(false)}>
        {storageBlocked ? (
          <ConfigWarning title={t("settings.storageMissing")} missing={storage!.missing} hint={STORAGE_CONFIG_HINT} />
        ) : (
          <ModelSettings templates={templates} providers={providers} />
        )}
      </Dialog>
    </>
  );
}
