"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ProviderTemplate } from "@/lib/providers";
import type { ProviderAuthMode, ProviderKind, ProviderSummary } from "@/lib/types";

type ModelSettingsProps = {
  templates: ProviderTemplate[];
  providers: ProviderSummary[];
};

type ProviderFormState = {
  id: string | null;
  kind: ProviderKind;
  authMode: ProviderAuthMode;
  name: string;
  baseUrl: string;
  defaultModel: string;
  secret: string;
  enabled: boolean;
};

function labelAuthMode(mode: ProviderTemplate["authMode"]): string {
  if (mode === "api_key") return "API Key";
  if (mode === "local") return "Local";
  if (mode === "oauth") return "OAuth";
  return "Unsupported";
}

function stateFromTemplate(template: ProviderTemplate): ProviderFormState {
  return {
    id: null,
    kind: template.kind,
    authMode: template.authMode,
    name: template.name,
    baseUrl: template.baseUrl ?? "",
    defaultModel: template.defaultModel,
    secret: "",
    enabled: true,
  };
}

export function ModelSettings({ templates, providers }: ModelSettingsProps) {
  const [form, setForm] = useState<ProviderFormState>(() => stateFromTemplate(templates[0]));
  const [savedProviders, setSavedProviders] = useState(providers);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const templateDefaults = useRef(stateFromTemplate(templates[0]));

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.kind === form.kind) ?? templates[0],
    [form.kind, templates]
  );

  // REQ-F-006: reorder controls appear only when more than one provider is enabled.
  const showReorder = savedProviders.filter((provider) => provider.enabled).length > 1;

  function selectTemplate(kind: ProviderKind) {
    const template = templates.find((item) => item.kind === kind) ?? templates[0];
    const previousDefaults = templateDefaults.current;
    // Preserve fields the user has already customised; only replace values still at the old template default.
    setForm((current) => ({
      ...current,
      id: null,
      kind: template.kind,
      authMode: template.authMode,
      name: current.name === previousDefaults.name ? template.name : current.name,
      baseUrl: current.baseUrl === previousDefaults.baseUrl ? template.baseUrl ?? "" : current.baseUrl,
      defaultModel:
        current.defaultModel === previousDefaults.defaultModel ? template.defaultModel : current.defaultModel,
    }));
    templateDefaults.current = stateFromTemplate(template);
  }

  function updateField(field: keyof ProviderFormState, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function editProvider(provider: ProviderSummary) {
    setForm({
      id: provider.id,
      kind: provider.kind,
      authMode: provider.authMode,
      name: provider.name,
      baseUrl: provider.baseUrl ?? "",
      defaultModel: provider.defaultModel,
      secret: "",
      enabled: provider.enabled,
    });
    setStatus(`Editing "${provider.name}" — leave the key blank to keep the stored one.`);
  }

  function resetForm() {
    setForm(stateFromTemplate(selectedTemplate));
    setStatus("Ready");
  }

  async function refreshProviders() {
    const response = await fetch("/api/providers");
    if (!response.ok) return;
    const body = (await response.json()) as { providers?: ProviderSummary[] };
    setSavedProviders(body.providers ?? []);
    // Tell the floating console to re-probe its status light (REQ-F-018).
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("jarvis:providers-changed"));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(form.id ? "Updating provider..." : "Saving provider...");

    const response = await fetch("/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: form.id ?? undefined,
        name: form.name,
        kind: form.kind,
        authMode: form.authMode,
        baseUrl: form.baseUrl,
        defaultModel: form.defaultModel,
        enabled: form.enabled,
        secret: form.secret,
      }),
    });

    setBusy(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setStatus(body?.message ?? "Provider save failed.");
      return;
    }

    setForm((current) => ({ ...current, id: current.id, secret: "" }));
    setStatus(form.id ? "Provider updated." : "Provider saved.");
    await refreshProviders();
  }

  async function toggleEnabled(provider: ProviderSummary) {
    setBusy(true);
    setStatus(provider.enabled ? "Disabling provider..." : "Enabling provider...");
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !provider.enabled }),
    });
    setBusy(false);
    setStatus(response.ok ? "Provider updated." : "Update failed.");
    await refreshProviders();
  }

  // REQ-F-006 (CR-20260909): the saved list is priority-ordered; ↑/↓ swap with the neighbour.
  async function reorder(provider: ProviderSummary, direction: "up" | "down") {
    setBusy(true);
    setStatus(direction === "up" ? "Raising priority..." : "Lowering priority...");
    const response = await fetch(`/api/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    setBusy(false);
    setStatus(response.ok ? "Priority updated." : "Reorder failed.");
    await refreshProviders();
  }

  async function deleteProvider(provider: ProviderSummary) {
    setBusy(true);
    setStatus(`Deleting "${provider.name}"...`);
    const response = await fetch(`/api/providers/${provider.id}`, { method: "DELETE" });
    setBusy(false);
    setStatus(response.ok ? "Provider deleted." : "Delete failed.");
    if (form.id === provider.id) {
      resetForm();
    }
    await refreshProviders();
  }

  async function handleTestConnection() {
    setBusy(true);
    setStatus("Testing connection...");
    const response = await fetch("/api/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: form.id ?? undefined, baseUrl: form.baseUrl, secret: form.secret }),
    });
    setBusy(false);
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    setStatus(body?.message ?? (response.ok ? "Connection OK." : "Connection check failed."));
  }

  const fieldClass = "flex flex-col gap-1.5";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="settings flex flex-col gap-6">
        <header className="settings-page__header flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight">Model Providers</h2>
          <p className="dialog__note text-sm text-muted-foreground">
            Connect model providers for Agent-Jarvis. When more than one is enabled, the floating console uses the
            highest-priority connected provider.
          </p>
        </header>

        <section
          className="settings-page__grid grid gap-3 sm:grid-cols-2"
          aria-label="Provider templates"
        >
          {templates.map((template) => (
            <article
              className="provider-card rounded-md border border-border bg-card p-3 text-card-foreground"
              key={template.kind}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium">{template.name}</h2>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                  {labelAuthMode(template.authMode)}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt>Base URL</dt>
                <dd className="truncate text-foreground">{template.baseUrl ?? "Provider OAuth endpoint"}</dd>
                <dt>Default model</dt>
                <dd className="truncate text-foreground">{template.defaultModel}</dd>
              </dl>
            </article>
          ))}
        </section>

        <Separator />

        <section className="settings-page__panel flex flex-col gap-3" aria-label="Saved providers">
          <h2 className="text-sm font-semibold tracking-tight">Saved providers</h2>
          {showReorder ? (
            <p className="dialog__note text-sm text-muted-foreground">
              优先级从上到下递减；对话自动使用最靠上、连接有效的 Provider。
            </p>
          ) : null}
          {savedProviders.length > 0 ? (
            <ol className="provider-list flex flex-col gap-2">
              {savedProviders.map((provider, index) => (
                <li
                  key={provider.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card p-3 text-sm text-card-foreground"
                >
                  <span className="font-medium">{provider.name}</span>
                  <span className="text-muted-foreground">{provider.defaultModel}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      provider.connected
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {provider.connected ? "Connected" : "Not connected"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {provider.enabled ? "Enabled" : "Disabled"}
                  </span>
                  {provider.secretPreview ? (
                    <span className="font-mono text-xs text-muted-foreground">{provider.secretPreview}</span>
                  ) : null}
                  {provider.note ? (
                    <span className="provider-list__note w-full text-xs text-muted-foreground">{provider.note}</span>
                  ) : null}

                  <div className="ml-auto flex items-center gap-1">
                    {showReorder ? (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-11"
                              aria-label={`Raise ${provider.name} priority`}
                              onClick={() => reorder(provider, "up")}
                              disabled={busy || index === 0}
                            >
                              <ArrowUp aria-hidden="true" className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>提高优先级</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-11"
                              aria-label={`Lower ${provider.name} priority`}
                              onClick={() => reorder(provider, "down")}
                              disabled={busy || index === savedProviders.length - 1}
                            >
                              <ArrowDown aria-hidden="true" className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>降低优先级</TooltipContent>
                        </Tooltip>
                      </>
                    ) : null}
                    <Button type="button" variant="outline" onClick={() => editProvider(provider)} disabled={busy}>
                      Edit
                    </Button>
                    <Button type="button" variant="outline" onClick={() => toggleEnabled(provider)} disabled={busy}>
                      {provider.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => deleteProvider(provider)}
                      disabled={busy}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No model provider saved yet.</p>
          )}
        </section>

        <Separator />

        <form className="provider-form flex flex-col gap-4" onSubmit={handleSubmit}>
          <p className="provider-form__mode text-sm font-medium">
            {form.id ? "Editing existing provider" : "Adding new provider"}
          </p>

          <div className={fieldClass}>
            <Label htmlFor="provider-kind">Provider type</Label>
            <select
              id="provider-kind"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              value={form.kind}
              onChange={(event) => selectTemplate(event.target.value as ProviderKind)}
            >
              {templates.map((template) => (
                <option key={template.kind} value={template.kind}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>

          <div className={fieldClass}>
            <Label htmlFor="provider-name">Provider name</Label>
            <Input
              id="provider-name"
              name="name"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
          </div>

          <div className={fieldClass}>
            <Label htmlFor="provider-base-url">Base URL</Label>
            <Input
              id="provider-base-url"
              name="baseUrl"
              value={form.baseUrl}
              onChange={(event) => updateField("baseUrl", event.target.value)}
            />
          </div>

          <div className={fieldClass}>
            <Label htmlFor="provider-model">Model</Label>
            <Input
              id="provider-model"
              name="model"
              value={form.defaultModel}
              onChange={(event) => updateField("defaultModel", event.target.value)}
            />
          </div>

          <div className={fieldClass}>
            <Label htmlFor="provider-secret">Secret / API key</Label>
            <Input
              id="provider-secret"
              name="secret"
              type="password"
              value={form.secret}
              placeholder={
                form.id
                  ? "Leave blank to keep the stored key"
                  : selectedTemplate.authMode === "local"
                    ? "Optional for local providers"
                    : "Provider API key"
              }
              onChange={(event) => updateField("secret", event.target.value)}
            />
          </div>

          <label className="provider-form__checkbox flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[hsl(var(--primary))]"
              checked={form.enabled}
              onChange={(event) => updateField("enabled", event.target.checked)}
            />
            Enable provider
          </label>

          <div className="provider-form__actions flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {form.id ? "Update provider" : "Save provider"}
            </Button>
            <Button type="button" variant="outline" onClick={handleTestConnection} disabled={busy}>
              Test connection
            </Button>
            {form.id ? (
              <Button type="button" variant="ghost" onClick={resetForm} disabled={busy}>
                Cancel edit
              </Button>
            ) : null}
          </div>

          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        </form>
      </div>
    </TooltipProvider>
  );
}
