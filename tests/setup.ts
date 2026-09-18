import "@testing-library/jest-dom/vitest";

/*
 * jsdom shims for the Radix primitives introduced by CR-20260910-ui-foundation
 * (DEC-019). Radix measures and captures pointers on open; jsdom implements
 * none of it. Without these, every menu/dialog/tooltip test throws before it
 * can assert anything.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

/*
 * jsdom has no PointerEvent constructor at all. `@testing-library/dom`'s
 * fireEvent.pointerDown/Up/Move falls back to `window.Event` when it's missing
 * (see its createEvent: `window[EventType] || window.Event`) — a plain Event's
 * constructor silently drops MouseEvent/PointerEvent-only init fields like
 * `button`/`ctrlKey`, so Radix's trigger handlers (which gate open/close on
 * `event.button === 0`) never see a match and the menu never opens. Radix's
 * own primitives only read the MouseEvent-shaped fields here, so subclassing
 * MouseEvent with the extra pointer fields defaulted is enough.
 */
if (typeof globalThis.PointerEvent === "undefined" && typeof MouseEvent !== "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    width: number;
    height: number;
    pressure: number;
    tangentialPressure: number;
    tiltX: number;
    tiltY: number;
    twist: number;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
      this.width = params.width ?? 1;
      this.height = params.height ?? 1;
      this.pressure = params.pressure ?? 0;
      this.tangentialPressure = params.tangentialPressure ?? 0;
      this.tiltX = params.tiltX ?? 0;
      this.tiltY = params.tiltY ?? 0;
      this.twist = params.twist ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

if (typeof globalThis.DOMRect === "undefined") {
  globalThis.DOMRect = class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0
    ) {}
    top = 0;
    left = 0;
    right = 0;
    bottom = 0;
    static fromRect() {
      return new globalThis.DOMRect();
    }
    toJSON() {
      return {};
    }
  } as unknown as typeof DOMRect;
}
