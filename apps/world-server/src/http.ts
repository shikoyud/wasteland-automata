import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiError, ERROR_STATUS, type ApiError } from './errors.ts';

const MAX_BODY_BYTES = 16 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export function sendError(res: ServerResponse, error: ApiError, headers: Record<string, string> = {}): void {
  sendJson(res, ERROR_STATUS[error.error.code], error, headers);
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; message: string };

/** Reads a JSON request body of at most 16 KB. */
export async function readJson(req: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { ok: false, message: `Body is larger than ${MAX_BODY_BYTES / 1024} KB.` };
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return { ok: false, message: 'Body is empty; send one JSON object.' };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: 'Body is not valid JSON.' };
  }
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? (m[1] as string) : null;
}

export function notFound(res: ServerResponse): void {
  sendError(res, apiError('NOT_FOUND', 'No such endpoint. See openapi.yaml for the API.'));
}
