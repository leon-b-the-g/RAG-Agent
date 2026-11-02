import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/rags';

export const pool = new pg.Pool({ connectionString: url, max: 8 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Reads run as the restricted role (APP_DATABASE_URL, no RLS bypass) inside one transaction that
 * carries the caller: app.tenant and app.principals drive the row-level-security policies in
 * sql/002_acl_rls.sql. '*' is always added so tenant-wide documents are visible. Falls back to the
 * owner connection when APP_DATABASE_URL is unset (dev/CI without the role), where the SQL WHERE
 * clauses in search.ts still enforce the same rule.
 */
export const appPool = process.env.APP_DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 8 })
  : pool;

export type Caller = { tenant: string; principals: string[] };

export function callerPrincipals({ principals }: Caller): string[] {
  for (const p of principals)
    if (!p || p.includes(',')) throw new Error(`invalid principal: ${JSON.stringify(p)}`);
  return [...new Set([...principals, '*'])];
}

export async function withCaller<T>(
  caller: Caller,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT set_config($1, $2, true), set_config($3, $4, true)', [
      'app.tenant',
      caller.tenant,
      'app.principals',
      callerPrincipals(caller).join(','),
    ]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export const endPools = () => Promise.all([pool.end(), appPool !== pool && appPool.end()]);

/** pgvector literal: '[0.1,0.2,...]' */
export const vec = (v: number[]) => `[${v.join(',')}]`;
