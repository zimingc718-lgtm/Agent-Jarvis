"use client";

import { KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

/**
 * REQ-F-015 / REQ-F-053 / DEC-014 / DEC-032 ⑤: a fixed bottom-left ☰ trigger that opens a
 * left-hand **drawer** holding the app's chrome. It takes its items as children so it
 * never has to know their prop shapes; the modal <dialog>s they render escape to the
 * top layer.
 *
 * CR-20260911-display-console-ux turned the popover into a drawer. Measured at three
 * viewports, the 256px popover had no height bound and no collision handling: at
 * 1024×700 its top was clipped 26px off-screen and it overlapped the chat by 144px; on
 * a phone it covered the input entirely (EV-2026-09-11-display-console-ux §2). A
 * full-height drawer with its own scrolling and a backdrop removes both problems at
 * once, and lets the menu carry seven groups without growing past the screen.
 *
 * Still hand-rolled rather than Radix Dialog, for the reason DEC-014 recorded: jsdom
 * cannot synthesise the pointer events Radix opens on, and the approved TEST-032
 * assertions read the DOM directly. The contracts the earlier CRs froze — a real
 * <button> trigger with aria attributes, Escape, light-dismiss, focus return, z-index
 * 20/30, the `children` boundary — are kept; `role` moved from `menu` to `dialog`
 * because the content is chrome and forms, not menu items.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CornerMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
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
    // Focus lands inside the drawer so keyboard users start where the content is.
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** REQ-F-053 ⑥: Tab cycles inside the drawer (the trigger is included as the last stop). */
  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !rootRef.current) {
      return;
    }
    // Everything focusable inside the root: the drawer's contents plus the trigger. The
    // drawer is conditionally rendered, so nothing here is hidden and no visibility
    // filter is needed (jsdom reports `offsetParent` as null for everything, which is
    // exactly the kind of filter that silently disables a trap in tests).
    const focusable = [...rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="corner-menu fixed bottom-4 left-4 z-30 flex flex-col items-start gap-2"
      ref={rootRef}
      onKeyDown={open ? trapTab : undefined}
    >
      {open ? (
        <>
          {/* Backdrop: a click anywhere off the drawer closes it (light-dismiss kept). */}
          <div
            className="corner-menu__backdrop fixed inset-0 bg-foreground/20 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
            aria-hidden="true"
            onMouseDown={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            className="corner-menu__panel fixed inset-y-0 left-0 flex w-[min(320px,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto overscroll-contain border-r border-border bg-popover p-3 pb-24 text-popover-foreground shadow-xl motion-safe:animate-in motion-safe:slide-in-from-left motion-safe:duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="Agent-Jarvis 菜单"
          >
            {children}
          </div>
        </>
      ) : null}
      <button
        type="button"
        ref={triggerRef}
        className="corner-menu__trigger relative inline-flex size-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={open ? "关闭菜单" : "打开菜单"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
      </button>
    </div>
  );
}
