"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
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

  return (
    <div className="settings">
      <header className="settings-page__header">
        <h2>Model Providers</h2>
        <p className="dialog__note">
          Connect model providers for Agent-Jarvis. When more than one is enabled, the floating console uses the
          highest-priority connected provider.
        </p>
      </header>

      <section className="settings-page__grid" aria-label="Provider templates">
        {templates.map((template) => (
          <article className="provider-card" key={template.kind}>
            <div>
              <h2>{template.name}</h2>
              <span>{labelAuthMode(template.authMode)}</span>
            </div>
            <dl>
              <dt>Base URL</dt>
              <dd>{template.baseUrl ?? "Provider OAuth endpoint"}</dd>
              <dt>Default model</dt>
              <dd>{template.defaultModel}</dd>
            </dl>
          </article>
        ))}
      </section>

      <section className="settings-page__panel" aria-label="Saved providers">
        <h2>Saved providers</h2>
        {showReorder ? (
          <p className="dialog__note">优先级从上到下递减；对话自动使用最靠上、连接有效的 Provider。</p>
        ) : null}
        {savedProviders.length > 0 ? (
          <ol className="provider-list">
            {savedProviders.map((provider, index) => (
              <li key={provider.id}>
                <span>{provider.name}</span>
                <span>{provider.defaultModel}</span>
                <span>{provider.connected ? "Connected" : "Not connected"}</span>
                <span>{provider.enabled ? "Enabled" : "Disabled"}</span>
                {provider.secretPreview ? <span>{provider.secretPreview}</span> : null}
                {provider.note ? <span className="provider-list__note">{provider.note}</span> : null}
                {showReorder ? (
                  <>
                    <button
                      type="button"
                      aria-label={`Raise ${provider.name} priority`}
                      onClick={() => reorder(provider, "up")}
                      disabled={busy || index === 0}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Lower ${provider.name} priority`}
                      onClick={() => reorder(provider, "down")}
                      disabled={busy || index === savedProviders.length - 1}
                    >
                      ↓
                    </button>
                  </>
                ) : null}
                <button type="button" onClick={() => editProvider(provider)} disabled={busy}>
                  Edit
                </button>
                <button type="button" onClick={() => toggleEnabled(provider)} disabled={busy}>
                  {provider.enabled ? "Disable" : "Enable"}
                </button>
                <button type="button" onClick={() => deleteProvider(provider)} disabled={busy}>
                  Delete
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p>No model provider saved yet.</p>
        )}
      </section>

      <form className="provider-form" onSubmit={handleSubmit}>
        <p className="provider-form__mode">{form.id ? "Editing existing provider" : "Adding new provider"}</p>
        <label>
          Provider type
          <select value={form.kind} onChange={(event) => selectTemplate(event.target.value as ProviderKind)}>
            {templates.map((template) => (
              <option key={template.kind} value={template.kind}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Provider name
          <input name="name" value={form.name} onChange={(event) => updateField("name", event.target.value)} />
        </label>
        <label>
          Base URL
          <input name="baseUrl" value={form.baseUrl} onChange={(event) => updateField("baseUrl", event.target.value)} />
        </label>
        <label>
          Model
          <input
            name="model"
            value={form.defaultModel}
            onChange={(event) => updateField("defaultModel", event.target.value)}
          />
        </label>
        <label>
          Secret / API key
          <input
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
        </label>
        <label className="provider-form__checkbox">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => updateField("enabled", event.target.checked)}
          />
          Enable provider
        </label>
        <div className="provider-form__actions">
          <button type="submit" disabled={busy}>
            {form.id ? "Update provider" : "Save provider"}
          </button>
          <button type="button" onClick={handleTestConnection} disabled={busy}>
            Test connection
          </button>
          {form.id ? (
            <button type="button" onClick={resetForm} disabled={busy}>
              Cancel edit
            </button>
          ) : null}
        </div>
        <p role="status">{status}</p>
      </form>
    </div>
  );
}
