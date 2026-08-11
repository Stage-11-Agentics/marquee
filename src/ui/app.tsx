import { hydrate, render } from "preact";
import "../styles/tokens.css";
import "../styles/components.css";
import { AppShell } from "./shell/AppShell";
import { PublicForm } from "./public/form/PublicForm";
import type { PublicFormState } from "../routes/public-form.types";

const root = document.getElementById("app");
if (!root) throw new Error("Marquee app root is missing");

// Public pages arrive complete from their SSR route. The client entry still
// loads the shared tokens/component CSS, but must not replace those pages with
// the admin shell. This also keeps an iframe independent of mq_session.
const isPublicPage =
  window.location.pathname === "/" ||
  window.location.pathname.startsWith("/f/") ||
  window.location.pathname === "/agenda" ||
  window.location.pathname.startsWith("/s/") ||
  window.location.pathname.startsWith("/p/") ||
  window.location.pathname.startsWith("/embed/") ||
  /^\/[^/]+\/(?:agenda|speakers)\/embed\/?$/.test(window.location.pathname);

if (window.location.pathname.startsWith("/f/")) {
  const stateElement = document.getElementById("public-form-state");
  if (stateElement?.textContent) {
    hydrate(<PublicForm initial={JSON.parse(stateElement.textContent) as PublicFormState} />, root);
  }
} else if (!isPublicPage) render(<AppShell />, root);
