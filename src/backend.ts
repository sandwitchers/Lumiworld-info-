/**
 * Lumiworld Info — backend half.
 *
 * The global `spindle` API is injected by the Spindle runtime; there are no
 * imports beyond shared types. Everything used here is free tier:
 *   - spindle.commands (command palette entries)
 *   - spindle.users.getRole (per-user role for hidden-book privacy)
 *   - spindle.variables.chat (bounded per-chat activation history)
 *   - spindle.onFrontendMessage / spindle.sendToFrontend (bridge)
 *
 * Permissions declared by this extension: ["ui_panels"] (frontend float
 * widget). This file requires no permission at all.
 */
import type {
  ActivationSnapshot,
  BackendToFrontend,
  FrontendToBackend,
} from "./shared/types";
import {
  HISTORY_MAX_BYTES,
  HISTORY_MAX_SNAPSHOTS,
  HISTORY_VARIABLE_KEY,
} from "./shared/types";

declare const spindle: import("lumiverse-spindle-types").SpindleAPI;

const EXTENSION_LABEL = "World Info Info";

// ─────────────────────────────────────────────────────────────────────────────
// Command palette (port of ST slash commands /wi-report, /wi-triggered,
// /wi-position-reset). The UI logic lives in the frontend; the backend only
// routes the invocation. Note: the invocation does not carry the invoking
// user's id, so on operator-scoped installs every frontend receives the
// "open panel" nudge. Report content itself is always assembled client-side
// from that user's own event stream — no cross-user data movement.
// ─────────────────────────────────────────────────────────────────────────────

spindle.commands.register([
  {
    id: "wi-report",
    label: `${EXTENSION_LABEL}: Keyword Report`,
    description: "Show which keywords triggered which World Info entries, per recursion pass.",
    keywords: ["world info", "report", "keywords", "lore", "triggered"],
    scope: "chat",
  },
  {
    id: "wi-triggered",
    label: `${EXTENSION_LABEL}: Show Triggered Entries`,
    description: "List the World Info entries activated by the latest generation.",
    keywords: ["world info", "active", "entries", "activated"],
    scope: "chat",
  },
  {
    id: "wi-position-reset",
    label: `${EXTENSION_LABEL}: Reset Book Icon Position`,
    description: "Move the floating book icon back to its default corner.",
    keywords: ["world info", "position", "reset", "widget"],
    scope: "global",
  },
]);

spindle.commands.onInvoked((commandId: string) => {
  const command =
    commandId === "wi-report"
      ? "report"
      : commandId === "wi-triggered"
        ? "triggered"
        : commandId === "wi-position-reset"
          ? "reset-position"
          : null;
  if (!command) return;
  const message: BackendToFrontend = { type: "lumiworld_info:command", command };
  spindle.sendToFrontend(message);
});

// ─────────────────────────────────────────────────────────────────────────────
// Frontend bridge: role lookup + bounded per-chat history persistence.
// ─────────────────────────────────────────────────────────────────────────────

function parseHistory(raw: string | undefined): ActivationSnapshot[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ActivationSnapshot =>
        !!item && typeof item === "object" && Array.isArray((item as ActivationSnapshot).entries),
    );
  } catch {
    return [];
  }
}

function serializeHistory(history: ActivationSnapshot[]): string | null {
  // Drop oldest snapshots until the payload fits the size guard.
  let candidates = [...history];
  while (candidates.length > 0) {
    const serialized = JSON.stringify(candidates);
    if (new TextEncoder().encode(serialized).byteLength <= HISTORY_MAX_BYTES) {
      return serialized;
    }
    candidates = candidates.slice(1);
  }
  return "[]";
}

spindle.onFrontendMessage(async (payload: unknown, userId: string) => {
  const message = payload as Partial<FrontendToBackend> | null;
  if (!message || typeof message.type !== "string") return;

  if (message.type === "lumiworld_info:get-role") {
    let role: "operator" | "admin" | "user" | "unknown" = "unknown";
    try {
      role = (await spindle.users.getRole(userId)) as typeof role;
    } catch (error) {
      spindle.log.warn(
        `get-role failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const reply: BackendToFrontend = {
      type: "lumiworld_info:role",
      requestId: String(message.requestId ?? ""),
      role,
    };
    spindle.sendToFrontend(reply, userId);
    return;
  }

  if (message.type === "lumiworld_info:history:load") {
    const chatId = String(message.chatId ?? "");
    const requestId = String(message.requestId ?? "");
    if (!chatId) return;
    let snapshots: ActivationSnapshot[] = [];
    try {
      const raw = await spindle.variables.chat.get(chatId, HISTORY_VARIABLE_KEY);
      snapshots = parseHistory(raw);
    } catch (error) {
      spindle.log.warn(
        `history load failed for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const reply: BackendToFrontend = { type: "lumiworld_info:history", requestId, chatId, snapshots };
    spindle.sendToFrontend(reply, userId);
    return;
  }

  if (message.type === "lumiworld_info:history:append") {
    const chatId = String(message.chatId ?? "");
    const snapshot = message.snapshot;
    if (!chatId || !snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.entries)) {
      return;
    }
    try {
      const raw = await spindle.variables.chat.get(chatId, HISTORY_VARIABLE_KEY);
      const history = parseHistory(raw);
      history.push(snapshot);
      const bounded =
        history.length > HISTORY_MAX_SNAPSHOTS
          ? history.slice(history.length - HISTORY_MAX_SNAPSHOTS)
          : history;
      const serialized = serializeHistory(bounded);
      if (serialized !== null) {
        await spindle.variables.chat.set(chatId, HISTORY_VARIABLE_KEY, serialized);
      }
    } catch (error) {
      // History persistence is best-effort: the panel keeps working in-memory.
      spindle.log.warn(
        `history append failed for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return;
  }
});

spindle.log.info("Loaded successfully; commands wi-report / wi-triggered / wi-position-reset registered");
