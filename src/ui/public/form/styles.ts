export const PUBLIC_FORM_STYLES = `
.public-form { min-height: 100vh; min-width: 0; overflow-x: clip; background: var(--bg); color: var(--ink); }
.public-form-header { border-bottom: 1px solid var(--line-strong); background: var(--panel); padding: 18px clamp(16px, 5vw, 72px); }
.public-form-header-inner { width: min(1120px, 100%); margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.public-brand { align-items: center; display: flex; gap: 10px; }
.public-brand-mark { align-items: center; background: var(--accent-soft); border: 1px solid var(--accent); border-radius: var(--radius); color: var(--accent-dark); display: grid; font: 600 13px/1 var(--mono); height: 28px; place-items: center; width: 28px; }
.public-brand-name { font: 600 13px/1 var(--mono); letter-spacing: .2em; text-transform: uppercase; }
.public-kicker { color: var(--muted); font: 600 10px/1.3 var(--mono); letter-spacing: .14em; text-align: right; text-transform: uppercase; }
.public-form-main { min-width: 0; width: min(900px, calc(100% - 32px)); margin: 0 auto; padding: clamp(30px, 7vw, 76px) 0 84px; }
.public-intro { border-bottom: 1px solid var(--line-strong); padding-bottom: 26px; }
.public-intro h1 { font: 500 clamp(30px, 5vw, 54px)/1.03 var(--mono); letter-spacing: -.05em; margin: 0 0 15px; max-width: 760px; }
.public-intro p { color: var(--ink-soft); font-size: 15px; line-height: 1.65; margin: 0; max-width: 700px; white-space: pre-wrap; }
.public-meta { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 20px; }
.public-meta span, .public-save-status { color: var(--muted); font: 500 10px/1.4 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.public-save-status { display: inline-block; min-height: 1.4em; min-width: 15ch; visibility: hidden; }
.public-save-status.has-value { visibility: visible; }
.public-progress { display: flex; gap: 5px; margin-top: 24px; }
.public-progress i { background: var(--line-strong); display: block; height: 4px; width: 36px; }
.public-progress i.is-active { background: var(--accent); }
.public-notice { border-left: 3px solid var(--accent); background: var(--accent-soft); color: var(--accent-ink); margin: 24px 0 0; padding: 13px 15px; font-size: 13px; line-height: 1.55; }
.public-notice.alarm { border-left-color: var(--alarm); background: var(--alarm-wash); color: #7c2018; }
.public-form-card { background: var(--panel); border: 1px solid var(--line-strong); border-radius: var(--radius); margin-top: 26px; min-width: 0; overflow: clip; }
.public-form-card-head { align-items: center; background: var(--sunk); border-bottom: 1px solid var(--line-strong); display: flex; justify-content: space-between; padding: 13px 16px; }
.public-form-card-head h2 { font: 600 11px/1.2 var(--mono); letter-spacing: .15em; margin: 0; text-transform: uppercase; }
.public-participant-limit { background: var(--accent-soft); border-bottom: 1px solid var(--line-strong); color: var(--accent-ink); font-size: 12px; line-height: 1.5; margin: 0; padding: 12px 20px; }

/* Who is presenting. Every slot is one height and both the add control and the
   on-behalf-of panel sit BELOW the control that opens them, so the thing the
   submitter just clicked never moves out from under the cursor.

   The page does get taller when a slot or the disclosure opens, and that is the
   point of the interaction rather than a violation of it: the "elements never
   jump" rule is about a control changing size or position while its meaning
   stays the same — a relabelled toggle, a swapped status line — not about a
   section the submitter deliberately asked to appear. What is reserved is
   everything that changes without being asked for: the role select is a fixed
   width so choosing Moderator does not resize it, the participant count is
   tabular so it does not reflow its heading row, and the error line under the
   section holds its height whether or not it has a message. */
.public-participants { border-bottom: 1px solid var(--line-strong); display: grid; gap: 12px; padding: 16px 20px; }
.public-participants-head { align-items: center; display: flex; justify-content: space-between; }
.public-participants-head h2 { font: 600 11px/1.2 var(--mono); letter-spacing: .15em; margin: 0; text-transform: uppercase; }
/* Tabular, so the count does not reflow the heading row as people are added. */
.public-participant-count { font-variant-numeric: tabular-nums; }
.public-behalf-toggle { align-items: center; display: flex; font-size: 12.5px; gap: 8px; line-height: 1.5; }
.public-behalf-fields { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.public-participant-card { align-items: end; border: 1px solid var(--line); border-radius: 8px; display: grid; gap: 10px; grid-template-columns: 148px minmax(160px, 1fr) minmax(180px, 1fr) 92px; min-height: 74px; padding: 12px; }
.public-participant-card.is-primary { align-items: center; background: var(--sunk); grid-template-columns: 148px 1fr; }
.public-participant-role-static { color: var(--muted); font: 600 10px/1.2 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.public-participant-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.public-participant-field { display: grid; gap: 5px; min-width: 0; }
.public-participant-field > span { color: var(--muted); font-size: 11px; }
.public-participant-field input, .public-participant-field select { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; color: var(--ink); font: inherit; font-size: 12.5px; min-height: 36px; padding: 7px 9px; width: 100%; }
/* Fixed width: the select must not resize as roles of different lengths are chosen. */
.public-participant-role select { width: 148px; }
.public-participant-remove { background: none; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); cursor: pointer; font: inherit; font-size: 12px; min-height: 36px; width: 92px; }
.public-participant-remove:hover:not(:disabled) { border-color: var(--alarm); color: var(--alarm); }
.public-participant-note { color: var(--muted); font-size: 11.5px; grid-column: 1 / -1; line-height: 1.5; margin: 0; }
.public-participant-actions { align-items: center; display: flex; gap: 10px; min-height: 38px; }
.public-participant-add { background: var(--surface); border: 1px dashed var(--line-strong); border-radius: 6px; color: var(--ink); cursor: pointer; font: inherit; font-size: 12.5px; min-height: 38px; padding: 8px 14px; }
.public-participant-add:disabled { color: var(--muted); cursor: not-allowed; }
.public-participant-full { color: var(--muted); font-size: 11.5px; }
/* A fieldset, so a closed or at-limit call disables every control under it in
   one attribute. The reset keeps its layout identical to the div it replaced. */
.public-form-fields { border: 0; display: grid; gap: 23px; margin: 0; min-width: 0; padding: 24px 20px; }
.public-form-fields:disabled { opacity: .62; }
.public-form-fields:disabled input, .public-form-fields:disabled textarea, .public-form-fields:disabled select { background: var(--sunk); cursor: not-allowed; }
.public-field { display: grid; gap: 7px; min-width: 0; }
.public-field label { color: var(--ink); font-size: 13px; font-weight: 650; }
.public-field label em { color: var(--muted); font-size: 11px; font-style: normal; font-weight: 400; }
.public-field-note, .public-field-counter { color: var(--muted); font-size: 11px; line-height: 1.45; }
.public-field-counter { font-family: var(--mono); }
.public-field-retired { color: var(--warning, var(--alarm)); font-size: 12px; line-height: 1.45; }
.public-field input:not([type=checkbox]):not([type=radio]), .public-field textarea, .public-field select { background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius); box-sizing: border-box; font-size: 14px; min-height: 42px; min-width: 0; outline: none; padding: 10px 11px; width: 100%; }
.public-field textarea { min-height: 118px; resize: vertical; }
.public-field input:focus, .public-field textarea:focus, .public-field select:focus { border-color: var(--accent); outline: 2px solid var(--accent-soft); outline-offset: 1px; }
.public-field.has-error input, .public-field.has-error textarea, .public-field.has-error select { border-color: var(--alarm); }
.public-field-error { color: var(--alarm); font-size: 12px; line-height: 1.45; min-height: 3.6em; visibility: hidden; }
.public-field-error.has-message { visibility: visible; }
.public-option-list { display: grid; gap: 7px; }
.public-option { align-items: center; background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius); display: flex; gap: 9px; min-height: 42px; padding: 8px 11px; }
.public-option:has(input:checked) { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); }
.public-option input { accent-color: var(--accent); }
.public-file { border: 1px dashed var(--line-strong); padding: 12px; }
.public-file input { width: 100%; }
.public-file-existing { color: var(--accent-ink); display: block; font: 500 11px/1.4 var(--mono); margin-top: 8px; min-height: 1.4em; overflow-wrap: anywhere; }
.public-file-existing:not(.has-file) { color: var(--muted); }
.public-file-preview { align-items: center; display: flex; gap: 12px; margin-top: 12px; }
.public-file-crop { background: var(--sunk); border: 1px solid var(--line-strong); border-radius: var(--radius); flex: none; height: 96px; overflow: hidden; width: 96px; }
.public-file-crop img { display: block; height: 100%; object-fit: cover; width: 100%; }
.public-file-crop-note { color: var(--muted); font-size: 11px; line-height: 1.45; }
.public-draft-resume { background: var(--accent-soft); border-top: 1px solid var(--line-strong); display: grid; gap: 5px; padding: 14px 20px; }
.public-draft-resume strong { color: var(--accent-ink); font: 600 11px/1.3 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.public-draft-resume > span { color: var(--ink-soft); font-size: 12px; line-height: 1.45; }
.public-draft-resume-actions { align-items: center; display: flex; gap: 12px; min-width: 0; }
.public-draft-resume-actions .public-resume-link { flex: 1; margin-top: 0; min-width: 0; }
.public-copy-link, .public-save-draft { background: var(--panel); border: 1px solid var(--line-strong); border-radius: var(--radius); color: var(--ink); font: 600 11px/1 var(--mono); min-height: 38px; padding: 0 13px; white-space: nowrap; }
.public-copy-link:hover, .public-save-draft:hover { border-color: var(--accent); color: var(--accent-ink); }
.public-form-footer { align-items: flex-end; background: var(--sunk); border-top: 1px solid var(--line-strong); display: flex; gap: 14px; justify-content: space-between; padding: 16px 20px; }
.public-form-footer-copy { display: grid; flex: 1; gap: 10px; min-width: 0; }
.public-draft-email { display: grid; gap: 6px; max-width: 460px; }
.public-draft-email label { color: var(--ink); font-size: 12px; font-weight: 650; }
.public-draft-email input { background: var(--surface); border: 1px solid var(--accent); border-radius: var(--radius); box-sizing: border-box; font-size: 14px; min-height: 40px; min-width: 0; outline: none; padding: 9px 10px; width: 100%; }
.public-draft-email input:focus { outline: 2px solid var(--accent-soft); outline-offset: 1px; }
.public-draft-email span { color: var(--muted); font-size: 11px; line-height: 1.4; }
.public-form-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
.public-submit { background: var(--accent); border: 1px solid var(--accent); border-radius: var(--radius); color: #fff; font: 600 12px/1 var(--mono); min-height: 42px; padding: 0 17px; }
.public-submit:hover { background: #095b62; }
.public-submit:disabled { cursor: not-allowed; opacity: .5; }
.public-copy-link:disabled, .public-save-draft:disabled { cursor: not-allowed; opacity: .5; }
.public-security { color: var(--muted); font-size: 10px; line-height: 1.4; }
.public-error { background: var(--alarm-wash); border: 1px solid #e6b8b2; box-sizing: border-box; color: #7c2018; margin: 16px 20px 0; min-height: 60px; padding: 12px 14px; font-size: 12px; line-height: 1.5; visibility: hidden; }
.public-error.has-message { visibility: visible; }
.public-confirmation { background: var(--panel); border: 1px solid var(--line-strong); border-top: 3px solid var(--ok); margin-top: 26px; padding: clamp(22px, 5vw, 40px); }
.public-confirmation h2 { font: 500 clamp(25px, 4vw, 38px)/1.1 var(--mono); letter-spacing: -.04em; margin: 0 0 12px; }
.public-confirmation p { color: var(--ink-soft); font-size: 14px; line-height: 1.6; margin: 7px 0; }
.public-confirmation .public-reference { color: var(--ink); font: 600 13px/1.4 var(--mono); letter-spacing: .02em; }
.public-reference span { color: var(--muted); font: 600 10px/1.4 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.public-confirmation-edit-note { background: var(--alarm-wash); border-left: 3px solid var(--alarm); color: #7c2018 !important; margin: 18px 0 0 !important; padding: 12px 14px; }
.public-confirmation a { color: var(--accent-ink); text-decoration: underline; text-underline-offset: 3px; }
.public-confirmation .public-resume { border-top: 1px solid var(--line); margin-top: 18px; padding-top: 14px; }
.public-resume-link { display: block; font: 400 12px/1.5 var(--mono); margin-top: 6px; overflow-wrap: anywhere; }
.public-footer { border-top: 1px solid var(--line); color: var(--muted); display: flex; font: 400 10px/1.4 var(--mono); justify-content: space-between; padding: 18px clamp(16px, 5vw, 72px); }
@media (max-width: 560px) {
  .public-form-header { padding: 14px 16px; }
  .public-kicker { font-size: 9px; }
  .public-form-main { min-width: 0; width: calc(100% - 24px); padding-top: 30px; }
  .public-intro h1 { font-size: clamp(29px, 11vw, 42px); }
  .public-intro p { font-size: 13px; }
  .public-form-fields { min-width: 0; padding: 19px 14px; }
  .public-draft-resume { padding: 14px; }
  .public-draft-resume-actions { align-items: stretch; flex-direction: column; gap: 8px; }
  .public-draft-resume-actions .public-resume-link { width: 100%; }
  .public-form-footer { align-items: stretch; flex-direction: column; min-height: 112px; padding: 14px; }
  .public-form-actions { align-items: stretch; flex-direction: column; width: 100%; }
  .public-copy-link, .public-save-draft { width: 100%; }
  .public-submit { width: 100%; }
  .public-footer { align-items: flex-start; flex-direction: column; gap: 8px; }
}
`;
