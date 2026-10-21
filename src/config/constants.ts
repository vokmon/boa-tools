/** Values that are fixed for this business, kept out of .env on purpose. */
export const DEFAULT_TIMEZONE = "Asia/Bangkok";

export const WIX_IQ_OPTION_FIELD_KEY = "custom.iq-option";

export const SENTRY_ENVIRONMENT = "production";
/** Searched in order; the first dataset with a match wins. */
export const SENTRY_DATASETS = ["logs", "errors"] as const;
export const SENTRY_CONCURRENCY = 5;

/** Same platform and endpoints as iq-robot; Bun connects directly, no proxy needed. */
export const IQ_OPTION_WS_URL = "wss://iqoption.com/echo/websocket";
export const IQ_OPTION_API_URL = "https://api.iqoption.com";
export const IQ_OPTION_PLATFORM_ID = 578;
