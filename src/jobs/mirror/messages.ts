export const MIRROR_OUTBOX_MESSAGE_TYPE = "mirror_outbox" as const;
export const MIRROR_RECONCILE_MESSAGE_TYPE = "mirror_reconcile" as const;

export interface MirrorOutboxMessage {
  type: typeof MIRROR_OUTBOX_MESSAGE_TYPE;
  outbox_id: string;
  request_id?: string;
}

export interface MirrorReconcileMessage {
  type: typeof MIRROR_RECONCILE_MESSAGE_TYPE;
  reason?: string;
  requested_at?: number;
  request_id?: string;
}

export type MirrorQueueMessage = MirrorOutboxMessage | MirrorReconcileMessage;
