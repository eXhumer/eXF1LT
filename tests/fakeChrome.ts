/**
 * A scriptable stand-in for Chrome's DevTools side: it answers the commands the
 * login sends, records them, and plays a scripted series of events once the
 * first page has its network domain enabled. It speaks through any `reply`
 * function, so it runs over the in-memory transport or a real WebSocket.
 */

export interface FakeChromeOptions {
  /** Page targets that exist when the login starts. */
  readonly pages?: readonly string[];
  /** `Target.targetCreated` params sent right after discovery is turned on. */
  readonly created?: readonly object[];
  /** Events sent after `Network.enable` on the first attached page (sessionId `s-<target>`). */
  readonly events?: (sessionId: string) => readonly object[];
  /** What `Network.getResponseBody` answers. */
  readonly body?: { readonly body: string; readonly base64Encoded: boolean };
  /** Commands that fail, with their error message. */
  readonly failing?: Readonly<Record<string, string>>;
}

export interface SentCommand {
  readonly id: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId?: string;
}

export function fakeChrome(options: FakeChromeOptions = {}) {
  const sent: SentCommand[] = [];
  const pages = [...(options.pages ?? ['t1'])];
  let scripted = false;

  /** Handles one message from the client; `reply` sends text back to it. */
  const handle = (text: string, reply: (text: string) => void): void => {
    const command = JSON.parse(text) as SentCommand;
    sent.push(command);
    const answer = (result: object) => reply(JSON.stringify({ id: command.id, result }));
    const emit = (event: object) => reply(JSON.stringify(event));

    const error = options.failing?.[command.method];
    if (error) {
      reply(JSON.stringify({ id: command.id, error: { message: error } }));
      return;
    }
    switch (command.method) {
      case 'Target.setDiscoverTargets':
        answer({});
        for (const params of options.created ?? []) emit({ method: 'Target.targetCreated', params });
        return;
      case 'Target.getTargets':
        answer({ targetInfos: pages.map((targetId) => ({ targetId, type: 'page' })).concat({ targetId: 'sw', type: 'service_worker' }) });
        return;
      case 'Target.createTarget':
        pages.push('created');
        answer({ targetId: 'created' });
        return;
      case 'Target.attachToTarget':
        answer({ sessionId: `s-${String(command.params['targetId'])}` });
        return;
      case 'Network.enable':
        answer({});
        if (!scripted && command.sessionId) {
          scripted = true;
          // After the answer, as Chrome sends them: the page loads once the domain is on.
          setTimeout(() => {
            for (const event of options.events?.(command.sessionId!) ?? []) emit(event);
          }, 5);
        }
        return;
      case 'Network.getResponseBody':
        answer(options.body ?? { body: '{}', base64Encoded: false });
        return;
      default:
        answer({});
    }
  };

  return { handle, sent, methods: () => sent.map((command) => command.method) };
}

/** The network events of one request: sent, answered with `status`, finished. */
export function request(sessionId: string, requestId: string, url: string, method: string, status: number): object[] {
  return [
    { method: 'Network.requestWillBeSent', sessionId, params: { requestId, request: { url, method } } },
    { method: 'Network.responseReceived', sessionId, params: { requestId, response: { status } } },
    { method: 'Network.loadingFinished', sessionId, params: { requestId } },
  ];
}
