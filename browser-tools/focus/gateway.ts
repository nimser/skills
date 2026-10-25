import {FocusDenied, FocusPolicy, FOCUS_PROTOCOL, leaseKey, type Command, type InteractionMode} from "./policy.ts";

interface Peer { send(value: string): unknown; close(code?: number, reason?: string): unknown }
export class FocusGateway {
  private peer?: Peer;
  private policy?: FocusPolicy;
  private wireId = 0;
  private readonly calls = new Map<number, {peer: Peer; original: Command; epoch?: string}>();
  private readonly created = new Map<string, string>();
  private readonly owned = new Set<string>();
  constructor(readonly browserId: string, private readonly lease: () => unknown, private readonly upstream: (message: string) => void, private readonly now = Date.now) {}

  connect(peer: Peer, mode: InteractionMode = "background"): boolean {
    if (this.peer) return false;
    this.peer = peer;
    this.policy = new FocusPolicy(this.browserId, this.lease, this.now, mode, this.owned);
    if (mode !== "background") try {
      const epoch = leaseKey(this.policy.currentLease());
      for (const [target, approval] of this.created) if (approval === epoch) this.policy.createdTargets.add(target);
    } catch { /* Elevated commands fail before dispatch without an active lease. */ }
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
      this.calls.set(wireId, {peer, original: command,
        ...(this.policy.mode !== "background" ? {epoch: leaseKey(this.policy.currentLease())} : {})});
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
    if (message.method === "Target.targetDestroyed") {
      this.created.delete(message.params?.targetId);
      this.owned.delete(message.params?.targetId);
    }
    if (typeof message.id === "number") {
      const call = this.calls.get(message.id);
      if (!call) return;
      this.calls.delete(message.id);
      if (call.peer !== this.peer || !this.policy) return;
      message.id = call.original.id;
      this.policy.observe(message);
      if (!message.error && call.original.method === "Target.createTarget") {
        try { if (call.epoch === leaseKey(this.policy.currentLease())) this.created.set(message.result.targetId, call.epoch!); } catch { /* Expired actions are uncertain, not retried. */ }
      }
      try { this.policy.connectionAllowed(); } catch { this.fail(); return; }
      if (!message.error && this.policy.mode !== "direct" && call.original.method === "Target.getTargets") {
        const approved = this.policy.mode === "foreground" ? this.policy.currentLease().targets : [];
        message.result.targetInfos = (message.result?.targetInfos || []).filter((target: any) => this.owned.has(target.targetId) || approved.includes(target.targetId));
      }
      call.peer.send(JSON.stringify(message));
    } else if (this.peer && this.policy) {
      this.policy.observe(message);
      try { this.policy.connectionAllowed(); } catch { this.fail(); return; }
      if (this.policy.mode !== "direct") {
        if (message.sessionId && !this.policy.sessions.has(message.sessionId)) return;
        const target = message.params?.targetInfo?.targetId ?? message.params?.targetId;
        if (!message.sessionId && (!target || !this.owned.has(target))) return;
      }
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
export function gatewayVersion(browserId: string, port: number, mode: InteractionMode = "background", product = "Chrome/0") {
  return {Browser: product, "Protocol-Version": "1.3", focusProtocol: FOCUS_PROTOCOL, interactionMode: mode,
    browserId, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/${browserId}${mode === "background" ? "" : `/${mode}`}`};
}
