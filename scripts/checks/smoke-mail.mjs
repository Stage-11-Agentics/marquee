import {
  commandArguments,
  fromName,
  inboxRowHasLink,
  runSmoke,
  smokeAssert,
  smokeContext,
  submitPublicSmoke,
  waitForInboxMessage,
} from "./inbox-smoke-lib.mjs";

const args = commandArguments();

await runSmoke("smoke:mail", args, async () => {
  const context = smokeContext(args);
  const since = new Date(Date.now() - 5_000).toISOString();
  const submission = await submitPublicSmoke(context);
  const resumeUrl = submission.resumeUrl;
  smokeAssert(resumeUrl, "Submitted public form did not return a confirmation link");
  smokeAssert(
    submission.submitted.confirmation?.receipt_email === context.inbox.address,
    "Public confirmation did not target the fresh smoke address",
  );

  const row = await waitForInboxMessage(
    context,
    context.inbox.address,
    since,
    (candidate) => {
      const subject = `${candidate.subject ?? ""}\n${candidate.raw_rfc822}`;
      return /we received/i.test(subject) && inboxRowHasLink(candidate, resumeUrl);
    },
    "public-form confirmation mail",
  );
  const senderName = fromName(row.raw_rfc822);
  smokeAssert(senderName && /marquee/i.test(senderName), `Confirmation From name was not Marquee: ${senderName ?? "missing"}`);

  return {
    run_id: context.inbox.runId,
    form: context.formSlug,
    generated_address: context.inbox.address,
    requested_to: context.inbox.requestedTo,
    submission_id: submission.submissionId,
    inbox_message_id: row.id,
    subject: row.subject,
    from_name: senderName,
    resume_url: resumeUrl,
    link_back: true,
    demo_safe_suppression: false,
    delivery_evidence: "The public form's live confirmation arrived at its fresh catch-all address.",
  };
});
