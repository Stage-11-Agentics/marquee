import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { apiFetch } from "./api-client";
import { initialsFor, primaryRole, roleLabel } from "./identity-format";
import { cacheOrgDefaultTheme } from "./theme";

export { initialsFor, primaryRole, roleLabel };

const AUTH_ME_ROUTE = "/api/v1/auth/me";
const LOGOUT_ROUTE = "/api/v1/auth/logout";
export const EVENT_NAME_CHANGED = "marquee:event-name-changed";

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

export interface AuthMeResponse {
  kind: "session" | "api_token";
  person_id?: string;
  memberships?: { event_id: string | null; role: string }[];
  scopes?: { permissions: string[]; event_ids: string[] };
  org_default_theme?: string | null;
  demo_event_id?: string | null;
  demo_event_name?: string | null;
  person_name?: string | null;
  person_email?: string | null;
  org_name?: string | null;
}

let authMeRequest: Promise<AuthMeResponse> | null = null;

/**
 * One boot payload, read once per page. Identity, the seat, and the conference
 * selection all want it, and three separate requests for the same answer is
 * three chances for them to disagree.
 */
export function loadAuthMe(): Promise<AuthMeResponse> {
  if (!authMeRequest) {
    authMeRequest = apiFetch<AuthMeResponse>(AUTH_ME_ROUTE, {
      headers: { accept: "application/json" },
      cache: "no-store",
      route: AUTH_ME_ROUTE,
    }).then((body) => {
      // `/org/settings` is deliberately admin-only. The authenticated boot
      // payload is the shell's shared seam, so reviewer and ops seats receive
      // the organization default before their next pre-paint visit too.
      cacheOrgDefaultTheme(body.org_default_theme ?? null);
      return body;
    }).catch((error: unknown) => {
      authMeRequest = null;
      throw error;
    });
  }
  return authMeRequest;
}

export function useIdentity(): Identity | null {
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await loadAuthMe();
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

/**
 * Shell chrome is mounted before any route module knows the event. Read the
 * same authenticated boot payload as identity so a renamed conference is
 * reflected in the breadcrumb and sidebar after the next navigation.
 */
export function useEventName(): string | null {
  const [eventName, setEventName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const onEventNameChanged = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (typeof name === "string") setEventName(name.trim() || null);
    };
    window.addEventListener(EVENT_NAME_CHANGED, onEventNameChanged);
    void loadAuthMe()
      .then((body) => {
        if (!cancelled) setEventName(body.demo_event_name?.trim() || null);
      })
      .catch(() => {
        // The shell stays usable with a neutral label when auth is unavailable.
      });
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT_NAME_CHANGED, onEventNameChanged);
    };
  }, []);
  return eventName;
}

/**
 * The organization's name, from the same boot payload. An organization-level
 * screen crumbs to the organization, not to whichever conference happens to be
 * selected — a page that outlives every conference should not name one.
 *
 * Null while the payload is in flight (and if it never arrives); the caller
 * shows a neutral word rather than a blank crumb.
 */
export function useOrgName(): string | null {
  const [orgName, setOrgName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadAuthMe()
      .then((body) => {
        if (!cancelled) setOrgName(body.org_name?.trim() || null);
      })
      .catch(() => {
        // Same contract as the conference name above: the shell stays usable.
      });
    return () => { cancelled = true; };
  }, []);
  return orgName;
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

/** The shared demo-event signal used by every destructive demo control. */
export function useDemoEventPresent(): boolean | null {
  const [present, setPresent] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadAuthMe()
      .then((body) => { if (!cancelled) setPresent(typeof body.demo_event_id === "string" && body.demo_event_id.length > 0); })
      .catch(() => { if (!cancelled) setPresent(false); });
    return () => { cancelled = true; };
  }, []);
  return present;
}
