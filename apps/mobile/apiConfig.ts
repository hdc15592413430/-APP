const rawConfiguredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ?? "";

export const API_BASE_URL = normalizeApiBaseUrl(
  rawConfiguredBaseUrl || (__DEV__ ? "http://127.0.0.1:8000" : ""),
);

export const API_CONNECTION_MODE = detectApiConnectionMode(API_BASE_URL, rawConfiguredBaseUrl);

export function hasApiBaseUrl() {
  return Boolean(API_BASE_URL);
}

export function getApiBaseUrlHelpText() {
  if (API_BASE_URL) {
    return null;
  }
  return "当前还没配置公网接口地址，请先在 apps/mobile/.env 里设置 EXPO_PUBLIC_API_BASE_URL。";
}

function normalizeApiBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function detectApiConnectionMode(baseUrl: string, configuredBaseUrl: string) {
  if (!baseUrl) {
    return "unconfigured";
  }
  if (!configuredBaseUrl && __DEV__) {
    return "dev-default";
  }

  if (
    baseUrl.includes("127.0.0.1") ||
    baseUrl.includes("localhost") ||
    baseUrl.includes("192.168.") ||
    baseUrl.includes("10.") ||
    baseUrl.includes("172.")
  ) {
    return "local-network";
  }

  return "public-api";
}
