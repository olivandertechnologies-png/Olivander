const DEFAULT_BACKEND_BASE_URL =
  typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';

export const BACKEND_BASE_URL = (
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  DEFAULT_BACKEND_BASE_URL
).replace(/\/$/, '');

export const BACKEND_ORIGIN = new URL(BACKEND_BASE_URL).origin;

export function buildBackendUrl(path) {
  return `${BACKEND_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function readResponseDetail(response, fallbackMessage) {
  try {
    const payload = await response.json();
    if (payload?.detail) return String(payload.detail);
  } catch {
    // ignore
  }
  return fallbackMessage;
}
