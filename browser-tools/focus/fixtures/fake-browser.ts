import {createReadStream, writeSync} from "node:fs";

let buffer = "", target = 0, session = 0;
const targets = new Map([["owned", {targetId: "owned", type: "page", url: "about:blank"}]]);
const stream = createReadStream("", {fd: 3, autoClose: false, encoding: "utf8"});
stream.on("data", chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    let result: any = {};
    switch (message.method) {
      case "Browser.close": process.exit(0);
      case "Browser.getVersion": result = {product: "FakeBrowser/1", userAgent: "fixture", protocolVersion: "1.3"}; break;
      case "Target.getTargets": result = {targetInfos: [...targets.values()]}; break;
      case "Target.createTarget": {
        const targetId = `created-${++target}`;
        targets.set(targetId, {targetId, type: "page", url: "about:blank"});
        result = {targetId}; break;
      }
      case "Target.attachToTarget": result = {sessionId: `session-${++session}`}; break;
      case "Page.getFrameTree": result = {frameTree: {frame: {url: "http://127.0.0.1/fixture"}}}; break;
      case "Runtime.evaluate": result = {result: {value: {fixture: true}}}; break;
      case "Page.captureScreenshot": result = {data: Buffer.from("fixture-image").toString("base64")}; break;
    }
    writeSync(4, JSON.stringify({id: message.id, result, ...(message.sessionId ? {sessionId: message.sessionId} : {})}) + "\0");
  }
});
