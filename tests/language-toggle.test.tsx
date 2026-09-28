// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/components/LanguageProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LANGUAGE_CHANGED_EVENT } from "@/lib/ui-events";

/**
 * TEST-571 (component half) — the ☰「语言」switch (REQ-F-330 ②③; CR-20260927-reply-language;
 * CR-20260928-ui-strings-i18n moved the live value into `LanguageProvider`): two options,
 * server-side save, `<html lang>` follows, failure reverts, and the switch's own words
 * change with the language it has just selected.
 */
function mount(save: (language: "zh" | "en") => Promise<{ ok: boolean; message?: string }>) {
  return render(
    <LanguageProvider initialLanguage="zh">
      <LanguageToggle save={save} />
    </LanguageProvider>
  );
}

describe("TEST-571 LanguageToggle", () => {
  it("① 两个选项，初值来自服务端；点 English 保存、派发事件、<html lang> 跟随、提示随之变英文", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const changed = vi.fn();
    window.addEventListener(LANGUAGE_CHANGED_EVENT, changed);
    mount(save);

    const zh = screen.getByRole("button", { name: "中文" });
    const en = screen.getByRole("button", { name: "English" });
    expect(zh).toHaveAttribute("aria-pressed", "true");
    expect(en).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(screen.getByText("同时决定界面语言与 Jarvis 的回复语言。")).toBeInTheDocument();

    fireEvent.click(en);
    await waitFor(() => expect(save).toHaveBeenCalledWith("en"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Interface and replies switched to English.")
    );
    expect(en).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByText("Sets both the interface language and the language Jarvis replies in.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0]![0] as CustomEvent<{ language: string }>).detail).toEqual({ language: "en" });
    window.removeEventListener(LANGUAGE_CHANGED_EVENT, changed);
  });

  it("② 保存失败时回到原值并显示服务端说明；点当前值不发请求", async () => {
    const save = vi.fn(async () => ({ ok: false, message: 'language 只接受 "zh" 或 "en"。' }));
    mount(save);

    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/只接受/));
    expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(screen.getByText("同时决定界面语言与 Jarvis 的回复语言。")).toBeInTheDocument();
  });
});
