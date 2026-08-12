import type { JSX } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";

import { apiFetch, errorSummary } from "../shell/api-client";
import { Button, Card, CardBody, CardHeader, Chip } from "../shell/components";
import "./setup.css";

/**
 * Everyone who can run this instance, and how the next one gets in.
 *
 * An invite is a link — one person, one use, seven days — and it never depends
 * on mail, so a co-organizer can join an instance that cannot yet send a single
 * message (ruling D7). Once mail is configured the modal merely OFFERS to send
 * the same link; nothing about the invite changes.
 *
 * Removal ends access now and keeps the record: their reviews and decisions
 * stay attributed. The last owner cannot be removed, and the server is what
 * enforces that — this screen only explains it (AC-283).
 */

export const MEMBERS_ROUTE = "/api/v1/org/members";
export const INVITES_ROUTE = "/api/v1/org/invites";
const INVITE_ITEM_ROUTE = "/api/v1/org/invites/{inviteId}";
const MEMBER_ITEM_ROUTE = "/api/v1/org/members/{personId}";

interface Member {
  person_id: string;
  name: string;
  email: string;
  role: string;
  is_you: boolean;
}

interface Invite {
  id: string;
  created_at: number;
  expires_at: number;
}

interface MintedInvite {
  invite_url: string;
  mail_configured: boolean;
}

function expiryLabel(expiresAt: number): string {
  const days = Math.max(0, Math.round((expiresAt - Date.now()) / 86_400_000));
  return `single use · expires in ${days} day${days === 1 ? "" : "s"}`;
}

export function OrganizersCard(): JSX.Element {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [minted, setMinted] = useState<MintedInvite | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [memberBody, inviteBody] = await Promise.all([
        apiFetch<{ data: Member[] }>(MEMBERS_ROUTE, { route: MEMBERS_ROUTE }),
        apiFetch<{ data: Invite[] }>(INVITES_ROUTE, { route: INVITES_ROUTE }),
      ]);
      setMembers(memberBody.data);
      setInvites(inviteBody.data);
    } catch (caught) {
      setStatus(errorSummary(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const mintInvite = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      const created = await apiFetch<MintedInvite>(INVITES_ROUTE, {
        method: "POST",
        route: INVITES_ROUTE,
      });
      setMinted(created);
      await load();
    } catch (caught) {
      setStatus(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (inviteId: string): Promise<void> => {
    setBusy(true);
    try {
      await apiFetch(`${INVITES_ROUTE}/${encodeURIComponent(inviteId)}`, {
        method: "DELETE",
        route: INVITE_ITEM_ROUTE,
      });
      setStatus("Invite link revoked · it can no longer be used.");
      await load();
    } catch (caught) {
      setStatus(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  const removeOrganizer = async (member: Member): Promise<void> => {
    const confirmed = window.confirm(
      `Remove ${member.name}?\n\nTheir reviews, decisions, and sent mail stay on the record. Their access ends now, and any sign-in link already in their inbox stops working.`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await apiFetch(`${MEMBERS_ROUTE}/${encodeURIComponent(member.person_id)}`, {
        method: "DELETE",
        route: MEMBER_ITEM_ROUTE,
      });
      setStatus(`${member.name} removed · their work stays on the record.`);
      await load();
    } catch (caught) {
      setStatus(errorSummary(caught));
    } finally {
      setBusy(false);
    }
  };

  return <Card>
    <CardHeader title="Organizers">
      <span class="subtle">Everyone who can run this instance · invites are links, never dependent on mail</span>
    </CardHeader>
    <CardBody>
      <div class="organizer-rows">
        {members.length === 0 && invites.length === 0 && <div class="organizer-row">
          <span class="organizer-name">No organizers yet<small>Claiming the instance creates the first owner</small></span>
          <span class="organizer-email">—</span>
          <Chip>—</Chip>
          <span class="organizer-action">—</span>
        </div>}
        {members.map((member) => <div key={member.person_id} class="organizer-row">
          <span class="organizer-name">{member.name}{member.is_you && <small>You</small>}</span>
          <span class="organizer-email">{member.email}</span>
          <Chip tone="success">{member.role}</Chip>
          <span class="organizer-action">
            {member.is_you && members.length === 1
              ? <span class="instance-fix-blank">—</span>
              : <Button small onClick={() => void removeOrganizer(member)} disabled={busy}>Remove</Button>}
          </span>
        </div>)}
        {invites.map((invite) => <div key={invite.id} class="organizer-row">
          <span class="organizer-name">Invite link minted<small>{expiryLabel(invite.expires_at)}</small></span>
          <span class="organizer-email">—</span>
          <Chip tone="warning">Pending</Chip>
          <span class="organizer-action">
            <Button small onClick={() => void revokeInvite(invite.id)} disabled={busy}>Revoke</Button>
          </span>
        </div>)}
      </div>

      {minted && <div class="organizer-invite">
        <p class="subtle">
          One link, one person, one use. They open it, confirm their name and email, and have a
          session — the same pattern that claimed this instance, so it works before mail does.
        </p>
        <div class="setup-token-line">
          <code class="setup-token">{minted.invite_url}</code>
          <Button onClick={() => void navigator.clipboard?.writeText(minted.invite_url)}>Copy link</Button>
        </div>
        <span class="subtle">
          {minted.mail_configured
            ? "Send it on any channel you share — or have Marquee email it."
            : "Send it on any channel you already share. Once mail is configured, Marquee can send it for you."}
        </span>
      </div>}

      <div class="instance-foot">
        <span class="setup-error" role="status" aria-live="polite">{status}</span>
        <Button variant="primary" onClick={() => void mintInvite()} disabled={busy}>
          + Invite additional organizer
        </Button>
      </div>
    </CardBody>
  </Card>;
}
