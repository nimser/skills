export function startOptions(args) {
  let mode = "background", seconds = 60, foreground = false, direct = false;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === "--host" || arg === "--resume") continue;
    if (arg === "--foreground") foreground = true;
    else if (arg === "--direct-cdp") direct = true;
    else if (arg === "--seconds") seconds = Number(args[++index]);
    else throw new Error("Use browser-start.js [--host] [--resume] [--foreground [--direct-cdp] --seconds 1..300]; resets and local profile copying are unsupported");
  }
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error("Foreground duration must be 1..300 seconds");
  if ((direct || seen.has("--seconds")) && !foreground) throw new Error("--direct-cdp and --seconds require explicit --foreground");
  if (foreground) mode = direct ? "direct" : "foreground";
  return {mode, seconds};
}

export function modeEndpoint(state) {
  const mode = state.interactionMode || "background";
  if (!["background", "foreground", "direct"].includes(mode)) throw new Error("FOCUS_BLOCKED: invalid interaction mode");
  if (mode === "direct" && (!Number.isInteger(state.directPort) || state.directPort < 1 || state.directPort > 65535 || state.directPort === state.port)) throw new Error("FOCUS_BLOCKED: invalid direct-CDP discovery port");
  const browserURL = mode === "direct" ? `http://127.0.0.1:${state.directPort}` : `http://127.0.0.1:${state.port}${mode === "background" ? "" : "/foreground"}`;
  return {mode, browserURL,
    browserWSEndpoint: `${state.webSocketDebuggerUrl}${mode === "background" ? "" : `/${mode}`}`};
}
