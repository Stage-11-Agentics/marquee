/**
 * The outbound Resend identity used by the mail consumer and shown by the
 * Server panel. Keeping the sender in one module prevents a status screen from
 * drifting away from the address the provider actually receives.
 */
export const RESEND_MAIL_FROM = "Marquee <marquee@stage11.systems>";
export const RESEND_SENDER = "marquee@stage11.systems";
export const RESEND_DASHBOARD_URL = "https://resend.com";

export interface ResendIdentityEnvironment {
  RESEND_API_KEY?: string;
  /** Optional operator-supplied label from the connected Resend account. */
  RESEND_ACCOUNT_NAME?: string;
}

export interface ResendIdentity {
  sender: string | null;
  account: string | null;
}

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Return only identity that is connected on this deployment. The sender is
 * the same source used by the Resend provider; the account label is optional
 * configuration because an API key cannot safely reveal an account name.
 */
export function readResendIdentity(environment: ResendIdentityEnvironment): ResendIdentity {
  if (!present(environment.RESEND_API_KEY)) return { sender: null, account: null };
  return {
    sender: RESEND_SENDER,
    account: present(environment.RESEND_ACCOUNT_NAME) ? environment.RESEND_ACCOUNT_NAME!.trim() : null,
  };
}
