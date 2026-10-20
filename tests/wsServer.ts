/**
 * Just enough of a WebSocket server (RFC 6455) for tests: the handshake, text
 * frames both ways, ping and close. The app's DevTools client is Node's own
 * WebSocket (undici's), and it talks to this exactly as it talks to Chrome.
 */
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WsPeer {
  send(text: string): void;
  sendBinary(data: Buffer): void;
  close(): void;
}

export interface WsServer {
  readonly port: number;
  /** Peers connected so far. */
  readonly peers: readonly WsPeer[];
  stop(): Promise<void>;
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const head =
    length < 126
      ? Buffer.from([0x80 | opcode, length])
      : length < 65_536
        ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => {
            const size = Buffer.alloc(8);
            size.writeBigUInt64BE(BigInt(length));
            return size;
          })()]);
  return Buffer.concat([head, payload]);
}

/** Reads complete client frames off `buffer`; returns the frames and what is left over. */
function readFrames(buffer: Buffer): { frames: { opcode: number; payload: Buffer }[]; rest: Buffer } {
  const frames: { opcode: number; payload: Buffer }[] = [];
  let offset = 0;
  for (;;) {
    if (buffer.length - offset < 2) break;
    const opcode = buffer[offset]! & 0x0f;
    let length = buffer[offset + 1]! & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    // Clients always mask their frames.
    if (buffer.length < cursor + 4 + length) break;
    const mask = buffer.subarray(cursor, cursor + 4);
    const payload = Buffer.from(buffer.subarray(cursor + 4, cursor + 4 + length));
    for (let index = 0; index < payload.length; index++) payload[index]! ^= mask[index % 4]!;
    frames.push({ opcode, payload });
    offset = cursor + 4 + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/** Serves WebSockets on a free local port, handing each text message to `onMessage`. */
export async function startWsServer(onMessage: (peer: WsPeer, text: string) => void): Promise<WsServer> {
  const peers: WsPeer[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((_request, response) => response.writeHead(404).end());
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (request, socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // A client that closes while we write gives EPIPE or ECONNRESET (on Linux especially).
    // Unheard, that error would end the test run, though no test failed.
    socket.on('error', () => socket.destroy());
    const accept = createHash('sha1').update(`${String(request.headers['sec-websocket-key'])}${GUID}`).digest('base64');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));

    const open = () => !socket.destroyed && !socket.writableEnded;
    const peer: WsPeer = {
      send: (text) => {
        if (open()) socket.write(frame(0x1, Buffer.from(text)));
      },
      sendBinary: (data) => {
        if (open()) socket.write(frame(0x2, data));
      },
      close: () => {
        if (open()) socket.end(frame(0x8, Buffer.alloc(0)));
      },
    };
    peers.push(peer);

    let pending: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      const { frames, rest } = readFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const { opcode, payload } of frames) {
        if (opcode === 0x1) onMessage(peer, payload.toString('utf8'));
        else if (opcode === 0x8) peer.close();
        else if (opcode === 0x9 && open()) socket.write(frame(0xa, payload));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    peers,
    stop: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
