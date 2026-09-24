import type { HubMessage, MessageOf } from './protocol';

type Handler = (message: never) => void;

/** The hub's WebSocket, reconnecting on its own when the hub restarts. */
export class HubClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly connectionHandlers = new Set<(connected: boolean) => void>();
  private retryDelay = 500;
  private closed = false;
  connected = false;

  constructor(private readonly url: string = defaultSocketUrl()) {}

  connect(): this {
    this.closed = false;
    this.open();
    return this;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  on<K extends HubMessage['type']>(type: K, handler: (message: MessageOf<K>) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler);
    return () => set.delete(handler as Handler);
  }

  onConnection(handler: (connected: boolean) => void): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retryDelay = 500;
      this.setConnected(true);
    };
    ws.onmessage = (event) => {
      let message: HubMessage;
      try {
        message = JSON.parse(event.data as string) as HubMessage;
      } catch {
        return;
      }
      this.handlers.get(message.type)?.forEach((handler) => (handler as (m: HubMessage) => void)(message));
    };
    ws.onclose = () => {
      this.setConnected(false);
      if (!this.closed) {
        setTimeout(() => this.open(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 5000);
      }
    };
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.connectionHandlers.forEach((handler) => handler(connected));
  }
}

/**
 * `?hub=ws://host:port/ws` overrides; otherwise the page's own host. `kind`
 * tells the hub which page this is (it opens a browser tab only when no
 * Studio is connected).
 */
export function defaultSocketUrl(kind: 'studio' | 'render' | 'other' = 'other'): string {
  const override = new URLSearchParams(location.search).get('hub');
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(override ?? `${protocol}//${location.host}/ws`);
  url.searchParams.set('client', kind);
  return url.toString();
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error((detail as { error?: string } | null)?.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}
