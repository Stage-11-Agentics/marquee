import {
  commandArguments,
  fromName,
  inboxRowHasLink,
  isCatchAllRecipient,
  requestJson,
  runSmoke,
  smokeAssert,
  smokeContexts,
  SmokeNeedsHuman,
  submitPublicSmoke,
  waitForInboxMessage,
} from "./inbox-smoke-lib.mjs";

const args = commandArguments();

function confirmationPath(resumeUrl) {
  const parsed = new URL(resumeUrl);
  return `${parsed.pathname}${parsed.search}`;
}

async function runMailForContext(context) {
  const since = new Date(Date.now() - 5_000).toISOString();
  const submission = await submitPublicSmoke(context);
  const resumeUrl = submission.resumeUrl;
  smokeAssert(resumeUrl, "Submitted public form did not return a confirmation link");

  // The form's Turnstile exemption and the demo-only portal link are both
  // server-derived from the event row. Requiring both keeps AC-38 from being
  // a hardcoded report field; the receipt address then distinguishes
  // suppression from a message that simply has not arrived yet.
  const demoSafe = submission.form.turnstile_site_key === null
    && Boolean(submission.submitted.confirmation?.portal_url);
  smokeAssert(
    demoSafe,
    "Smoke target is not the demo-safe conference; refusing to claim AC-38",
  );
  const receipt = submission.submitted.confirmation;
  smokeAssert(receipt?.receipt_email === context.inbox.address, "Public confirmation outbox row did not target the exact smoke recipient; this is suppression or a disabled template, not an inbox failure");

  if (!isCatchAllRecipient(context)) {
    return {
      run_id: context.inbox.runId,
      form: context.formSlug,
      generated_address: context.inbox.generatedAddress,
      recipient_address: context.inbox.address,
      requested_to: context.inbox.requestedTo,
      submission_id: submission.submissionId,
      resume_url: resumeUrl,
      demo_safe: demoSafe,
      demo_safe_suppression: false,
      human_oracle_required: true,
      delivery_evidence: "The always-live confirmation row targeted the exact external recipient; arrival, display name, and link resolution require the recipient's human inbox check.",
    };
  }

  let row;
  try {
    row = await waitForInboxMessage(
      context,
      context.inbox.address,
      since,
      (candidate) => {
        const subject = `${candidate.subject ?? ""}\n${candidate.raw_rfc822}`;
        return /we received/i.test(subject) && inboxRowHasLink(candidate, resumeUrl);
      },
      "public-form confirmation mail",
    );
  } catch (error) {
    if (error?.timeout) {
      let reread = null;
      try {
        reread = await requestJson(context.origin, confirmationPath(resumeUrl));
      } catch {
        // Keep the original timeout evidence when the public reread is also unavailable.
      }
      error.details = {
        ...(error.details ?? {}),
        demo_safe: demoSafe,
        delivery_state: reread?.confirmation?.receipt_email
          ? "queued-or-sent-but-not-arrived"
          : "suppressed-or-no-outbox-row",
        receipt_email: reread?.confirmation?.receipt_email ?? null,
      };
    }
    throw error;
  }

  const senderName = fromName(row.raw_rfc822);
  smokeAssert(senderName && /^marquee$/i.test(senderName), `Confirmation From display name was not Marquee: ${senderName ?? "missing"}`);

  return {
    run_id: context.inbox.runId,
    form: context.formSlug,
    generated_address: context.inbox.generatedAddress,
    recipient_address: context.inbox.address,
    requested_to: context.inbox.requestedTo,
    submission_id: submission.submissionId,
    inbox_message_id: row.id,
    subject: row.subject,
    from_name: senderName,
    resume_url: resumeUrl,
    link_back: true,
    demo_safe: demoSafe,
    demo_safe_suppression: false,
    delivery_evidence: "The public form's always-live confirmation row targeted the exact fresh recipient and its raw message arrived in the private catch-all D1.",
  };
}

await runSmoke("smoke:mail", args, async () => {
  const contexts = smokeContexts(args);
  const deliveries = [];
  for (const context of contexts) deliveries.push(await runMailForContext(context));
  const humanRuns = deliveries.filter((delivery) => delivery.human_oracle_required);
  if (humanRuns.length > 0) {
    throw new SmokeNeedsHuman(
      "The exact external smoke recipients were submitted, but their inboxes are outside the private catch-all D1; verify arrival, From display name, and link resolution in each client.",
      { recipients: deliveries, human_recipients: humanRuns.map((delivery) => delivery.recipient_address) },
    );
  }
  return {
    recipients: deliveries,
    recipient_count: deliveries.length,
    generated_addresses: deliveries.map((delivery) => delivery.generated_address),
  };
});
