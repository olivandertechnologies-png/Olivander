import { THEME_KEY, SESSION_KEY, PROCESSED_EMAIL_IDS_KEY } from './constants.js';

export function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function getStoredSession() {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(SESSION_KEY);
  return stored ? stored.trim() || null : null;
}

export function persistSession(sessionValue) {
  if (typeof window === 'undefined') return;
  if (!sessionValue) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_KEY, sessionValue);
}

export function getStoredProcessedEmailIds() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(PROCESSED_EMAIL_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map((v) => String(v))) : new Set();
  } catch {
    return new Set();
  }
}

export function persistProcessedEmailIds(ids) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROCESSED_EMAIL_IDS_KEY, JSON.stringify(Array.from(ids)));
}

export function decodeSessionPayload(sessionToken) {
  if (!sessionToken) return null;
  try {
    const [, payload = ''] = String(sessionToken).split('.');
    const normalised = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), '=');
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return JSON.parse(window.atob(padded));
    }
    return JSON.parse(globalThis.atob(padded));
  } catch {
    return null;
  }
}
