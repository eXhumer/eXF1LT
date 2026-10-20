/**
 * A minimal Chrome DevTools Protocol client: JSON messages over one WebSocket.
 * Chrome, Edge and Brave all speak it, on every platform, and Node ships a
 * WebSocket client, so no dependency is needed.
 */

export interface CdpTransport {
  send(data: string): void;
  close(): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: () => void): void;
}

export interface CdpEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId: string | undefined;
}

export class CdpError extends Error {
  override readonly name = 'CdpError';
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

export class CdpClient {
  readonly #transport: CdpTransport;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners = new Set<(event: CdpEvent) => void>();
  readonly #closeListeners = new Set<() => void>();
  #nextId = 1;
  #closed = false;

  constructor(transport: CdpTransport) {
    this.#transport = transport;
    transport.onMessage((data) => this.#receive(data));
    transport.onClose(() => this.#handleClose());
  }

  send<T = Record<string, unknown>>(method: string, params: object = {}, sessionId?: string): Promise<T> {
    if (this.#closed) return Promise.reject(new CdpError('The browser connection is closed.'));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.#transport.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onClose(listener: () => void): void {
    this.#closeListeners.add(listener);
  }

  close(): void {
    this.#transport.close();
    this.#handleClose();
  }

  #receive(data: string): void {
    let message: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(data) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new CdpError(message.error.message ?? 'DevTools command failed.'));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (typeof message.method === 'string') {
      const event: CdpEvent = { method: message.method, params: message.params ?? {}, sessionId: message.sessionId };
      for (const listener of [...this.#listeners]) listener(event);
    }
  }

  #handleClose(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) pending.reject(new CdpError('The browser connection closed.'));
    this.#pending.clear();
    for (const listener of [...this.#closeListeners]) listener();
  }
}

/** Open a DevTools WebSocket (`ws://127.0.0.1:<port>/devtools/browser/<id>`). */
export function connectWebSocket(url: string): Promise<CdpTransport> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    // DevTools speaks text frames; decode a binary one rather than read it as "[object Blob]".
    socket.binaryType = 'arraybuffer';
    const messageListeners: Array<(data: string) => void> = [];
    const closeListeners: Array<() => void> = [];
    socket.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      for (const listener of messageListeners) listener(data);
    });
    socket.addEventListener('close', () => {
      for (const listener of closeListeners) listener();
    });
    socket.addEventListener('error', () => reject(new CdpError(`Could not connect to the browser at ${url}.`)), {
      once: true,
    });
    socket.addEventListener(
      'open',
      () =>
        resolve({
          send: (data) => socket.send(data),
          close: () => socket.close(),
          onMessage: (listener) => void messageListeners.push(listener),
          onClose: (listener) => void closeListeners.push(listener),
        }),
      { once: true },
    );
  });
}
