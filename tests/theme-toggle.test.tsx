// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, ThemeToggle, themeBootstrapScript } from "@/components/ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("defaults to light when nothing is stored and the OS has no dark preference", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "浅色" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "深色" })).toHaveAttribute("aria-pressed", "false");
  });

  it("applies and persists the dark choice", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "深色" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "深色" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches back to light and persists that too", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "深色" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "浅色" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("bootstrap script restores a stored theme before paint", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    // eslint-disable-next-line no-eval
    eval(themeBootstrapScript);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("bootstrap script ignores an unknown stored value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    // eslint-disable-next-line no-eval
    eval(themeBootstrapScript);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
