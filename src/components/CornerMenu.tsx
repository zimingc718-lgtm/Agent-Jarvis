"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

/**
 * REQ-F-015 / DEC-014: a fixed bottom-left ☰ trigger that opens a non-modal
 * disclosure holding the app's chrome (theme toggle inline, 模型 / 账号登录 as
 * dialog launchers). It takes its items as children so it never has to know
 * their prop shapes; the modal <dialog>s they render escape to the top layer.
 *
 * CR-20260910-ui-foundation restyles this with tokens and a Lucide glyph but
 * deliberately keeps the hand-rolled disclosure rather than adopting the Radix
 * DropdownMenu that DEC-019 sketched. Two reasons, both measured in P3:
 *   1. Radix opens on `pointerdown`, which jsdom cannot synthesise (no
 *      PointerEvent), and @testing-library/user-event hangs on its portal path
 *      here — the approved TEST-032 assertions become untestable. P3 of
 *      CR-20260909-corner-menu had already chosen a custom disclosure for this
 *      same reason.
 *   2. The children are arbitrary chrome (a radio-style theme group, dialog
 *      launchers), not menu items, so DropdownMenu's roving-focus/typeahead
 *      semantics buy nothing here.
 * Every contract the CR froze — aria, Esc, light-dismiss, focus return,
 * z-index 20/30, the `children` boundary — is kept and still asserted.
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
    <div className="corner-menu fixed bottom-4 left-4 z-30 flex flex-col items-start gap-2" ref={rootRef}>
      {open ? (
        <div
          // CR-20260911-proactive-wake: seven sections outgrow a 720px viewport, which put the
          // topmost item (the theme toggle) above the screen edge and made it unclickable.
          // Cap the panel to the viewport and let it scroll; every entry stays reachable.
          className="corner-menu__panel flex w-64 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg"
          role="menu"
          aria-label="Agent-Jarvis 菜单"
        >
          {children}
        </div>
      ) : null}
      <button
        type="button"
        ref={triggerRef}
        className="corner-menu__trigger inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? "关闭菜单" : "打开菜单"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
      </button>
    </div>
  );
}
