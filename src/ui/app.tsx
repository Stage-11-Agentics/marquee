import { render } from "preact";
import "../styles/tokens.css";
import "../styles/components.css";
import { AppShell } from "./shell/AppShell";

const root = document.getElementById("app");
if (!root) throw new Error("Marquee app root is missing");
render(<AppShell />, root);
