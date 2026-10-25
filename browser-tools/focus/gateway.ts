import {FocusDenied, FocusPolicy, FOCUS_PROTOCOL, type Command} from "./policy.ts";

interface Peer { send(value: string): unknown; close(code?: number, reason?: string): unknown }
export class FocusGateway {
  private peer?: Peer;
  private policy?: FocusPolicy;
  private wireId = 0;
  private readonly calls = new Map<number, {peer: Peer; original: Command}>();
  private readonly created = new Map<string, number>();
  constructor(readonly browserId: string, private readonly lease: () => unknown, private readonly upstream: (message: string) => void, private readonly now = Date.now) {}

  connect(peer: Peer): boolean {
    if (this.peer) return false;
    this.peer = peer;
    this.policy = new FocusPolicy(this.browserId, this.lease, this.now);
    try {
      const lease = this.policy.currentLease();
      for (const [target, issuedAt] of this.created) if (issuedAt === lease.issuedAt) this.policy.createdTargets.add(target);
    } catch { /* Commands fail before dispatch when no lease is active. */ }
    return true;
  }
  disconnect(peer: Peer): void {
    if (this.peer !== peer) return;
    this.peer = undefined;
    this.policy = undefined;
    for (const [id, call] of this.calls) if (call.peer === peer) this.calls.delete(id);
  }
  receive(peer: Peer, text: string): void {
    let command: Command | undefined;
    let submitted = false;
    try {
      if (peer !== this.peer || !this.policy) throw new FocusDenied("another helper owns the gateway connection");
      if (text.length > 1_000_000) throw new FocusDenied("command exceeds the bounded transport size");
      command = JSON.parse(text);
      if (!command || typeof command !== "object") throw new FocusDenied("invalid protocol message");
      this.policy.authorize(command);
      const wireId = ++this.wireId;
      this.calls.set(wireId, {peer, original: command});
      submitted = true;
      this.upstream(JSON.stringify({...command, id: wireId}));
    } catch (error) {
      if (submitted) { this.fail(); return; }
      peer.send(JSON.stringify({id: command?.id ?? 0, ...(command?.sessionId ? {sessionId: command.sessionId} : {}), error: {code: -32001, message: error instanceof FocusDenied ? error.message : new FocusDenied("invalid or unavailable protocol operation").message}}));
    }
  }
  fromBrowser(text: string): void {
    let message: any;
    try { message = JSON.parse(text); } catch { this.fail(); return; }
    if (typeof message.id === "number") {
      const call = this.calls.get(message.id);
      if (!call) return;
      this.calls.delete(message.id);
      if (call.peer !== this.peer || !this.policy) return;
      message.id = call.original.id;
      this.policy.observe(message);
      if (!message.error && call.original.method === "Target.createTarget") {
        try { this.created.set(message.result.targetId, this.policy.currentLease().issuedAt); } catch { /* An expired action is uncertain, not retried. */ }
      }
      call.peer.send(JSON.stringify(message));
    } else if (this.peer && this.policy) {
      if (message.sessionId && !this.policy.sessions.has(message.sessionId)) return;
      this.policy.observe(message);
      if (message.method === "Target.targetDestroyed") this.created.delete(message.params?.targetId);
      this.peer.send(text);
    }
  }
  fail(): void {
    this.peer?.close(1011, "Browser transport unavailable; outcomes can be uncertain");
    this.peer = undefined;
    this.policy = undefined;
    this.calls.clear();
  }
}
export function gatewayVersion(browserId: string, port: number) {
  return {Browser: "BrowserTools/1", "Protocol-Version": "1.3", focusProtocol: FOCUS_PROTOCOL,
    browserId, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${browserId}`};
}
