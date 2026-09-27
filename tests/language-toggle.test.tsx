// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LANGUAGE_CHANGED_EVENT } from "@/lib/ui-events";

/**
 * TEST-571 (component half) — the ☰「语言」switch (REQ-F-330 ②③; CR-20260927-reply-language):
 * two options, server-side save, `<html lang>` follows, failure reverts.
 */
describe("TEST-571 LanguageToggle", () => {
  it("① 两个选项，初值来自服务端；点 English 保存、派发事件、<html lang> 跟随", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    const changed = vi.fn();
    window.addEventListener(LANGUAGE_CHANGED_EVENT, changed);
    render(<LanguageToggle initialLanguage="zh" save={save} />);

    const zh = screen.getByRole("button", { name: "中文" });
    const en = screen.getByRole("button", { name: "English" });
    expect(zh).toHaveAttribute("aria-pressed", "true");
    expect(en).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(screen.getByText(/界面文案的英文版下一步做/)).toBeInTheDocument();

    fireEvent.click(en);
    await waitFor(() => expect(save).toHaveBeenCalledWith("en"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Jarvis will reply in English."));
    expect(en).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.lang).toBe("en");
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0]![0] as CustomEvent<{ language: string }>).detail).toEqual({ language: "en" });
    window.removeEventListener(LANGUAGE_CHANGED_EVENT, changed);
  });

  it("② 保存失败时回到原值并显示服务端说明；点当前值不发请求", async () => {
    const save = vi.fn(async () => ({ ok: false, message: 'language 只接受 "zh" 或 "en"。' }));
    render(<LanguageToggle initialLanguage="zh" save={save} />);

    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/只接受/));
    expect(screen.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
