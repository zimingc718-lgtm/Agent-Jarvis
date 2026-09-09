"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
      className="dialog"
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop targets the dialog element itself.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog__head">
        <h2>{title}</h2>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="dialog__body">{children}</div>
    </dialog>
  );
}
