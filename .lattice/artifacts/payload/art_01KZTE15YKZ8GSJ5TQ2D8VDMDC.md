Observed validation: PASS
Validated commit: 6dc922f17412943e9fad0adc80023dd30d4248be

Running-system proof on local Wrangler Worker at http://127.0.0.1:8799/f/cfp, built from exact HEAD:
- Fresh public form rendered Save draft, truthful participant copy, and an empty reserved save-status slot; no "Draft saved locally" text.
- In c11 WKWebView, entered only a title and clicked Save draft. The browser showed the inline "Contact address for your resume link" prompt and did not show the submit-required "Add an answer..." error storm.
- Entered mrq119-browser@example.com and saved. The form showed SAVED, the resumed-draft notice, the visible /f/cfp?resume=... link, and Copy resume link. The create request returned HTTP 201 and the Worker log recorded the draft queue message.
- Clicked Copy resume link; the browser surface changed the control to Copied. c11 browser errors list reported "No browser errors".

The local Worker used the documented example .dev.vars and only local D1/R2/queue state; no credentials or external writes were used.