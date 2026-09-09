"use client";

import { useState } from "react";
import { ConfigWarning } from "./ConfigWarning";
import { Dialog } from "./Dialog";
import { ModelSettings } from "./ModelSettings";
import { ThemeToggle } from "./ThemeToggle";
import type { ProviderTemplate } from "@/lib/providers";
import { STORAGE_CONFIG_HINT, type RuntimeConfigStatus } from "@/lib/runtime-config";
import type { ProviderSummary } from "@/lib/types";

type SettingsDialogProps = {
  templates: ProviderTemplate[];
  providers: ProviderSummary[];
  /** When storage is unconfigured, provider settings cannot be saved at all. */
  storage?: RuntimeConfigStatus;
};

export function SettingsDialog({ templates, providers, storage }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const storageBlocked = storage ? !storage.configured : false;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        配置
      </button>
      <Dialog open={open} title="设置" onClose={() => setOpen(false)}>
        <section className="dialog__section" aria-label="外观">
          <h3>外观</h3>
          <ThemeToggle />
        </section>
        {storageBlocked ? (
          <ConfigWarning title="本地存储未配置，无法保存 Provider" missing={storage!.missing} hint={STORAGE_CONFIG_HINT} />
        ) : (
          <ModelSettings templates={templates} providers={providers} />
        )}
      </Dialog>
    </>
  );
}
