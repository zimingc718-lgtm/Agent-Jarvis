// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DisplayScreen } from "@/components/DisplayScreen";

/**
 * TEST-093 ④⑤ — the display screen wraps insight HTML and follows the host theme
 * (REQ-F-052 ②④; DEC-032 ④; TASK-090 ②). CR-20260911-display-console-ux.
 */

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

const insight = { kind: "insight", refId: "i1", html: "<div><h1>报告</h1><table><tr><td>a</td></tr></table></div>" };

describe("TEST-093 DisplayScreen 外壳与主题 (REQ-F-052)", () => {
  it("④ srcDoc 是包了基础样式的文档，并在 data-theme 变为 dark 后重建", async () => {
    const { container } = render(<DisplayScreen initial={insight} fetchView={async () => insight} />);
    const frame = container.querySelector("iframe.display-screen__frame") as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("srcdoc")).toContain('data-theme="light"');
    expect(frame.getAttribute("srcdoc")).toContain('<style id="jarvis-base">');
    expect(frame.getAttribute("srcdoc")).toContain(insight.html);

    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await waitFor(() => expect(frame.getAttribute("srcdoc")).toContain('data-theme="dark"'));
  });

  it("⑤ 提示条仍在、不可关闭；iframe 已沙箱化且未交还同源（REQ-F-101 ①②，DEC-080 ①）", () => {
    const { container } = render(<DisplayScreen initial={insight} fetchView={async () => insight} />);
    const notice = container.querySelector(".display-screen__notice");
    expect(notice).toBeTruthy();
    expect(notice?.querySelector("button")).toBeNull();

    const frame = container.querySelector("iframe.display-screen__frame") as HTMLIFrameElement;
    // ① There is a sandbox at all. This assertion replaces its own inverse: the previous
    // version locked in the unsandboxed state recorded as an accepted risk (DEC-015).
    expect(frame.hasAttribute("sandbox")).toBe(true);
    const tokens = (frame.getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean);
    // ② The one token that would undo it. `allow-scripts allow-same-origin` together let
    // the framed document reach this app's origin — same storage, same session — which is
    // precisely the last link of the injection chain this closes. Scripts alone are fine:
    // an opaque origin has its own empty storage and no credentials.
    expect(tokens).not.toContain("allow-same-origin");
    expect(tokens).toContain("allow-scripts");
  });

  it("首页视图不渲染 iframe", () => {
    const home = { kind: "home", refId: null, html: null };
    const { container } = render(<DisplayScreen initial={home} fetchView={async () => home} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".display-screen--home h1")?.textContent).toBe("Agent-Jarvis");
  });
});
