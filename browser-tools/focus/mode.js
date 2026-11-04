import {exceptionRemaining, FOREGROUND_SECONDS} from "./limits.js";

export function startOptions(args) {
  let mode = "background", seconds = FOREGROUND_SECONDS, foreground = false, direct = false, exceptionFile, networkMode = "proxy";
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const key = arg.startsWith("--network=") ? "--network" : arg;
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`);
    seen.add(key);
    if (arg === "--host" || arg === "--resume") continue;
    if (arg === "--foreground") foreground = true;
    else if (arg === "--direct-cdp") direct = true;
    else if (arg === "--seconds") seconds = Number(args[++index]);
    else if (arg === "--exception") exceptionFile = args[++index];
    else if (arg.startsWith("--network=")) networkMode = arg.slice("--network=".length);
    else throw new Error("Use browser-start.js [--host] [--resume] [--network=proxy|direct] [--foreground [--direct-cdp] --seconds 1..900 | --exception FILE]; resets and local profile copying are unsupported");
  }
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > FOREGROUND_SECONDS) throw new Error(`Foreground duration must be 1..${FOREGROUND_SECONDS} seconds`);
  if ((direct || seen.has("--seconds") || seen.has("--exception")) && !foreground) throw new Error("--direct-cdp, --seconds and --exception require explicit --foreground");
  if (seen.has("--exception") && (!exceptionFile || seen.has("--seconds"))) throw new Error("--exception requires a receipt file and cannot be combined with --seconds");
  if (foreground) mode = direct ? "direct" : "foreground";
  if (!["proxy", "direct"].includes(networkMode)) throw new Error("Network must be proxy or explicitly approved direct");
  return {mode, seconds, networkMode, ...(exceptionFile ? {exceptionFile} : {})};
}

export function modeEndpoint(state) {
  const mode = state.interactionMode || "background";
  if (!["background", "foreground", "direct"].includes(mode)) throw new Error("FOCUS_BLOCKED: invalid interaction mode");
  if (mode === "direct" && (!Number.isInteger(state.directPort) || state.directPort < 1 || state.directPort > 65535 || state.directPort === state.port)) throw new Error("FOCUS_BLOCKED: invalid direct-CDP discovery port");
  if (state.timeException) exceptionRemaining(state.timeException);
  const exception = state.timeException && mode !== "background" ? `/exception/${state.timeException.token}` : "";
  const browserURL = mode === "direct" ? `http://127.0.0.1:${state.directPort}${exception}` : `http://127.0.0.1:${state.port}${mode === "background" ? "" : "/foreground"}${exception}`;
  return {mode, browserURL: mode === "direct" && exception ? undefined : browserURL,
    metadataURL: `${browserURL}/json/version`,
    browserWSEndpoint: `${state.webSocketDebuggerUrl}${mode === "background" ? "" : `/${mode}`}${exception}`};
}
