import { hydrate, render } from "preact";
import type { JSX } from "preact";
import "../styles/tokens.css";
import "../styles/components.css";
import { AppShell } from "./shell/AppShell";
import { installErrorReporting } from "./shell/error-reporting";
import { DeliveryHealthShell } from "./health/DeliveryHealthShell";
import { PublicForm } from "./public/form/PublicForm";
import type { PublicFormState } from "../routes/public-form.types";
import { useEventName } from "./shell/identity";
import { EventProvider, useEventContext } from "./shell/event-context";

const root = document.getElementById("app");
if (!root) throw new Error("Marquee app root is missing");

// Errors on public pages matter as much as errors in the admin shell — a broken
// submission form is the failure a conference can least afford — so the
// reporter is installed before either branch below decides what to render.
installErrorReporting();

// Public pages arrive complete from their SSR route. The client entry still
// loads the shared tokens/component CSS, but must not replace those pages with
// the admin shell. This also keeps an iframe independent of mq_session.
const isPublicPage =
  window.location.pathname === "/" ||
  window.location.pathname.startsWith("/f/") ||
  window.location.pathname === "/agenda" ||
  window.location.pathname === "/agenda/agents" ||
  window.location.pathname === "/speakers" ||
  window.location.pathname.startsWith("/s/") ||
  window.location.pathname.startsWith("/p/") ||
  window.location.pathname.startsWith("/embed/") ||
  /^\/[^/]+\/(?:agenda|speakers)\/embed\/?$/.test(window.location.pathname);

/**
 * The conference context wraps BOTH render roots, and it has to: the delivery
 * health pages are a separate root entirely, and `AppShell` answers the portal,
 * co-speaker and reviewer routes before it draws its own layout. A provider
 * mounted inside that layout would reach neither.
 */
function ShellEntry({ health = false }: { health?: boolean }): JSX.Element {
  return <EventProvider><ShellBody health={health} /></EventProvider>;
}

function ShellBody({ health }: { health: boolean }): JSX.Element {
  const { event } = useEventContext();
  // The boot payload still names the demo conference, which is what keeps the
  // sidebar from flashing a placeholder while the events list is in flight.
  const bootName = useEventName();
  const eventName = event?.name ?? bootName ?? "Conference";
  return health
    ? <DeliveryHealthShell eventName={eventName} />
    : <AppShell eventName={eventName} />;
}

if (window.location.pathname.startsWith("/f/")) {
  const stateElement = document.getElementById("public-form-state");
  if (stateElement?.textContent) {
    hydrate(<PublicForm initial={JSON.parse(stateElement.textContent) as PublicFormState} />, root);
  }
} else if (window.location.pathname === "/delivery-health") {
  render(<ShellEntry health />, root);
} else if (!isPublicPage) render(<ShellEntry />, root);
