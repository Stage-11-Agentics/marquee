import {
  commandArguments,
  inboxRowHasIcs,
  isCatchAllRecipient,
  parseIcs,
  requestJson,
  runSmoke,
  smokeAssert,
  smokeContexts,
  smokeHarnessHeaders,
  SmokeNeedsHuman,
  submitPublicSmoke,
  waitForInboxMessage,
} from "./inbox-smoke-lib.mjs";

const args = commandArguments();

async function runBatchRescheduleAxis(context, eventId) {
  const since = new Date(Date.now() - 5_000).toISOString();
  const submission = await submitPublicSmoke(context);
  const demoSafe = submission.form.turnstile_site_key === null
    && Boolean(submission.submitted.confirmation?.portal_url);
  smokeAssert(demoSafe, "Smoke target is not the demo-safe conference; refusing to claim the live calendar oracle");
  const submissionId = submission.submissionId;

  await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/decision`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({ recommendation: "approve", feedback_md: "MRQ-233 batch reschedule oracle" }),
  });

  const agenda = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/agenda`, {
    headers: context.auth,
  });
  const room = agenda?.rooms?.[0];
  smokeAssert(room?.id, "smoke:ics batch axis could not find a room in the event agenda");
  const format = agenda?.formats?.[0];
  const startsAt = Math.max(Date.now() + 2 * 60 * 60_000, Date.parse(`${agenda.event.starts_on}T12:00:00.000Z`));
  const placed = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/agenda/items`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({
      submission_id: submissionId,
      starts_at: startsAt,
      room_id: room.id,
      duration_min: format?.default_duration_min ?? 30,
    }),
  });

  const harnessHeaders = smokeHarnessHeaders(context);
  const batchPath = `/api/v1/events/${encodeURIComponent(eventId)}/calendar-invites`;
  const firstBatch = await requestJson(context.origin, batchPath, { method: "POST", headers: harnessHeaders });
  const firstPart = firstBatch?.deliveries?.flatMap((delivery) => delivery.parts ?? [])
    .find((part) => part.submission_id === submissionId);
  smokeAssert(firstPart?.uid && firstPart.sequence === 0, "Calendar batch axis did not create the first REQUEST revision");

  const moved = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/agenda/items/${encodeURIComponent(placed.id)}`, {
    method: "PATCH",
    headers: { ...harnessHeaders, "if-match": placed.etag },
    body: JSON.stringify({ starts_at: startsAt + 30 * 60_000 }),
  });
  smokeAssert(moved?.etag, "Calendar batch axis agenda move did not return a new ETag");

  const secondBatch = await requestJson(context.origin, batchPath, { method: "POST", headers: harnessHeaders });
  const secondPart = secondBatch?.deliveries?.flatMap((delivery) => delivery.parts ?? [])
    .find((part) => part.submission_id === submissionId);
  smokeAssert(secondPart?.uid === firstPart.uid, "Calendar batch reschedule changed the UID");
  smokeAssert(secondPart?.sequence === firstPart.sequence + 1, "Calendar batch reschedule did not increment SEQUENCE by one");

  if (isCatchAllRecipient(context)) {
    const firstRow = await waitForInboxMessage(
      context,
      context.inbox.address,
      since,
      (row) => inboxRowHasIcs(row, (ics) => ics.uid === firstPart.uid && ics.sequence === 0 && ics.method === "REQUEST"),
      "calendar batch REQUEST",
    );
    const secondRow = await waitForInboxMessage(
      context,
      context.inbox.address,
      since,
      (row) => inboxRowHasIcs(row, (ics) => ics.uid === firstPart.uid && ics.sequence === 1 && ics.method === "REQUEST"),
      "calendar batch reschedule REQUEST",
    );
    return {
      submission_id: submissionId,
      agenda_item_id: placed.id,
      first: { inbox_message_id: firstRow.id, ...parseIcs(firstRow.raw_rfc822) },
      reschedule: { inbox_message_id: secondRow.id, ...parseIcs(secondRow.raw_rfc822) },
    };
  }

  return {
    submission_id: submissionId,
    agenda_item_id: placed.id,
    first: { uid: firstPart.uid, sequence: firstPart.sequence, method: "REQUEST" },
    reschedule: { uid: secondPart.uid, sequence: secondPart.sequence, method: "REQUEST" },
  };
}

async function runIcsForContext(context, eventId) {
  const since = new Date(Date.now() - 5_000).toISOString();
  const submission = await submitPublicSmoke(context);
  const demoSafe = submission.form.turnstile_site_key === null
    && Boolean(submission.submitted.confirmation?.portal_url);
  smokeAssert(demoSafe, "Smoke target is not the demo-safe conference; refusing to claim the live calendar oracle");
  smokeAssert(
    submission.submitted.confirmation?.receipt_email === context.inbox.address,
    "Public confirmation outbox row did not target the exact ICS recipient",
  );
  const submissionId = submission.submissionId;

  await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/decision`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({ recommendation: "approve", feedback_md: "MRQ-238 live ICS oracle" }),
  });

  const agenda = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/agenda`, {
    headers: context.auth,
  });
  const room = agenda?.rooms?.[0];
  smokeAssert(room?.id, "smoke:ics could not find a room in the event agenda");
  const format = agenda?.formats?.[0];
  const startsAt = Math.max(Date.now() + 60 * 60_000, Date.parse(`${agenda.event.starts_on}T10:00:00.000Z`));
  const placed = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/agenda/items`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({
      submission_id: submissionId,
      starts_at: startsAt,
      room_id: room.id,
      duration_min: format?.default_duration_min ?? 30,
    }),
  });

  // This explicit header is accepted only alongside a bearer token with the
  // route's program:write grant. It is the one sanctioned G3 live-mail path;
  // ordinary calendar sends remain demo_safe.
  const harnessHeaders = smokeHarnessHeaders(context);
  const invitePath = `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/invites`;
  const firstInvite = await requestJson(context.origin, invitePath, { method: "POST", headers: harnessHeaders });
  const firstDelivery = firstInvite?.data?.[0];
  smokeAssert(firstDelivery?.uid && firstDelivery?.sequence === 0, "Calendar REQUEST did not start at sequence 0");
  const batchReschedule = await runBatchRescheduleAxis(context, eventId);

  if (!isCatchAllRecipient(context)) {
    const secondInvite = await requestJson(context.origin, invitePath, { method: "POST", headers: harnessHeaders });
    const secondDelivery = secondInvite?.data?.[0];
    smokeAssert(secondDelivery?.uid === firstDelivery.uid, "Calendar reschedule changed the UID");
    smokeAssert(secondDelivery?.sequence === firstDelivery.sequence + 1, "Calendar reschedule did not increment SEQUENCE by one");
    const reversal = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/reversal`, {
      method: "POST",
      headers: harnessHeaders,
      body: JSON.stringify({ tasks: "retain", emails: "retain", calendar: "cancel", outcome: "withdrawn" }),
    });
    smokeAssert(Number(reversal?.data?.calendar_cancelled) === 1, "Acceptance reversal did not queue one calendar cancellation");
    return {
      run_id: context.inbox.runId,
      form: context.formSlug,
      event_id: eventId,
      generated_address: context.inbox.generatedAddress,
      recipient_address: context.inbox.address,
      submission_id: submissionId,
      demo_safe: demoSafe,
      human_oracle_required: true,
      request: { uid: firstDelivery.uid, sequence: firstDelivery.sequence, method: "REQUEST" },
      reschedule: { uid: secondDelivery.uid, sequence: secondDelivery.sequence, method: "REQUEST" },
      batch_reschedule: batchReschedule,
      cancel: { uid: firstDelivery.uid, sequence: secondDelivery.sequence + 1, method: "CANCEL" },
      mechanical_oracle: "The authenticated smoke harness queued the repeated per-session REQUEST/REQUEST/CANCEL axis and a separate real agenda-move/batch REQUEST/REQUEST axis for the exact external recipients; their raw arrival and calendar rendering require the supplied clients.",
      human_oracle_remaining: "Accept both REQUEST paths in each supplied real calendar client and confirm the original event, replacement, and removal.",
    };
  }

  const firstRow = await waitForInboxMessage(
    context,
    context.inbox.address,
    since,
    (row) => inboxRowHasIcs(row, (ics) => ics.uid === firstDelivery.uid && ics.sequence === 0 && ics.method === "REQUEST"),
    "calendar REQUEST",
  );
  const firstIcs = parseIcs(firstRow.raw_rfc822);

  const secondInvite = await requestJson(context.origin, invitePath, { method: "POST", headers: harnessHeaders });
  const secondDelivery = secondInvite?.data?.[0];
  smokeAssert(secondDelivery?.uid === firstDelivery.uid, "Calendar reschedule changed the UID");
  smokeAssert(secondDelivery?.sequence === firstDelivery.sequence + 1, "Calendar reschedule did not increment SEQUENCE by one");
  const secondRow = await waitForInboxMessage(
    context,
    context.inbox.address,
    since,
    (row) => inboxRowHasIcs(row, (ics) => ics.uid === firstDelivery.uid && ics.sequence === 1 && ics.method === "REQUEST"),
    "calendar reschedule REQUEST",
  );
  const secondIcs = parseIcs(secondRow.raw_rfc822);

  const reversal = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/reversal`, {
    method: "POST",
    headers: harnessHeaders,
    body: JSON.stringify({ tasks: "retain", emails: "retain", calendar: "cancel", outcome: "withdrawn" }),
  });
  smokeAssert(Number(reversal?.data?.calendar_cancelled) === 1, "Acceptance reversal did not queue one calendar cancellation");
  const cancelRow = await waitForInboxMessage(
    context,
    context.inbox.address,
    since,
    (row) => inboxRowHasIcs(row, (ics) => ics.uid === firstDelivery.uid && ics.sequence === 2 && ics.method === "CANCEL"),
    "calendar CANCEL",
  );
  const cancelIcs = parseIcs(cancelRow.raw_rfc822);

  smokeAssert(firstIcs.uid === secondIcs.uid && secondIcs.uid === cancelIcs.uid, "Stored calendar messages do not share one UID");
  smokeAssert(secondIcs.sequence === firstIcs.sequence + 1, "Stored reschedule did not increment SEQUENCE by one");
  smokeAssert(cancelIcs.sequence === secondIcs.sequence + 1, "Stored cancellation did not increment SEQUENCE by one");

  return {
    run_id: context.inbox.runId,
    form: context.formSlug,
    event_id: eventId,
    generated_address: context.inbox.generatedAddress,
    recipient_address: context.inbox.address,
    submission_id: submissionId,
    agenda_item_id: placed?.id ?? null,
    demo_safe: demoSafe,
    request: { inbox_message_id: firstRow.id, ...firstIcs },
    reschedule: { inbox_message_id: secondRow.id, ...secondIcs },
    batch_reschedule: batchReschedule,
    cancel: { inbox_message_id: cancelRow.id, ...cancelIcs },
    same_uid: true,
    mechanical_oracle: "REQUEST, reschedule, and CANCEL were observed in the private inbox D1 through the explicit smoke live-mail path.",
    human_oracle_remaining: "Accept the REQUEST in each supplied real calendar client and confirm the rendered event.",
  };
}

await runSmoke("smoke:ics", args, async () => {
  const eventId = String(args["event-id"] ?? process.env.MARQUEE_SMOKE_EVENT_ID ?? "").trim();
  if (!eventId) throw new SmokeNeedsHuman("smoke:ics needs --event-id or MARQUEE_SMOKE_EVENT_ID so the public submission can be scheduled");
  if (!String(args.token ?? process.env.MARQUEE_SMOKE_TOKEN ?? args.cookie ?? process.env.MARQUEE_SMOKE_COOKIE ?? "").trim()) {
    throw new SmokeNeedsHuman("smoke:ics needs --token/--cookie or MARQUEE_SMOKE_TOKEN/MARQUEE_SMOKE_COOKIE with program and agenda grants");
  }
  const contexts = smokeContexts(args);
  const runs = [];
  for (const context of contexts) runs.push(await runIcsForContext(context, eventId));
  const humanRuns = runs.filter((run) => run.human_oracle_required);
  if (humanRuns.length > 0) {
    throw new SmokeNeedsHuman(
      "The exact external ICS recipients were queued, but their raw messages are outside the private catch-all D1; verify the REQUEST, replacement, and CANCEL in each client.",
      { event_id: eventId, runs, human_recipients: humanRuns.map((run) => run.recipient_address) },
    );
  }
  return {
    event_id: eventId,
    recipient_count: runs.length,
    runs,
  };
});
