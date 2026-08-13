import type { JSX } from "preact";

import { Button, Chip } from "./components";

interface Props {
  secret: string;
  onDismiss: () => void;
  onNotice?: (message: string) => void;
}

/** The one-time credential handoff used by every token-issuing surface. */
export function TokenSecretPanel({ secret, onDismiss, onNotice }: Props): JSX.Element {
  const copySecret = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(secret);
      onNotice?.("Secret copied. Keep it somewhere safe; Marquee will not show it again.");
    } catch {
      onNotice?.("Copy was unavailable; select the secret manually before dismissing it.");
    }
  };

  return <section class="card token-secret-card" aria-live="polite">
    <header class="card-head"><h2>Copy your token secret</h2><Chip tone="warning">Shown once</Chip></header>
    <div class="card-body">
      <p class="token-secret-warning">This is the only time Marquee will show this secret. Store it in your password manager before dismissing this panel.</p>
      <code class="token-secret">{secret}</code>
      <div class="token-secret-actions"><Button variant="primary" type="button" onClick={() => void copySecret()}>Copy secret</Button><Button type="button" onClick={onDismiss}>I saved it</Button></div>
    </div>
  </section>;
}
