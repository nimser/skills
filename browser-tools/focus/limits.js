export const FOREGROUND_SECONDS = 15 * 60;
export const TASK_MINUTES = 90;
export const TIME_EXCEPTIONS = "host-third-party-v1";

export function validTimeException(value, now = Date.now()) {
  const session = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  return value && value.version === 1 && session.test(value.sessionId) && session.test(value.issuerSessionId)
    && value.sessionId !== value.issuerSessionId && /^[0-9a-f]{64}$/.test(value.token)
    && Number.isSafeInteger(value.issuedAt) && Number.isSafeInteger(value.expiresAt)
    && value.issuedAt <= now && value.expiresAt > now && value.expiresAt > value.issuedAt;
}

export function exceptionRemaining(value, sessionId = process.env.PI_SESSION_ID, now = Date.now()) {
  if (!validTimeException(value, now) || value.sessionId !== sessionId) throw new Error("FOCUS_BLOCKED: time exception is expired, invalid or belongs to another agent session");
  return value.expiresAt - now;
}
