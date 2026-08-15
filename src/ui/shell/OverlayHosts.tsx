import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

export interface OverlayState {
  kind: "modal" | "drawer";
  title: string;
  copy: string;
}

function visibleDialogControls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter((control) => {
      if (control.hasAttribute("hidden") || control.getAttribute("aria-hidden") === "true" || control.matches(":disabled")) return false;
      const style = window.getComputedStyle(control);
      if (style.display === "none" || style.visibility === "hidden") return false;
      // checkVisibility covers content hidden by an ancestor in modern browsers;
      // the style checks above keep this usable in happy-dom and older WebViews.
      const checkVisibility = (control as HTMLElement & { checkVisibility?: (options?: { checkOpacity?: boolean; checkVisibilityCSS?: boolean }) => boolean }).checkVisibility;
      return typeof checkVisibility !== "function" || checkVisibility.call(control, { checkOpacity: false, checkVisibilityCSS: true });
    });
}

export function useDialogLifecycle(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !ref.current) return;
      const controls = visibleDialogControls(ref.current);
      if (controls.length === 0) { event.preventDefault(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [open, onClose]);
  return ref;
}

export function OverlayHost({ state, onClose, children }: { state: OverlayState | null; onClose: () => void; children?: ComponentChildren }): JSX.Element | null {
  const ref = useDialogLifecycle(Boolean(state), onClose);
  if (!state) return null;
  const body = <><header class={state.kind === "modal" ? "modal-head" : "drawer-head"}><div><div class="eyebrow">Not installed</div><h2>{state.title}</h2><p>{state.copy}</p></div></header><div class={state.kind === "modal" ? "modal-body" : "drawer-content"}>{children}<p class="subtle">This shell affordance is ready; its owning module has not landed yet.</p></div><footer class="modal-actions"><button class="button primary" onClick={onClose}>Close</button></footer></>;
  if (state.kind === "drawer") return <><button class="drawer-backdrop" aria-label="Close drawer" onClick={onClose} /><aside ref={ref} class="drawer" role="dialog" aria-modal="true" aria-label={state.title} tabIndex={-1}>{body}</aside></>;
  return <div class="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={ref} class="modal" role="dialog" aria-modal="true" aria-label={state.title} tabIndex={-1}>{body}</section></div>;
}

export const TOAST_EVENT = "marquee:toast";

/**
 * A receipt from a screen that is about to be navigated away from.
 *
 * "Created, and here is exactly what came with it" has to survive the
 * navigation that follows it, and the screen that earned the message is
 * unmounted by then. The toast host outlives it, so the message is announced
 * to the shell rather than held by the page.
 */
export function announce(message: string): void {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

export function ToastHost({ message }: { message?: string }): JSX.Element {
  return <div class={`toast ${message ? "show" : ""}`} role="status" aria-live="polite">{message}</div>;
}
