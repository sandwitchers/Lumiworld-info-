/**
 * Shared contracts between the Lumiworld Info backend and frontend halves.
 *
 * The activation entry shape mirrors the (already content-free) projection
 * Lumiverse publishes on the WORLD_INFO_ACTIVATED event:
 *   { chatId, entries: ActivatedWorldInfoEntry[], stats }
 * All reads stay defensive so older/newer hosts never crash the panel.
 */

export type ActivationOrigin = "constant" | "sticky" | "keyword" | "vector" | "unknown";

export interface ActivationEntry {
  /** Entry id (stable within a book). */
  id: string;
  /** Entry title/comment, or a keys-derived fallback. */
  title: string;
  /** Book display name, or "(no book)". */
  book: string;
  /** Configured primary key patterns. */
  keys: string[];
  /** activationProvenance.origin, or a fallback derived from activationType/source. */
  origin: ActivationOrigin;
  /** Matched primary keys for keyword activations (may be absent). */
  matchedPrimary: string[];
  /** Matched secondary keys for keyword activations (may be absent). */
  matchedSecondary: string[];
  /** Recursion pass the entry was activated on (0-based; -1 when unknown). */
  pass: number;
  /** Inclusion-group winner flag. */
  firstTriggeredForBook: boolean;
  /** Vector similarity score when present. */
  score?: number;
  /** Host-estimated token cost when present. */
  estimatedTokens?: number;
  /** Host-reported activation order when present. */
  activationOrder?: number;
}

export interface ActivationStats {
  totalActivated?: number;
  keywordActivated?: number;
  vectorActivated?: number;
  recursionPassesUsed?: number;
  estimatedTokens?: number;
}

/** One captured generation's activation set (bounded, serializable). */
export interface ActivationSnapshot {
  /** Wall-clock capture time (epoch ms). */
  ts: number;
  chatId: string | null;
  entries: ActivationEntry[];
  stats?: ActivationStats;
}

/** Frontend → backend requests. */
export type FrontendToBackend =
  | { type: "lumiworld_info:get-role"; requestId: string }
  | { type: "lumiworld_info:history:load"; requestId: string; chatId: string }
  | { type: "lumiworld_info:history:append"; chatId: string; snapshot: ActivationSnapshot };

/** Backend → frontend messages. */
export type BackendToFrontend =
  | { type: "lumiworld_info:role"; requestId: string; role: "operator" | "admin" | "user" | "unknown" }
  | { type: "lumiworld_info:history"; requestId: string; chatId: string; snapshots: ActivationSnapshot[] }
  | { type: "lumiworld_info:command"; command: "report" | "triggered" | "reset-position" };

export const HISTORY_VARIABLE_KEY = "lumiworld_info.history";
/** Maximum per-chat snapshots persisted in the chat-scope variable. */
export const HISTORY_MAX_SNAPSHOTS = 20;
/** Serialized history size guard (chat variables hold string values). */
export const HISTORY_MAX_BYTES = 60_000;
/** Hard cap on entries kept per snapshot. */
export const HISTORY_MAX_ENTRIES = 200;

/** Trim an entry list to the persistence cap, keeping the tail. */
export function boundEntries<T>(entries: readonly T[]): T[] {
  if (entries.length <= HISTORY_MAX_ENTRIES) return [...entries];
  return entries.slice(entries.length - HISTORY_MAX_ENTRIES);
}
