/**
 * Log messages written by the BOA apps (iq-robot / bot-boa / iq-signal) that the tools read.
 * Formats come from iq-robot `src/services/tag-manager/sentry/sentry-log.ts`.
 */

/** "Order placed successfully (system) (<orderId>) <asset> - Amount: 100.00 - user_iq: <id>", with an `order` JSON attribute. */
export const ORDER_PLACED_QUERY = 'message:"Order placed successfully*"';

/** "Position closed (<pnl>) - order (<ids>) - user_iq: <id>", with a `balance` JSON attribute. */
export const CLOSED_POSITION_QUERY = 'message:"Position closed*"';

/** "⛔ Subscription validation failed for: <email>"; Sentry masks the email in the message but keeps it in message.parameter.0. */
export const VALIDATION_FAILED_QUERY = "message:*Subscription*validation*failed*";
export const validationFailedFor = (email: string) => `${VALIDATION_FAILED_QUERY} message.parameter.0:${email.toLowerCase()}`;

/** "SiteParamConfigProvider: Received config for user <email with @ replaced by _>", written when the app loads. */
export const appOpenedText = (email: string) => email.toLowerCase().replace("@", "_");

/** Search terms must not contain characters that break out of a Sentry wildcard. */
export function assertSafeSearchText(text: string): string {
  if (!text || /[\s"*\\()]/.test(text)) throw new Error(`Unsafe search text: ${JSON.stringify(text)}`);
  return text;
}
