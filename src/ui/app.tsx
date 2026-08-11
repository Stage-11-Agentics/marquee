import { render } from "preact";
import "../styles/tokens.css";
import "../styles/components.css";
import { AppShell } from "./shell/AppShell";

const root = document.getElementById("app");
if (!root) throw new Error("Marquee app root is missing");

// Public pages arrive complete from their SSR route. The client entry still
// loads the shared tokens/component CSS, but must not replace the landing
// markup with the admin shell at `/`.
if (window.location.pathname !== "/") render(<AppShell />, root);
