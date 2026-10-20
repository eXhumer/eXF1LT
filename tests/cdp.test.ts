import { afterEach, describe, expect, it, vi } from 'vitest';

import { CdpClient, CdpError, type CdpTransport, connectWebSocket } from '../src/auth/cdp.js';
import { eventually } from './helpers.js';
import { startWsServer, type WsServer } from './wsServer.js';

/** A transport the test drives: it sees what the client sends and pushes what the browser says. */
function memoryTransport() {
  const sent: Record<string, unknown>[] = [];
  let receive: (data: string) => void = () => undefined;
  let closed: () => void = () => undefined;
  const transport: CdpTransport = {
    send: (data) => void sent.push(JSON.parse(data) as Record<string, unknown>),
    close: vi.fn(),
    onMessage: (listener) => (receive = listener),
    onClose: (listener) => (closed = listener),
  };
  return { transport, sent, receive: (message: unknown) => receive(typeof message === 'string' ? message : JSON.stringify(message)), close: () => closed() };
}

describe('CdpClient', () => {
  it('matches answers to commands, with a default message for an error without one', async () => {
    const browser = memoryTransport();
    const client = new CdpClient(browser.transport);
    const ok = client.send('Target.getTargets');
    const failed = client.send('Page.navigate', { url: 'x' }, 'session-1');
    expect(browser.sent).toEqual([
      { id: 1, method: 'Target.getTargets', params: {} },
      { id: 2, method: 'Page.navigate', params: { url: 'x' }, sessionId: 'session-1' },
    ]);
    browser.receive('not json');
    browser.receive({ id: 99, result: {} }); // an answer to nothing
    browser.receive({ id: 1 });
    browser.receive({ id: 2, error: {} });
    await expect(ok).resolves.toEqual({});
    await expect(failed).rejects.toEqual(new CdpError('DevTools command failed.'));
  });

  it('passes events on, without params when there are none, and ignores messages that are neither', () => {
    const browser = memoryTransport();
    const client = new CdpClient(browser.transport);
    const events: unknown[] = [];
    const stop = client.onEvent((event) => events.push(event));
    browser.receive({ method: 'Target.targetCreated' });
    browser.receive({ result: 'stray' });
    stop();
    browser.receive({ method: 'Target.targetDestroyed', params: {} });
    expect(events).toEqual([{ method: 'Target.targetCreated', params: {}, sessionId: undefined }]);
  });

  it('fails pending and later commands once closed, and tells close listeners once', async () => {
    const browser = memoryTransport();
    const client = new CdpClient(browser.transport);
    const onClose = vi.fn();
    client.onClose(onClose);
    const pending = client.send('Browser.close');
    client.close();
    browser.close(); // the transport reports the close too
    await expect(pending).rejects.toThrow('The browser connection closed.');
    await expect(client.send('Target.getTargets')).rejects.toThrow('The browser connection is closed.');
    expect(browser.transport.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('connectWebSocket', () => {
  let server: WsServer | undefined;
  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('talks to a DevTools endpoint over a real WebSocket and sees it close', async () => {
    server = await startWsServer((peer, text) => {
      const { id } = JSON.parse(text) as { id: number };
      peer.send(JSON.stringify({ id, result: { product: 'Chrome/155' } }));
    });
    const client = new CdpClient(await connectWebSocket(`ws://127.0.0.1:${server.port}/devtools/browser/x`));
    await expect(client.send('Browser.getVersion')).resolves.toEqual({ product: 'Chrome/155' });

    const closed = vi.fn();
    client.onClose(closed);
    server.peers[0]!.close();
    await eventually(() => expect(closed).toHaveBeenCalled());
  });

  it('closes from our side', async () => {
    server = await startWsServer(() => undefined);
    const transport = await connectWebSocket(`ws://127.0.0.1:${server.port}/devtools/browser/x`);
    const closed = vi.fn();
    transport.onClose(closed);
    transport.close();
    await eventually(() => expect(closed).toHaveBeenCalled());
  });

  it('decodes binary frames as UTF-8 text', async () => {
    server = await startWsServer(() => undefined);
    const transport = await connectWebSocket(`ws://127.0.0.1:${server.port}/devtools/browser/x`);
    const received: string[] = [];
    transport.onMessage((data) => received.push(data));
    server.peers[0]!.sendBinary(Buffer.from('{"method":"Ünïcode"}'));
    server.peers[0]!.send('{"method":"text"}');
    await eventually(() => expect(received).toEqual(['{"method":"Ünïcode"}', '{"method":"text"}']));
    transport.close();
  });

  it('explains a browser that is not there', async () => {
    const gone = await startWsServer(() => undefined);
    const port = gone.port;
    await gone.stop();
    await expect(connectWebSocket(`ws://127.0.0.1:${port}/devtools/browser/x`)).rejects.toThrow(
      `Could not connect to the browser at ws://127.0.0.1:${port}/devtools/browser/x.`,
    );
  });
});
