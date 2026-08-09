# MRQ-15: Public CFP form

BUILDPLAN: M-14 — Wave 1 (§4), walkthrough step 5 · the judge's own path

Scope (verbatim): SSR form in builder order with the complete participant/profile/file/conditional path; client-blur + server-authoritative validation; drafts + emailed resume link + restored values/files; **Turnstile server-side before every write/presign**; real open, closed, at-limit, resumed, submitted, and re-opened states; confirmation email; 375 px pass. **The vendor conditional renders through M-12's `isFieldApplicable()` helper — it is an ordinary schema-driven field, never a hardcoded alternate form (SPEC §5.4/§5.5).** M-14 exercises **AC-132/AC-133** on the public surface; M-12 owns those IDs for `trace:ac`.

AC-231's gated set is draft creation, submit, and every presign; `PATCH …/drafts/:token` autosave requires **no** Turnstile token (that literal reading would break AC-41) but is rejected without a valid resume token and is rate-limited per token.
Felt checkpoint C3 reads this surface aloud: force every validation failure and every submit failure (5xx, Turnstile challenge failure, 429, dropped connection); no sentence may contain a field name, a type name, an error code, or "invalid" without a remedy.

File surface: `src/routes/public-form.route.tsx`, `src/ui/public/form/*`

ACs: AC-25, AC-26, AC-29, AC-30 – AC-42, AC-155 – AC-157, **AC-231, AC-234**
Hours: 8
Workflow: sub-agent-full (≥7 h)
Shared files: none — module-local. Consumes `src/lib/form-conditions.ts` (M-12's); add to it, never rewrite it.
Deps: M-12, M-11, M-13
Speed: AC-36 is an AC-sourced budget — public CFP form cold load → interactive p95 ≤ 1000 ms.
Plan: filled in by delegator's plan phase
