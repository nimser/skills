import {createReadStream, writeSync} from "node:fs";

let buffer = "", target = 0, session = 0, discover = false, auto = false;
const targets = new Map([["owned", {targetId: "owned", type: "page", url: "about:blank", title: "Fixture", attached: false, canAccessOpener: false}]]);
const send = (message: any) => writeSync(4, JSON.stringify(message) + "\0");
if (process.argv.includes("--malformed-startup")) send(null);
const announce = (info: any) => {
  if (discover) send({method: "Target.targetCreated", params: {targetInfo: info}});
  if (auto) send({method: "Target.attachedToTarget", params: {sessionId: `auto-${++session}`, targetInfo: info, waitingForDebugger: false}});
};
const stream = createReadStream("", {fd: 3, autoClose: false, encoding: "utf8"});
stream.on("data", chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id > 0 && message.method === "Browser.getVersion" && process.argv.includes("--malformed-runtime")) { send(null); continue; }
    let result: any = {}, event: (() => void) | undefined;
    switch (message.method) {
      case "Browser.close": process.exit(0);
      case "Browser.getVersion": result = {product: "Chrome/134.0.0.0", userAgent: "fixture", protocolVersion: "1.3"}; break;
      case "Target.getBrowserContexts": result = {browserContextIds: []}; break;
      case "Target.getTargets": result = {targetInfos: [...targets.values()]}; break;
      case "Target.getTargetInfo": result = {targetInfo: targets.get(message.params.targetId)}; break;
      case "Target.setDiscoverTargets": discover = message.params.discover; event = () => { for (const info of targets.values()) if (discover) send({method: "Target.targetCreated", params: {targetInfo: info}}); }; break;
      case "Target.setAutoAttach":
        if (!message.sessionId) { auto = message.params.autoAttach; event = () => { if (auto) for (const info of targets.values()) send({method: "Target.attachedToTarget", params: {sessionId: `auto-${++session}`, targetInfo: info, waitingForDebugger: false}}); }; }
        break;
      case "Target.createTarget": {
        const targetId = `created-${++target}`;
        const info = {targetId, type: "page", url: "about:blank", title: "Fixture", attached: false, canAccessOpener: false};
        targets.set(targetId, info); result = {targetId}; event = () => announce(info); break;
      }
      case "Target.attachToTarget":
        result = {sessionId: `session-${++session}`};
        send({method: "Target.attachedToTarget", params: {sessionId: result.sessionId, targetInfo: targets.get(message.params.targetId), waitingForDebugger: false}, ...(message.sessionId ? {sessionId: message.sessionId} : {})});
        break;
      case "Page.getFrameTree": result = {frameTree: {frame: {id: "frame", loaderId: "loader", url: "http://127.0.0.1/fixture", securityOrigin: "http://127.0.0.1", mimeType: "text/html"}}}; break;
      case "DOM.getDocument": result = {root: {nodeId: 1}}; break;
      case "DOM.querySelectorAll": result = {nodeIds: [2]}; break;
      case "DOM.describeNode": result = {node: {localName: "input", attributes: ["id", "fixture", "type", "text", "value", "PRIVATE INPUT"]}}; break;
      case "Runtime.evaluate": result = {result: {value: {fixture: true}}}; break;
      case "Page.captureScreenshot": result = {data: Buffer.from("fixture-image").toString("base64")}; break;
    }
    send({id: message.id, result, ...(message.sessionId ? {sessionId: message.sessionId} : {})});
    event?.();
  }
});
