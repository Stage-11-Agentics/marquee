import type { JSX } from "preact";

export interface SubmissionCapacityPatch {
  per_submitter_limit?: number;
  submitter_limit_inherit?: boolean;
}

interface Props {
  inherit: boolean;
  rawLimit: number;
  effectiveLimit: number;
  onChange: (patch: SubmissionCapacityPatch) => void;
}

/**
 * The builder shows the effective value first. It can clear an override or
 * choose a finite override, but it never offers 0 as a new input value: 0 is a
 * legacy read-path state preserved by the server, not a new affordance.
 */
export function SubmissionCapacityEditor({ inherit, rawLimit, effectiveLimit, onChange }: Props): JSX.Element {
  const legacyUnlimited = !inherit && rawLimit === 0;
  return <div class="field submission-capacity-editor" data-builder-capacity="true">
    <label>Submissions per person</label>
    {inherit ? <>
      <div class="forms-limit-note"><strong>Uses conference default</strong><span>{effectiveLimit} abstracts per person</span></div>
      <button class="button small ghost" type="button" onClick={() => onChange({ submitter_limit_inherit: false, per_submitter_limit: Math.max(1, effectiveLimit) })}>Set form override</button>
    </> : <>
      <div class="forms-limit-note"><strong>Form override</strong><span>{legacyUnlimited ? "Legacy unlimited value" : `${effectiveLimit} abstracts per person`}</span></div>
      {legacyUnlimited && <small>Choose a finite value to replace the legacy unlimited value.</small>}
      <input
        type="number"
        min="1"
        max="100"
        value={legacyUnlimited ? "" : rawLimit}
        placeholder={legacyUnlimited ? "1–100" : undefined}
        onInput={(event) => {
          const value = Number(event.currentTarget.value);
          if (Number.isInteger(value) && value >= 1 && value <= 100) onChange({ per_submitter_limit: value, submitter_limit_inherit: false });
        }}
      />
      <button class="button small ghost" type="button" onClick={() => onChange({ submitter_limit_inherit: true })}>Use conference default</button>
    </>}
  </div>;
}
