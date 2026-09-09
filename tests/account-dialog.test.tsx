// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountDialog } from "@/components/AccountDialog";

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "账号登录" }));
  return document.querySelector("dialog") as HTMLDialogElement;
}

describe("AccountDialog", () => {
  it("is closed until the account button is pressed", () => {
    render(<AccountDialog authenticated googleOAuth={{ configured: true, missing: [] }} />);

    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(openDialog().hasAttribute("open")).toBe(true);
  });

  it("shows sign out and the authorization boundary for a signed-in user", () => {
    render(<AccountDialog authenticated googleOAuth={{ configured: true, missing: [] }} />);
    openDialog();

    expect(screen.getByText("已登录 Agent-Jarvis。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/api/auth/signout");
    expect(screen.getByText(/Agent-Jarvis 账号 ≠ 模型授权/)).toBeInTheDocument();
  });

  it("offers Google sign-in only when OAuth is configured", () => {
    render(<AccountDialog authenticated={false} googleOAuth={{ configured: true, missing: [] }} />);
    openDialog();

    expect(screen.getByText("尚未登录 Agent-Jarvis。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/api/auth/signin");
  });

  it("shows the missing OAuth configuration instead of a sign-in link", () => {
    render(
      <AccountDialog
        authenticated={false}
        googleOAuth={{ configured: false, missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }}
      />
    );
    openDialog();

    expect(screen.getByText("Google OAuth configuration required")).toBeInTheDocument();
    expect(screen.getByText("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("closes again from the dialog close button", () => {
    render(<AccountDialog authenticated googleOAuth={{ configured: true, missing: [] }} />);
    const dialog = openDialog();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(dialog.hasAttribute("open")).toBe(false);
  });
});
