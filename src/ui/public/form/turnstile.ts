/**
 * The Turnstile widget's lifecycle, kept out of the form component so the two
 * things that made the public form unusable are directly testable.
 *
 * The script is loaded with `render=explicit`, which means Cloudflare renders
 * nothing on its own: a widget exists only once `render()` has been called and
 * has handed back an id. Until then the container is empty, `getResponse()`
 * throws, and — the defect this module exists to make impossible — `reset()`
 * throws too, taking down whatever flow called it.
 */

export interface TurnstileApi {
  render?: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  reset?: (widgetId?: string) => void;
  remove?: (widgetId: string) => void;
}

/**
 * Cleanup only, and it must stay that way. Every call site sits in front of the
 * message that explains what went wrong, so a throw here does not merely fail —
 * it silently swallows the explanation and leaves the person staring at a form
 * that will not move. A widget that never mounted is nothing to reset, not an
 * error. Returns whether a reset was actually delivered, for callers that care.
 */
export function resetTurnstileWidget(api: TurnstileApi | undefined, widgetId: string | null): boolean {
  try {
    if (typeof api?.reset !== "function") return false;
    if (widgetId) api.reset(widgetId);
    else api.reset();
    return true;
  } catch {
    return false;
  }
}

/** Retire a widget for good. Removing one that is already gone is not an error. */
export function removeTurnstileWidget(api: TurnstileApi | undefined, widgetId: string | null): boolean {
  try {
    if (typeof api?.remove !== "function" || !widgetId) return false;
    api.remove(widgetId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mount the widget the explicit-render script will not mount by itself.
 * Returns the widget id, or null when the script has not arrived yet — in
 * which case the caller is expected to try again from the script's onload.
 */
export function renderTurnstileWidget(
  api: TurnstileApi | undefined,
  container: HTMLElement | null,
  options: { sitekey: string; onToken: (token: string) => void },
): string | null {
  if (!container || typeof api?.render !== "function") return null;
  try {
    return api.render(container, {
      sitekey: options.sitekey,
      callback: options.onToken,
      "expired-callback": () => options.onToken(""),
      "error-callback": () => options.onToken(""),
    }) ?? null;
  } catch {
    return null;
  }
}
