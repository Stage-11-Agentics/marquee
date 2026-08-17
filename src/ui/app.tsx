import { hydrate, render } from "preact";
import type { JSX } from "preact";
import "../styles/tokens.css";
import "../styles/components.css";
import "../styles/wide-grid.css";
// Register themes (theme round): every rule scoped under html[data-theme="…"],
// so bundling all three keeps them orthogonal to each other and to Day/Night.
import "../styles/themes/latent-space.css";
import "../styles/themes/ai-engineer.css";
import "../styles/themes/swyxy.css";
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
  window.location.pathname === "/signin" ||
  window.location.pathname === "/login" ||
  window.location.pathname === "/sign-in" ||
  window.location.pathname === "/my-proposals" ||
  window.location.pathname === "/my-submissions" ||
  window.location.pathname === "/proposals" ||
  window.location.pathname.startsWith("/claim/") ||
  window.location.pathname.startsWith("/join/") ||
  window.location.pathname.startsWith("/f/") ||
  window.location.pathname === "/agenda" ||
  window.location.pathname === "/agenda/agents" ||
  window.location.pathname === "/speakers" ||
  window.location.pathname.startsWith("/s/") ||
  window.location.pathname.startsWith("/p/") ||
  window.location.pathname.startsWith("/embed/") ||
  /^\/[^/]+\/(?:agenda|sessions|speakers|cfp)\/embed\/?$/.test(window.location.pathname);

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

// A server-rendered answer that owns its own document marks its root. The 404
// page is the first: it is served at an arbitrary URL, so no path predicate can
// recognise it, and mounting the admin shell over it would replace an honest
// answer with "Route not found" under a session-expired modal — on the one page
// most likely to be reached by someone with no session at all.
const isServerRenderedPage = root.dataset.marqueePage !== undefined;

if (window.location.pathname.startsWith("/f/")) {
  const stateElement = document.getElementById("public-form-state");
  if (stateElement?.textContent) {
    hydrate(<PublicForm initial={JSON.parse(stateElement.textContent) as PublicFormState} />, root);
  }
} else if (window.location.pathname === "/delivery-health") {
  render(<ShellEntry health />, root);
} else if (!isPublicPage && !isServerRenderedPage) render(<ShellEntry />, root);
