export const FOREGROUND_SECONDS = 15 * 60;
export const WINDOW_CONFIRMATION = "desktop-v1";
export const sessionIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const windowTokenPattern = /^[0-9a-f]{64}$/;

export function validDuration(seconds, now = Date.now()) {
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds * 1000 <= 8.64e15 - now;
}

export function windowRemaining(window, sessionId = process.env.PI_SESSION_ID, now = Date.now()) {
  if (!window || typeof window.sessionId !== "string" || !sessionIdPattern.test(window.sessionId) || window.sessionId !== sessionId
    || typeof window.token !== "string" || !windowTokenPattern.test(window.token)
    || !Number.isSafeInteger(window.expiresAt) || window.expiresAt > 8.64e15 || window.expiresAt <= now) {
    throw new Error("FOCUS_BLOCKED: browser window is expired, invalid or belongs to another Pi session");
  }
  return window.expiresAt - now;
}
