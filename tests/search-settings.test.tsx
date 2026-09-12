// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchSettings } from "@/components/SearchSettings";
import { USAGE_CHANGED_EVENT } from "@/lib/ui-events";

/**
 * TEST-094 ⑦ — search settings moved out of the drawer into a dialog; the drawer row
 * shows state and usage (REQ-F-053 ④; DEC-032 ⑥; TASK-091 ④). CR-20260911-display-console-ux.
 */
describe("TEST-094 ⑦ SearchSettings 入口 + 对话框 (REQ-F-053 ④)", () => {
  it("抽屉里只有入口行、状态摘要与用量；表单在对话框内，保存后状态行更新", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    render(
      <SearchSettings
        load={async () => ({ enabled: true, baseUrl: "http://127.0.0.1:8080" })}
        save={save}
        test={async () => ({ ok: true, message: "连接正常" })}
      />
    );

    await waitFor(() => expect(screen.getByText(/联网：开 · 127\.0\.0\.1:8080/)).toBeInTheDocument());
    // The form is not on the drawer surface: it lives inside a closed <dialog>, which is
    // how every other settings entry here works (the native element hides its content).
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(screen.getByLabelText("搜索服务地址").closest("dialog")).not.toBeNull();
    expect(screen.getByText(/本会话用量：尚无数据/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "搜索设置" }));
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "搜索设置" })).toBeInTheDocument();

    const url = screen.getByLabelText("搜索服务地址") as HTMLInputElement;
    fireEvent.change(url, { target: { value: "http://localhost:9000" } });
    fireEvent.blur(url);
    // `browserFallback` rides along on every save, so changing the URL cannot silently
    // reset the browser channel (CR-20260911-web-reading, REQ-F-057 ④).
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ enabled: true, baseUrl: "http://localhost:9000", browserFallback: true })
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存。"));
    expect(screen.getByText(/联网：开 · localhost:9000/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("连接正常"));

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("TEST-099 ⑨: 浏览器回退是独立开关，默认开，可关闭并持久化 (REQ-F-057 ④)", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    render(
      <SearchSettings
        load={async () => ({ enabled: true, baseUrl: "http://127.0.0.1:8080", browserFallback: true })}
        save={save}
        test={async () => ({ ok: true, message: "ok" })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "搜索设置" }));
    const toggle = await screen.findByRole("switch", { name: "被拦截时用浏览器重试" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ enabled: true, baseUrl: "http://127.0.0.1:8080", browserFallback: false })
    );
    // The limit is stated where the switch is, so nobody expects it to defeat Cloudflare.
    expect(screen.getByText(/Cloudflare 一类人机校验仍读不到/)).toBeInTheDocument();
  });

  it("用量事件更新抽屉里的只读行", async () => {
    render(<SearchSettings load={async () => ({ enabled: false, baseUrl: "" })} save={async () => ({ ok: true })} test={async () => ({ ok: true, message: "" })} />);
    await waitFor(() => expect(screen.getByText(/联网：关 · 未设地址/)).toBeInTheDocument());
    fireEvent(window, new CustomEvent(USAGE_CHANGED_EVENT, { detail: { inputTokens: 120, outputTokens: 30, estimated: true } }));
    await waitFor(() => expect(screen.getByText(/输入 120 \/ 输出 30 tokens（估算）/)).toBeInTheDocument());
  });
});
