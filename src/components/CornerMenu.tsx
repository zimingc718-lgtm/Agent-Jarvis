"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * REQ-F-015 / DEC-014: a fixed bottom-left ☰ trigger that opens a non-modal
 * disclosure holding the app's chrome (theme toggle inline, 模型 / 账号登录 as
 * dialog launchers). It takes its items as children so it never has to know
 * their prop shapes; the modal <dialog>s they render escape to the top layer.
 * Popover mechanism (custom disclosure vs native `popover`) — P3 chose a custom
 * disclosure for jsdom testability and full control.
 */
export function CornerMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="corner-menu" ref={rootRef}>
      {open ? (
        <div className="corner-menu__panel" role="menu" aria-label="Agent-Jarvis 菜单">
          {children}
        </div>
      ) : null}
      <button
        type="button"
        ref={triggerRef}
        className="corner-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? "关闭菜单" : "打开菜单"}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">☰</span>
      </button>
    </div>
  );
}
