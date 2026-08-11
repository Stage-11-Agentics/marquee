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
.public-progress { display: flex; gap: 5px; margin-top: 24px; }
.public-progress i { background: var(--line-strong); display: block; height: 4px; width: 36px; }
.public-progress i.is-active { background: var(--accent); }
.public-notice { border-left: 3px solid var(--accent); background: var(--accent-soft); color: var(--accent-ink); margin: 24px 0 0; padding: 13px 15px; font-size: 13px; line-height: 1.55; }
.public-notice.alarm { border-left-color: var(--alarm); background: var(--alarm-wash); color: #7c2018; }
.public-form-card { background: var(--panel); border: 1px solid var(--line-strong); border-radius: var(--radius); margin-top: 26px; min-width: 0; overflow: clip; }
.public-form-card-head { align-items: center; background: var(--sunk); border-bottom: 1px solid var(--line-strong); display: flex; justify-content: space-between; padding: 13px 16px; }
.public-form-card-head h2 { font: 600 11px/1.2 var(--mono); letter-spacing: .15em; margin: 0; text-transform: uppercase; }
.public-participant-limit { background: var(--accent-soft); border-bottom: 1px solid var(--line-strong); color: var(--accent-ink); font-size: 12px; line-height: 1.5; margin: 0; padding: 12px 20px; }
.public-form-fields { display: grid; gap: 23px; padding: 24px 20px; }
.public-field { display: grid; gap: 7px; min-width: 0; }
.public-field label { color: var(--ink); font-size: 13px; font-weight: 650; }
.public-field label em { color: var(--muted); font-size: 11px; font-style: normal; font-weight: 400; }
.public-field-note, .public-field-counter { color: var(--muted); font-size: 11px; line-height: 1.45; }
.public-field-counter { font-family: var(--mono); }
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
.public-form-footer { align-items: center; background: var(--sunk); border-top: 1px solid var(--line-strong); display: flex; gap: 14px; justify-content: space-between; padding: 16px 20px; }
.public-submit { background: var(--accent); border: 1px solid var(--accent); border-radius: var(--radius); color: #fff; font: 600 12px/1 var(--mono); min-height: 42px; padding: 0 17px; }
.public-submit:hover { background: #095b62; }
.public-submit:disabled { cursor: not-allowed; opacity: .5; }
.public-security { color: var(--muted); font-size: 10px; line-height: 1.4; }
.public-error { background: var(--alarm-wash); border: 1px solid #e6b8b2; box-sizing: border-box; color: #7c2018; margin: 16px 20px 0; min-height: 60px; padding: 12px 14px; font-size: 12px; line-height: 1.5; visibility: hidden; }
.public-error.has-message { visibility: visible; }
.public-confirmation { background: var(--panel); border: 1px solid var(--line-strong); border-top: 3px solid var(--ok); margin-top: 26px; padding: clamp(22px, 5vw, 40px); }
.public-confirmation h2 { font: 500 clamp(25px, 4vw, 38px)/1.1 var(--mono); letter-spacing: -.04em; margin: 0 0 12px; }
.public-confirmation p { color: var(--ink-soft); font-size: 14px; line-height: 1.6; margin: 7px 0; }
.public-confirmation a { color: var(--accent-ink); text-decoration: underline; text-underline-offset: 3px; }
.public-footer { border-top: 1px solid var(--line); color: var(--muted); display: flex; font: 400 10px/1.4 var(--mono); justify-content: space-between; padding: 18px clamp(16px, 5vw, 72px); }
@media (max-width: 560px) {
  .public-form-header { padding: 14px 16px; }
  .public-kicker { font-size: 9px; }
  .public-form-main { min-width: 0; width: calc(100% - 24px); padding-top: 30px; }
  .public-intro h1 { font-size: clamp(29px, 11vw, 42px); }
  .public-intro p { font-size: 13px; }
  .public-form-fields { min-width: 0; padding: 19px 14px; }
  .public-form-footer { align-items: stretch; flex-direction: column; min-height: 112px; padding: 14px; }
  .public-submit { width: 100%; }
  .public-footer { align-items: flex-start; flex-direction: column; gap: 8px; }
}
`;
