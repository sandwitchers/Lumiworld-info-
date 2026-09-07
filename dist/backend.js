// @bun
// src/shared/types.ts
var HISTORY_VARIABLE_KEY = "lumiworld_info.history";
var HISTORY_MAX_SNAPSHOTS = 20;
var HISTORY_MAX_BYTES = 60000;

// src/backend.ts
var EXTENSION_LABEL = "World Info Info";
spindle.commands.register([
  {
    id: "wi-report",
    label: `${EXTENSION_LABEL}: Keyword Report`,
    description: "Show which keywords triggered which World Info entries, per recursion pass.",
    keywords: ["world info", "report", "keywords", "lore", "triggered"],
    scope: "chat"
  },
  {
    id: "wi-triggered",
    label: `${EXTENSION_LABEL}: Show Triggered Entries`,
    description: "List the World Info entries activated by the latest generation.",
    keywords: ["world info", "active", "entries", "activated"],
    scope: "chat"
  },
  {
    id: "wi-position-reset",
    label: `${EXTENSION_LABEL}: Reset Book Icon Position`,
    description: "Move the floating book icon back to its default corner.",
    keywords: ["world info", "position", "reset", "widget"],
    scope: "global"
  }
]);
spindle.commands.onInvoked((commandId) => {
  const command = commandId === "wi-report" ? "report" : commandId === "wi-triggered" ? "triggered" : commandId === "wi-position-reset" ? "reset-position" : null;
  if (!command)
    return;
  const message = { type: "lumiworld_info:command", command };
  spindle.sendToFrontend(message);
});
function parseHistory(raw) {
  if (!raw)
    return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter((item) => !!item && typeof item === "object" && Array.isArray(item.entries));
  } catch {
    return [];
  }
}
function serializeHistory(history) {
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
spindle.onFrontendMessage(async (payload, userId) => {
  const message = payload;
  if (!message || typeof message.type !== "string")
    return;
  if (message.type === "lumiworld_info:get-role") {
    let role = "unknown";
    try {
      role = await spindle.users.getRole(userId);
    } catch (error) {
      spindle.log.warn(`get-role failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const reply = {
      type: "lumiworld_info:role",
      requestId: String(message.requestId ?? ""),
      role
    };
    spindle.sendToFrontend(reply, userId);
    return;
  }
  if (message.type === "lumiworld_info:history:load") {
    const chatId = String(message.chatId ?? "");
    const requestId = String(message.requestId ?? "");
    if (!chatId)
      return;
    let snapshots = [];
    try {
      const raw = await spindle.variables.chat.get(chatId, HISTORY_VARIABLE_KEY);
      snapshots = parseHistory(raw);
    } catch (error) {
      spindle.log.warn(`history load failed for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const reply = { type: "lumiworld_info:history", requestId, chatId, snapshots };
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
      const bounded = history.length > HISTORY_MAX_SNAPSHOTS ? history.slice(history.length - HISTORY_MAX_SNAPSHOTS) : history;
      const serialized = serializeHistory(bounded);
      if (serialized !== null) {
        await spindle.variables.chat.set(chatId, HISTORY_VARIABLE_KEY, serialized);
      }
    } catch (error) {
      spindle.log.warn(`history append failed for chat ${chatId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }
});
spindle.log.info("Loaded successfully; commands wi-report / wi-triggered / wi-position-reset registered");
