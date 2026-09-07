/**
 * Normalization of the WORLD_INFO_ACTIVATED payload + privacy helpers.
 *
 * The host publishes a content-free projection per entry. Fields evolve
 * between Lumiverse versions, so every read is defensive (feature-detect
 * style) instead of trusting one exact DTO version.
 */
import type { ActivationEntry, ActivationOrigin, ActivationStats } from "./shared/types";

type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean {
  return value === true;
}

function originFrom(record: UnknownRecord): ActivationOrigin {
  const provenance = asRecord(record.activationProvenance);
  const provenanceOrigin = str(provenance?.origin);
  if (
    provenanceOrigin === "constant" ||
    provenanceOrigin === "sticky" ||
    provenanceOrigin === "keyword" ||
    provenanceOrigin === "vector"
  ) {
    return provenanceOrigin;
  }
  const activationType = str(record.activationType);
  if (
    activationType === "constant" ||
    activationType === "sticky" ||
    activationType === "keyword" ||
    activationType === "vector"
  ) {
    return activationType;
  }
  const source = str(record.source);
  if (source === "vector") return "vector";
  if (source === "keyword") return "keyword";
  return "unknown";
}

/** Normalize one raw activation entry; returns null when unusable. */
export function normalizeEntry(raw: unknown): ActivationEntry | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = str(record.id) ?? str(record.uid);
  if (!id) return null;

  const keys = strList(record.keys);
  const comment = str(record.comment) ?? str(record.label);
  const title = comment ?? (keys.length > 0 ? keys.join(", ") : id);
  const book = str(record.bookName) ?? str(record.world) ?? "(no book)";

  const provenance = asRecord(record.activationProvenance);
  const origin = originFrom(record);

  const matchedPrimary =
    origin === "keyword" ? strList(provenance?.matchedPrimaryKeys) : [];
  const matchedSecondary =
    origin === "keyword" ? strList(provenance?.matchedSecondaryKeys) : [];

  const rawPass = num(provenance?.activationPass);

  return {
    id,
    title,
    book,
    bookId: str(record.bookId) ?? str(record.worldBookId),
    keys,
    origin,
    matchedPrimary,
    matchedSecondary,
    pass: rawPass ?? -1,
    firstTriggeredForBook: bool(record.firstTriggeredForBook),
    score: num(record.score),
    estimatedTokens: num(record.estimatedTokens),
    activationOrder: num(record.activationOrder),
  };
}

export function normalizePayload(payload: unknown): {
  chatId: string | null;
  entries: ActivationEntry[];
  stats: ActivationStats | undefined;
} {
  const record = asRecord(payload);
  if (!record) return { chatId: null, entries: [], stats: undefined };
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const entries = rawEntries
    .map(normalizeEntry)
    .filter((entry): entry is ActivationEntry => entry !== null);
  const statsRecord = asRecord(record.stats);
  const stats: ActivationStats | undefined = statsRecord
    ? {
        totalActivated: num(statsRecord.totalActivated),
        keywordActivated: num(statsRecord.keywordActivated),
        vectorActivated: num(statsRecord.vectorActivated),
        recursionPassesUsed: num(statsRecord.recursionPassesUsed),
        estimatedTokens: num(statsRecord.estimatedTokens),
      }
    : undefined;
  const chatId = str(record.chatId) ?? null;
  return { chatId, entries, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hidden-book privacy (generalized port of the ST fork's 9Z / Z-<handle>-
// rules): books whose name matches any configured prefix are masked for
// non-privileged users. Operator/admin roles bypass the mask.
// ─────────────────────────────────────────────────────────────────────────────

export type UserRole = "operator" | "admin" | "user" | "unknown";

export function parseHiddenPatterns(raw: string | undefined | null): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function isPrivilegedRole(role: UserRole): boolean {
  return role === "operator" || role === "admin";
}

export function isHiddenBook(
  book: string,
  patterns: readonly string[],
  role: UserRole,
): boolean {
  if (patterns.length === 0 || isPrivilegedRole(role)) return false;
  const normalized = book.trim().toLowerCase();
  return patterns.some((pattern) => normalized.startsWith(pattern.toLowerCase()));
}

/** Split an entry list into visible + hidden (hidden collapses to a count). */
export function applyPrivacy(
  entries: readonly ActivationEntry[],
  patterns: readonly string[],
  role: UserRole,
): { visible: ActivationEntry[]; hiddenCount: number; hiddenBooks: string[] } {
  const visible: ActivationEntry[] = [];
  const hiddenBooks = new Set<string>();
  for (const entry of entries) {
    if (isHiddenBook(entry.book, patterns, role)) {
      hiddenBooks.add(entry.book);
    } else {
      visible.push(entry);
    }
  }
  return { visible, hiddenCount: entries.length - visible.length, hiddenBooks: [...hiddenBooks] };
}
