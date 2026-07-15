import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

export const LOGS_DIR = path.join(DATA_DIR, "logs");

/**
 * Raw-response debug logging: on by default in development; DEBUG_RESPONSE_LOG
 * overrides everywhere and is the only switch in production ("0"/"false"/"off"
 * disable, anything else enables).
 */
export function debugResponseLogEnabled(): boolean {
  const v = process.env.DEBUG_RESPONSE_LOG?.trim();
  if (v) return !["0", "false", "off"].includes(v.toLowerCase());
  return process.env.NODE_ENV !== "production";
}

/**
 * Write a debug log file under DATA_DIR/logs; returns its download URL.
 * The name must survive the download route's filename check: lowercase
 * prefix, then timestamp/counter chars only.
 */
export function writeDebugLog(prefix: string, content: string): string {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${prefix}-${stamp}.log`;
  fs.writeFileSync(path.join(LOGS_DIR, name), content);
  return `/api/debug/logs/${name}`;
}
