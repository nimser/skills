import {spawn} from "node:child_process";
import {rmSync} from "node:fs";
import type {Readable, Writable} from "node:stream";
import {consumeLaunch, gatewayPath, readLease, writePrivateJson} from "./lease.ts";
import {FocusGateway, gatewayVersion, parseBrowserFrame} from "./gateway.ts";
import {FocusPolicy, FOCUS_PROTOCOL, type InteractionMode} from "./policy.ts";

export function validateLaunch(command: string[]): void {
  if (!command.length || !command.includes("--remote-debugging-pipe")
    || command.some(arg => /^--(remote-debugging-port|remote-debugging-address|no-sandbox|disable-gpu(?:-[a-z-]+)?|disable-software-rasterizer|disable-setuid-sandbox)(=|$)/.test(arg))) {
    throw new Error("The focus gateway requires private CDP pipes, sandboxing and GPU rendering");
  }
}

export async function serve(command: string[], userDataDir: string): Promise<void> {
  validateLaunch(command);
  const lease = consumeLaunch();
  const child = spawn(command[0]!, command.slice(1), {stdio: ["ignore", "inherit", "inherit", "pipe", "pipe"]});
  const writer = child.stdio[3] as Writable;
  const reader = child.stdio[4] as Readable;
  const gateway = new FocusGateway(lease.browserId, readLease, message => writer.write(message + "\0"));
  let ready = false, buffer = "", stopping = false, product = "Chrome/0";
  const server = Bun.serve<{mode: InteractionMode}>({
    hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      if (request.headers.get("host") !== `127.0.0.1:${server.port}` || request.headers.has("origin") || request.headers.has("sec-fetch-site") || url.search) return new Response("Forbidden", {status: 403});
      for (const mode of ["background", "foreground", "direct"] as const) {
        const version = gatewayVersion(lease.browserId, server.port!, mode, product);
        const metadataPath = `${mode === "background" ? "" : `/${mode}`}/json/version`;
        const socketPath = new URL(version.webSocketDebuggerUrl).pathname;
        if (ready && request.method === "GET" && [metadataPath, socketPath].includes(url.pathname)) {
          try { new FocusPolicy(lease.browserId, readLease, Date.now, mode).connectionAllowed(); }
          catch { return new Response("Explicit foreground/direct-CDP approval is missing or expired", {status: 403}); }
          if (url.pathname === metadataPath) return Response.json(version);
          if (server.upgrade(request, {data: {mode}})) return;
        }
      }
      return new Response("Unavailable; only guarded CDP is supported", {status: 403});
    },
    websocket: {
      maxPayloadLength: 1_000_000,
      open(socket) { if (!gateway.connect(socket, socket.data.mode)) socket.close(1013, "Another helper is connected; do not retry writes"); },
      message(socket, message) { gateway.receive(socket, typeof message === "string" ? message : message.toString()); },
      close(socket) { gateway.disconnect(socket); },
    },
  });
  const directServer = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request, discovery) {
      const url = new URL(request.url);
      if (request.headers.get("host") !== `127.0.0.1:${discovery.port}` || request.headers.has("origin") || request.headers.has("sec-fetch-site") || url.search) return new Response("Forbidden", {status: 403});
      if (!ready || request.method !== "GET" || url.pathname !== "/json/version") return new Response("Not found", {status: 404});
      try { new FocusPolicy(lease.browserId, readLease, Date.now, "direct").connectionAllowed(); }
      catch { return new Response("Explicit direct-CDP approval is missing or expired", {status: 403}); }
      return Response.json(gatewayVersion(lease.browserId, server.port!, "direct", product));
    },
  });
  let resolveReady: () => void, rejectReady: (error: Error) => void;
  const startup = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timeout = setTimeout(() => rejectReady(new Error("Private browser pipe startup timed out")), 15_000);
  reader.setEncoding("utf8");
  reader.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 32_000_000) { gateway.fail(); child.kill("SIGTERM"); return; }
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let parsed: any;
      try { parsed = parseBrowserFrame(message); } catch {
        gateway.fail(); rejectReady(new Error("Invalid private browser frame")); child.kill("SIGTERM"); return;
      }
      if (!ready && parsed.id === 0) {
        if (parsed.error || typeof parsed.result?.product !== "string" || !parsed.result.product) rejectReady(new Error("Private browser identity unavailable"));
        else { product = parsed.result.product; ready = true; resolveReady(); }
      } else gateway.fromBrowser(message);
    }
  });
  writer.on("error", () => { gateway.fail(); rejectReady(new Error("Private browser pipe failed")); });
  reader.on("error", () => { gateway.fail(); rejectReady(new Error("Private browser pipe failed")); });
  child.on("error", () => { gateway.fail(); rejectReady(new Error("Jailed browser could not start")); });
  const exited = new Promise<void>(resolve => child.once("exit", () => { gateway.fail(); rejectReady(new Error("Jailed browser exited")); resolve(); }));
  const stop = () => {
    if (stopping) return;
    stopping = true;
    writer.write(JSON.stringify({id: -1, method: "Browser.close"}) + "\0");
    setTimeout(() => child.kill("SIGTERM"), 3000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    writer.write(JSON.stringify({id: 0, method: "Browser.getVersion"}) + "\0");
    await startup;
    clearTimeout(timeout);
    writePrivateJson(gatewayPath(), {mode: "host", port: server.port, directPort: directServer.port, browserId: lease.browserId,
      focusProtocol: FOCUS_PROTOCOL, webSocketDebuggerUrl: gatewayVersion(lease.browserId, server.port!).webSocketDebuggerUrl, userDataDir});
    console.log("Guarded browser ready; passive inspection is the default, foreground/direct CDP require explicit approval");
    await exited;
  } finally {
    clearTimeout(timeout);
    gateway.fail();
    server.stop(true);
    directServer.stop(true);
    if (child.exitCode === null) child.kill("SIGTERM");
    rmSync(gatewayPath(), {force: true});
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] !== "--user-data-dir" || !args[1] || args[2] !== "--") throw new Error("Usage: serve.ts --user-data-dir DIR -- JAILED_LAUNCHER --remote-debugging-pipe");
  await serve(args.slice(3), args[1]);
}
