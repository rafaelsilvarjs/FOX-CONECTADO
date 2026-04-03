function limparUrl(url = "") {
  return String(url || "").trim().replace(/\/+$/, "");
}

function ehHostLocal(hostname = "") {
  const valor = String(hostname || "").trim().toLowerCase();
  return valor === "localhost" || valor === "127.0.0.1" || valor === "::1";
}

function resolveApiUrl() {
  const envUrl = limparUrl(process.env.REACT_APP_API_URL || "");
  const originAtual =
    typeof window !== "undefined" && window.location?.origin ? limparUrl(window.location.origin) : "";

  if (envUrl) {
    try {
      const envHostname = new URL(envUrl).hostname;
      const currentHostname =
        typeof window !== "undefined" && window.location?.hostname ? window.location.hostname : "";

      if (!ehHostLocal(currentHostname) && ehHostLocal(envHostname) && originAtual) {
        return originAtual;
      }
    } catch (_) {
    }

    return envUrl;
  }

  if (originAtual) {
    return originAtual;
  }

  return "http://localhost:4000";
}

export const API_URL = resolveApiUrl();
