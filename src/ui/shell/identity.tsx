import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { apiFetch } from "./api-client";
import { initialsFor, primaryRole, roleLabel } from "./identity-format";

export { initialsFor, primaryRole, roleLabel };

const AUTH_ME_ROUTE = "/api/v1/auth/me";
const LOGOUT_ROUTE = "/api/v1/auth/logout";

/**
 * The demo hands out an owner session and a speaker session from the same
 * landing page, onto the same cookie. Without a name on screen the two are
 * indistinguishable once you are inside, which is exactly the moment a judge
 * comparing both demos needs to know which one they are looking at.
 */
export interface Identity {
  name: string;
  email: string | null;
  role: string;
  initials: string;
}

interface AuthMeResponse {
  kind: "session" | "api_token";
  person_id?: string;
  memberships?: { event_id: string | null; role: string }[];
  person_name?: string | null;
  person_email?: string | null;
}

export function useIdentity(): Identity | null {
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await apiFetch<AuthMeResponse>(AUTH_ME_ROUTE, {
          headers: { accept: "application/json" },
          cache: "no-store",
          route: AUTH_ME_ROUTE,
        });
        if (cancelled || body.kind !== "session") return;
        const name = body.person_name?.trim() || body.person_email?.trim() || "";
        if (!name) return;
        setIdentity({
          name,
          email: body.person_email ?? null,
          role: roleLabel(primaryRole(body.memberships)),
          initials: initialsFor(name),
        });
      } catch {
        // The shell is not the place to shout about this: a failed identity read
        // leaves the reserved slot showing its placeholder and every other
        // surface keeps working. Sign-out stays reachable regardless.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return identity;
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch(LOGOUT_ROUTE, { method: "POST", route: LOGOUT_ROUTE });
  } catch {
    // A session the server has already forgotten is still a session the person
    // wants to leave. Send them to the door either way.
  }
  window.location.assign("/");
}

export function AccountMenu({ identity, onClose }: { identity: Identity | null; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !ref.current?.contains(target) && !(target as HTMLElement).closest?.(".top-user")) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose]);

  const leave = useCallback(() => { setLeaving(true); void signOut(); }, []);

  return <div ref={ref} class="account-menu" role="menu" aria-label="Account">
    <div class="account-identity">
      <strong>{identity?.name ?? "—"}</strong>
      <span class="subtle">{identity?.email ?? "—"}</span>
      <span class="account-role">{identity?.role ?? "Signed in"}</span>
    </div>
    <button type="button" class="account-action" role="menuitem" onClick={leave} disabled={leaving} data-sign-out>
      {leaving ? "Signing out…" : "Sign out"}
    </button>
  </div>;
}
