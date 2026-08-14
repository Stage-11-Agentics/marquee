import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { onForbidden } from "./api-client";
import { Button } from "./components";
import { loadAuthMe, type AuthMeResponse } from "./identity";

/** SPEC §4.1 ranks roles public < speaker < reviewer < ops < program_lead < owner. */
const PROGRAM_STAFF_ROLES = new Set(["ops", "program_lead", "owner"]);

type AuthMe = Pick<AuthMeResponse, "kind" | "memberships" | "scopes">;

export type SeatKind = "unknown" | "program_staff" | "reviewer" | "speaker";

function seatFromAuth(auth: AuthMe): SeatKind {
  if (auth.kind === "api_token") return auth.scopes?.permissions.includes("program:read") ? "program_staff" : "speaker";
  const roles = (auth.memberships ?? []).map((membership) => membership.role);
  if (roles.some((role) => PROGRAM_STAFF_ROLES.has(role))) return "program_staff";
  if (roles.includes("reviewer")) return "reviewer";
  return "speaker";
}

/**
 * The organizer shell is only drawn for a seat that can use it.
 *
 * Role alone is not enough to decide that: a form administrator holds no
 * program-staff role yet legitimately reads the draft queue. So the shell is
 * withdrawn only when both signals agree — the seat carries no program-staff
 * role *and* a route has actually refused it data. Either signal alone leaves
 * the shell exactly as it was.
 */
export function useSeat(): { seat: SeatKind; blocked: boolean } {
  const [seat, setSeat] = useState<SeatKind>("unknown");
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAuthMe()
      .then((auth: AuthMe) => { if (!cancelled) setSeat(seatFromAuth(auth)); })
      // An unreadable identity is not evidence of a downgrade; leave the shell alone.
      .catch(() => { /* keep "unknown" */ });
    return () => { cancelled = true; };
  }, []);

  // Sticky for the session: once a seat has been refused, every later admin
  // route it reaches renders its own answer straight away rather than flashing
  // a navigation it cannot use.
  useEffect(() => onForbidden(() => setRefused(true)), []);

  return { seat, blocked: refused && (seat === "speaker" || seat === "reviewer") };
}

export function SeatBlockedPage({ seat, navigate }: { seat: SeatKind; navigate: (target: string) => void }): JSX.Element {
  const home = seat === "reviewer"
    ? { path: "/reviewer", label: "Open your reviewer home" }
    : { path: "/portal", label: "Open your speaker portal" };
  return <div class="seat-blocked">
    <header class="seat-blocked-head">
      <span class="brand-mark">M</span>
      <span class="brand-name">Marquee</span>
    </header>
    <main class="seat-blocked-card">
      <h1>Your account does not have access to this.</h1>
      <p>This is a program team surface. Ask a program lead to grant access, or carry on with the work that is yours.</p>
      <div class="seat-blocked-actions">
        <Button variant="primary" onClick={() => navigate(home.path)}>{home.label}</Button>
        <a class="button" href="/agenda">View the agenda</a>
      </div>
    </main>
  </div>;
}
