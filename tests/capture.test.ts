import { describe, expect, it } from 'vitest';

import { CdpClient, type CdpTransport } from '../src/auth/cdp.js';
import { captureTokenResponse, TOKEN_ENDPOINT } from '../src/auth/login.js';
import { fakeChrome, type FakeChromeOptions, request } from './fakeChrome.js';

/** A client wired to a fake Chrome in memory. */
function connect(options: FakeChromeOptions) {
  const chrome = fakeChrome(options);
  let deliver: (data: string) => void = () => undefined;
  let closed: () => void = () => undefined;
  const transport: CdpTransport = {
    send: (data) => chrome.handle(data, (text) => queueMicrotask(() => deliver(text))),
    close: () => closed(),
    onMessage: (listener) => (deliver = listener),
    onClose: (listener) => (closed = listener),
  };
  return { client: new CdpClient(transport), chrome };
}

describe('captureTokenResponse edge cases', () => {
  it('attaches to new pages once, skips other targets, and ignores events it cannot use', async () => {
    const { client, chrome } = connect({
      created: [
        { targetInfo: { targetId: 't1', type: 'page' } }, // already attached
        { targetInfo: { targetId: 't2', type: 'page' } },
        { targetInfo: { targetId: 'w', type: 'worker' } },
        { targetInfo: { type: 'page' } },
        {},
      ],
      events: (session) => [
        { method: 'Network.requestWillBeSent', params: { requestId: 'r0' } }, // no session
        { method: 'Network.requestWillBeSent', sessionId: session, params: { requestId: 5 } }, // not a request ID
        { method: 'Network.requestWillBeSent', sessionId: session, params: { requestId: 'r1' } }, // no request details
        { method: 'Network.responseReceived', sessionId: session, params: { requestId: 'other', response: { status: 200 } } },
        { method: 'Network.dataReceived', sessionId: session, params: { requestId: 'r1' } },
        ...request(session, 'r2', TOKEN_ENDPOINT, 'POST', 200),
      ],
      body: { body: '{"access_token":"x"}', base64Encoded: false },
    });
    await expect(captureTokenResponse(client, { timeoutMs: 2_000 })).resolves.toBe('{"access_token":"x"}');
    const attached = chrome.sent.filter((command) => command.method === 'Target.attachToTarget').map((command) => command.params['targetId']);
    expect(attached.sort()).toEqual(['t1', 't2']);
  });

  it('keeps the first token response when a second one finishes too', async () => {
    const { client } = connect({
      events: (session) => [...request(session, 'a', TOKEN_ENDPOINT, 'POST', 200), ...request(session, 'b', TOKEN_ENDPOINT, 'POST', 200)],
      body: { body: '{}', base64Encoded: false },
    });
    await expect(captureTokenResponse(client, { timeoutMs: 2_000 })).resolves.toBe('{}');
    // Let the second response's body request come and go.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('fails when the browser cannot list its pages or read the response', async () => {
    const noTargets = connect({ failing: { 'Target.getTargets': 'no targets' } });
    await expect(captureTokenResponse(noTargets.client, { timeoutMs: 2_000 })).rejects.toThrow('no targets');

    const noBody = connect({
      events: (session) => request(session, 'r', TOKEN_ENDPOINT, 'POST', 200),
      failing: { 'Network.getResponseBody': 'body gone' },
    });
    await expect(captureTokenResponse(noBody.client, { timeoutMs: 2_000 })).rejects.toThrow('body gone');
  });
});
