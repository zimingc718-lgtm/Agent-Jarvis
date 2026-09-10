"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type DialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Thin wrapper over the native <dialog> element: the platform gives us the
 * backdrop, focus trap, Esc-to-close and focus restore for free, so no
 * dependency is needed. jsdom does not implement showModal/close, so the
 * `open` attribute is toggled directly when those methods are missing.
 *
 * CR-20260910-ui-foundation restyles this with tokens and the Button primitive
 * but keeps the native element rather than the Radix Dialog DEC-019 sketched:
 * the platform already supplies exactly the focus behaviour TEST-049 ③ asks
 * for, and the approved TEST-032 / account-dialog assertions read
 * `document.querySelector("dialog")` and its `open` attribute directly.
 */
export function Dialog({ open, title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open) {
      if (typeof el.showModal === "function") {
        if (!el.open) el.showModal();
      } else {
        el.setAttribute("open", "");
      }
    } else if (typeof el.close === "function") {
      if (el.open) el.close();
    } else {
      el.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      className={[
        "dialog w-[min(36rem,calc(100vw-2rem))] max-w-none rounded-lg border border-border bg-card p-0 text-card-foreground shadow-xl",
        "backdrop:bg-foreground/40",
        // Long forms scroll inside the dialog instead of pushing it off-screen.
        "max-h-[min(42rem,calc(100vh-4rem))] overflow-hidden",
      ].join(" ")}
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop targets the dialog element itself.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog__head flex items-center justify-between gap-4 px-5 py-4">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <Separator />
      <div className="dialog__body max-h-[calc(min(42rem,100vh-4rem)-4.5rem)] overflow-y-auto px-5 py-4">
        {children}
      </div>
    </dialog>
  );
}
