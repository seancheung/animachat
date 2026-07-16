import fs from "node:fs";
import path from "node:path";
import { closeDb, execRaw } from "./db";

/* Vitest harness for db-touching test files: the app runs no DDL, so each test
 * file creates its throwaway schema (ANIMACHAT_PG_SCHEMA, set before the first
 * query) and applies migrations/*.sql into it here. Not imported by app code. */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

/** Create the test schema and apply every migration into it (the pool's
 *  search_path already points at the schema). Call in beforeAll. */
export async function initTestSchema(schema: string): Promise<void> {
  await execRaw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) await execRaw(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
}

/** Drop the test schema and close the pool. Call in afterAll. */
export async function dropTestSchema(schema: string): Promise<void> {
  await execRaw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await closeDb();
}
