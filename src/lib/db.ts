import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { v4 as uuidv4 } from "uuid";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* The app runs NO DDL — the schema lives in migrations/*.sql, applied to the
 * database out-of-band (fresh volumes: the compose file mounts the directory
 * into postgres's init dir; existing databases: psql, manually). A missing
 * table here means the migrations haven't been applied. */

// Env is read lazily (at first query, not import) so test files can set it in
// module scope: imports hoist above those assignments, but the pool doesn't
// exist until the first query runs.
const databaseUrl = () =>
  process.env.DATABASE_URL ?? "postgres://animachat:animachat@localhost:5432/animachat";

// Test isolation: a throwaway schema per test file keeps parallel vitest files
// off each other's tables and off the dev data in `public`. The tests create
// the schema and apply migrations/*.sql into it themselves (see testDb.ts).
const pgSchema = () => process.env.ANIMACHAT_PG_SCHEMA;

type TypeMap = { bigint: number };
type Sql = postgres.Sql<TypeMap>;

declare global {
  var __animachatSql: Sql | undefined;
}

function baseSql(): Sql {
  let sql = globalThis.__animachatSql;
  if (!sql) {
    const schema = pgSchema();
    sql = postgres(databaseUrl(), {
      max: 10,
      onnotice: () => {},
      connection: {
        // day bucketing in usageReport renders timestamps in the server
        // process's timezone (the old SQLite 'localtime')
        TimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(schema ? { search_path: schema } : {}),
      },
      types: {
        // int8 → Number (COUNT/SUM/BIGINT columns); ms epochs sit far below 2^53
        bigint: { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
      },
    });
    globalThis.__animachatSql = sql;
  }
  return sql;
}

/* ---------------- query helpers ----------------
 * The store keeps its SQL as plain strings with `?` placeholders (the SQLite
 * shape); these helpers convert to $n and run them on the pool — or on the
 * ambient transaction, carried via AsyncLocalStorage so nested store calls
 * (e.g. appendMessage inside a fork copy) join it automatically. */

const txStore = new AsyncLocalStorage<postgres.TransactionSql<TypeMap>>();

function db(): Sql | postgres.TransactionSql<TypeMap> {
  return txStore.getStore() ?? baseSql();
}

function toPositional(q: string): string {
  let n = 0;
  return q.replace(/\?/g, () => `$${++n}`);
}

export type Row = Record<string, any>;

export async function all<T = Row>(q: string, args: unknown[] = []): Promise<T[]> {
  return (await db().unsafe(toPositional(q), args as any)) as unknown as T[];
}

export async function get<T = Row>(q: string, args: unknown[] = []): Promise<T | undefined> {
  return (await all<T>(q, args))[0];
}

export async function run(q: string, args: unknown[] = []): Promise<void> {
  await all(q, args);
}

/** Execute raw (possibly multi-statement) SQL verbatim — no placeholder
 *  conversion. Test harness use: schema creation and applying migration files. */
export async function execRaw(sqlText: string): Promise<void> {
  await db().unsafe(sqlText);
}

/** Run several store mutations atomically. Nested calls join the outer
 *  transaction via savepoints. The body runs on a single reserved connection —
 *  don't fan out store calls with Promise.all inside it. */
export async function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const cur = txStore.getStore();
  if (cur) return cur.savepoint((sp) => txStore.run(sp, fn)) as Promise<T>;
  return baseSql().begin((tx) => txStore.run(tx, fn)) as Promise<T>;
}

/** Serialize timeline mutations per chat: a transaction-scoped row lock on the
 *  chat. SQLite serialized every write by nature; Postgres interleaves, and the
 *  tail freeze / MAX(position) / tail re-check logic all assume one writer per
 *  chat at a time. Call inside inTransaction. */
export async function lockChat(chatId: string): Promise<void> {
  await run("SELECT 1 FROM chats WHERE id=? FOR UPDATE", [chatId]);
}

/** Close the pool (tests). */
export async function closeDb(): Promise<void> {
  await globalThis.__animachatSql?.end({ timeout: 5 });
  globalThis.__animachatSql = undefined;
}

export const now = () => Date.now();
export const uid = () => uuidv4();
