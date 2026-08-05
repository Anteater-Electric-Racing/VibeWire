import type { IncomingMessage, ServerResponse } from 'node:http';

interface Client {
  req: IncomingMessage;
  res: ServerResponse;
  cleanup: () => void;
}

const clientsByHarness = new Map<string, Set<Client>>();
let nextEventId = 1n;

function removeClient(harness: string, client: Client): void {
  const clients = clientsByHarness.get(harness);
  if (!clients) return;
  clients.delete(client);
  if (clients.size === 0) clientsByHarness.delete(harness);
}

function isWritable(res: ServerResponse): boolean {
  return !res.destroyed && !res.writableEnded && res.writable;
}

export function addClient(
  req: IncomingMessage,
  res: ServerResponse,
  harness: string,
): () => void {
  let cleaned = false;
  let keepalive: NodeJS.Timeout | undefined;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (keepalive) clearInterval(keepalive);
    if (client) removeClient(harness, client);
    req.removeListener('aborted', cleanup);
    req.removeListener('close', cleanup);
    req.removeListener('error', cleanup);
    res.removeListener('close', cleanup);
    res.removeListener('error', cleanup);
  };

  const safeWrite = (chunk: string): boolean => {
    if (cleaned || !isWritable(res)) {
      cleanup();
      return false;
    }
    try {
      res.write(chunk, (error?: Error | null) => {
        if (error) cleanup();
      });
      return true;
    } catch {
      cleanup();
      return false;
    }
  };

  const client: Client = { req, res, cleanup };

  try {
    if (res.headersSent || res.writableEnded || res.destroyed) {
      cleanup();
      return cleanup;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const clients = clientsByHarness.get(harness) ?? new Set<Client>();
    clients.add(client);
    clientsByHarness.set(harness, clients);

    req.once('aborted', cleanup);
    req.once('close', cleanup);
    req.once('error', cleanup);
    res.once('close', cleanup);
    res.once('error', cleanup);

    if (!safeWrite(': connected\n\n')) return cleanup;
    keepalive = setInterval(() => {
      safeWrite(': ping\n\n');
    }, 20_000);
    keepalive.unref();
  } catch {
    cleanup();
  }

  return cleanup;
}

export function broadcast(harness: string, event: string, data: unknown): string | null {
  try {
    if (!/^[^\r\n:]+$/.test(event)) return null;
    const encoded = JSON.stringify(data);
    if (encoded === undefined) return null;
    const eventId = String(nextEventId);
    nextEventId += 1n;
    const frame = `id: ${eventId}\nevent: ${event}\ndata: ${encoded}\n\n`;
    const clients = clientsByHarness.get(harness);
    if (!clients) return eventId;

    for (const client of [...clients]) {
      try {
        if (!isWritable(client.res)) {
          client.cleanup();
          continue;
        }
        client.res.write(frame, (error?: Error | null) => {
          if (error) client.cleanup();
        });
      } catch {
        client.cleanup();
      }
    }
    return eventId;
  } catch {
    return null;
  }
}

export function clientCount(harness: string): number {
  try {
    const clients = clientsByHarness.get(harness);
    if (!clients) return 0;
    for (const client of [...clients]) {
      if (!isWritable(client.res)) client.cleanup();
    }
    return clientsByHarness.get(harness)?.size ?? 0;
  } catch {
    return 0;
  }
}
