import type { JSX } from "preact";

import { Card, CardBody, CardHeader, PageHeader } from "../shell/components";
import { SERVER_LEAD_COPY, ServerPanel } from "../setup/ServerPanel";
import "./settings.css";

/**
 * Standalone now; MRQ-207 can mount ServerPanel as the Instance/Server tab
 * body without copying its request, status, or recovery behavior.
 */
export function ServerPage(): JSX.Element {
  return <div class="server-page" data-org-settings-tab="server">
    <PageHeader title="Server" copy={SERVER_LEAD_COPY} />
    <ServerPanel />
    <Card>
      <CardHeader title="Recovery"><span class="subtle">No passwords, ever</span></CardHeader>
      <CardBody>
        <span class="subtle">Sign-in is an emailed link once email sending works. Locked out entirely? Re-running the setup command on the machine that deployed Marquee prints a fresh one-time claim link — proof of deploy is proof of ownership, and a used link is inert.</span>
      </CardBody>
    </Card>
  </div>;
}
