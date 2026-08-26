export const SERVER_NAME = "oura-mcp-server";
export const SERVER_VERSION = "0.7.1";
export const NPM_PACKAGE_NAME = "oura-mcp-unofficial";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;

export const OURA_API_BASE_URL = "https://api.ouraring.com/v2";
export const OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const OURA_REVOKE_URL = "https://api.ouraring.com/oauth/revoke";
export const OURA_DEVELOPER_PORTAL_URL = "https://cloud.ouraring.com/oauth/applications";
export const OURA_DOCS_URL = "https://cloud.ouraring.com/docs/authentication";

// Official Oura OAuth scopes (cloud.ouraring.com OpenAPI + auth docs).
// There is no separate "sleep" scope — sleep/readiness/activity daily data is under `daily`.
// SpO2 is documented as both `spo2` (auth docs / consent UI) and `spo2Daily` (OpenAPI); doctor treats them as aliases.
export const DEFAULT_SCOPES = [
  "daily",
  "heartrate",
  "personal",
  "workout",
  "spo2"
];

/** Map wire-format aliases to the canonical name used by DEFAULT_SCOPES / doctor. */
export const SCOPE_ALIASES: Record<string, string> = {
  spo2daily: "spo2",
  spo2_daily: "spo2"
};

export const DEFAULT_LIMIT = 30;
export const MAX_OURA_LIMIT = 100;
export const DEFAULT_MAX_PAGES = 1;
export const MAX_PAGES = 10;

/**
 * Page budget for a "most recent record" scan (`OuraClient.latest`).
 *
 * Oura serves collections oldest-first with an opaque cursor, so the newest record is
 * only reachable by walking a window to the end. Bigger than MAX_PAGES because the scan
 * keeps one record in memory, not a page of them, and because stopping early is the
 * exact defect this budget exists to prevent.
 */
export const LATEST_SCAN_MAX_PAGES = 20;

/**
 * Lookback ladder for "most recent record", in days, narrowest first.
 *
 * The narrow window is what bounds the cost of the walk; widening only happens when a
 * window came back empty, so a ring that has not synced in weeks still answers.
 */
export const LATEST_LOOKBACK_DAYS = [14, 90, 400];
