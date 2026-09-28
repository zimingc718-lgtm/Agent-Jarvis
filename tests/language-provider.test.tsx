// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LanguageProvider, useLanguage, useLocale, useT } from "@/components/LanguageProvider";

/**
 * TEST-580 (provider half) — `LanguageProvider` / `useT` / `useLocale` (DEC-460;
 * CR-20260928-ui-strings-i18n): consumers render the seeded language, switching re-renders
 * them and moves `<html lang>`, and a component outside any provider is Chinese.
 */
function Probe() {
  const t = useT();
  const locale = useLocale();
  const { language, setLanguage } = useLanguage();
  return (
    <div>
      <p data-testid="send">{t("chat.send")}</p>
      <p data-testid="locale">{locale}</p>
      <p data-testid="language">{language}</p>
      <button type="button" onClick={() => setLanguage(language === "zh" ? "en" : "zh")}>
        flip
      </button>
    </div>
  );
}

describe("TEST-580 LanguageProvider", () => {
  it("① 无 Provider 时默认中文；Provider 以 SSR 初值渲染", () => {
    const bare = render(<Probe />);
    expect(screen.getByTestId("send")).toHaveTextContent("发送");
    expect(screen.getByTestId("locale")).toHaveTextContent("zh-CN");
    bare.unmount();

    render(
      <LanguageProvider initialLanguage="en">
        <Probe />
      </LanguageProvider>
    );
    expect(screen.getByTestId("send")).toHaveTextContent("Send");
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("② setLanguage 让所有消费者重渲染并更新 <html lang>", () => {
    render(
      <LanguageProvider initialLanguage="zh">
        <Probe />
      </LanguageProvider>
    );
    expect(screen.getByTestId("send")).toHaveTextContent("发送");
    expect(document.documentElement.lang).toBe("zh-CN");

    fireEvent.click(screen.getByRole("button", { name: "flip" }));
    expect(screen.getByTestId("send")).toHaveTextContent("Send");
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(document.documentElement.lang).toBe("en");

    fireEvent.click(screen.getByRole("button", { name: "flip" }));
    expect(screen.getByTestId("send")).toHaveTextContent("发送");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
