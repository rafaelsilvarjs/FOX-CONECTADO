function resolveApiUrl() {
  const envUrl = String(process.env.REACT_APP_API_URL || "").trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }

  return "http://localhost:4000";
}

export const API_URL = resolveApiUrl();
