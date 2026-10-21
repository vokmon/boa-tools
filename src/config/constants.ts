/** Values that are fixed for this business, kept out of .env on purpose. */
export const DEFAULT_TIMEZONE = "Asia/Bangkok";

export const WIX_IQ_OPTION_FIELD_KEY = "custom.iq-option";

export const SENTRY_ENVIRONMENT = "production";
/** Searched in order; the first dataset with a match wins. */
export const SENTRY_DATASETS = ["logs", "errors"] as const;
export const SENTRY_CONCURRENCY = 5;
