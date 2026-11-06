import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { ask } from './ask.js';
import { search, type Mode } from './search.js';

/**
 * Minimal HTTP face for the demo page and integrations. node:http only, no framework.
 *   GET  /            demo page (public/index.html)
 *   GET  /health      { ok: true }
 *   POST /search      { question, mode?, k?, tenant?, principals? } -> { hits }
 *   POST /ask         same body -> { answer, citations, usage, retrieveMs, answerMs }
 * The caller identity (tenant, principals) is trusted as sent: put an auth proxy in front before exposing this.
 */
const PORT = Number(process.env.PORT ?? 3000);
// loopback by default: the API has no auth of its own, so exposing it is an explicit HOST=0.0.0.0 behind a proxy
const HOST = process.env.HOST ?? '127.0.0.1';
const MODES = new Set<Mode>(['dense', 'fts', 'hybrid']);

type Body = {
  question?: unknown;
  mode?: unknown;
  k?: unknown;
  tenant?: unknown;
  principals?: unknown;
};

function parseBody(b: Body) {
  if (typeof b.question !== 'string' || !b.question.trim()) throw new Error('question required');
  const mode = (b.mode ?? 'hybrid') as Mode;
  if (!MODES.has(mode)) throw new Error('mode must be dense|fts|hybrid');
  const k = b.k === undefined ? undefined : Number(b.k);
  if (k !== undefined && !(k >= 1 && k <= 50)) throw new Error('k must be 1..50');
  const tenant = b.tenant === undefined ? undefined : String(b.tenant);
  const principals = Array.isArray(b.principals) ? b.principals.map(String) : undefined;
  return { question: b.question, mode, k, tenant, principals };
}

const json = (res: import('node:http').ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

export const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(await readFile(new URL('../public/index.html', import.meta.url)));
    }
    if (req.method === 'POST' && (req.url === '/ask' || req.url === '/search')) {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64_000) return json(res, 413, { error: 'body too large' });
      }
      const b = parseBody(JSON.parse(raw || '{}'));
      if (req.url === '/search') {
        const hits = await search(b.question, b.mode, b.k ?? 10, b.tenant, b.principals);
        return json(res, 200, { hits });
      }
      const a = await ask(b.question, b);
      return json(res, 200, {
        answer: a.text,
        citations: a.hits.map((h, i) => ({ n: i + 1, ...h })),
        usage: a.usage,
        retrieveMs: a.retrieveMs,
        answerMs: a.answerMs,
      });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    const msg = (e as Error).message;
    json(res, /required|must be|JSON/.test(msg) ? 400 : 500, { error: msg });
  }
});

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js'))
  server.listen(PORT, HOST, () => console.log(`rags2riches on http://${HOST}:${PORT}`));
