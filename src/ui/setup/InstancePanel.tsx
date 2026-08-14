import type { JSX } from "preact";

import { ServerPanel } from "./ServerPanel";

/**
 * Compatibility wrapper for the cold-start dashboard. The panel is now named
 * Server everywhere, but setup keeps its demo-removal behavior and import seam.
 */
export { INSTANCE_STATUS_ROUTE, REMOVE_DEMO_ROUTE } from "./ServerPanel";

export function InstancePanel(): JSX.Element {
  return <ServerPanel showDemoControls />;
}
