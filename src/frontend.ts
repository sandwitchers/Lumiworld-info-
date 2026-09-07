/**
 * Lumiworld Info — frontend half (browser ESM bundle).
 *
 * Port of SillyTavern WorldInfoInfo (LenAnderson / aikohanasaki, AGPL-3.0).
 * Lumiverse-native implementation:
 *   - drawer tab listing entries activated by the latest generation
 *   - draggable float widget ("book icon") with an activation-count badge
 *     (requires the ui_panels permission; degrades to drawer-only without it)
 *   - keyword trigger report from the host's activationProvenance data —
 *     no console scraping needed on Lumiverse
 *   - per-chat activation history persisted through the backend in a
 *     chat-scope variable (free tier)
 */
import type { SpindleFrontendContext } from "lumiverse-spindle-types";

import type { ActivationEntry, ActivationSnapshot, BackendToFrontend, FrontendToBackend } from "./shared/types";
import { boundEntries } from "./shared/types";
import { normalizePayload } from "./normalize";
import { isHiddenBook, parseHiddenPatterns, type UserRole } from "./normalize";
import {
  PANEL_CSS,
  createPanel,
  el,
  mountWidgetButton,
  setWidgetCount,
  buildReportContent,
  buildEntryDetail,
  appendCopyButton,
  type EntryContentResult,
  type PanelSettings,
} from "./panel";

const DEFAULT_WIDGET_POS = { x: 16, y: 16 };

interface WidgetPosition {
  x: number;
  y: number;
}

function isPosition(value: unknown): value is WidgetPosition {
  return (
    typeof value === "object" && value !== null &&
    typeof (value as WidgetPosition).x === "number" && Number.isFinite((value as WidgetPosition).x) &&
    typeof (value as WidgetPosition).y === "number" && Number.isFinite((value as WidgetPosition).y)
  );
}

function clampPosition(position: WidgetPosition, viewport: { width: number; height: number }): WidgetPosition {
  const maxX = Math.max(0, viewport.width - 56);
  const maxY = Math.max(0, viewport.height - 56);
  return {
    x: Math.min(Math.max(0, Math.round(position.x)), maxX),
    y: Math.min(Math.max(0, Math.round(position.y)), maxY),
  };
}

export async function setup(ctx: SpindleFrontendContext): Promise<() => void> {
  const doc: Document = ctx.dom && typeof document !== "undefined" ? document : globalThis.document;
  const disposers: Array<() => void> = [];
  const logPrefix = "[lumiworld_info]";
  console.info(`${logPrefix} setup() running`);

  const settingsApi = ctx.settings;
  if (!settingsApi) {
    throw new Error("[lumiworld_info] ctx.settings unavailable: host is too old for this extension");
  }

  // ── Settings (host-namespaced `module:key`) ────────────────────────────────
  const settings: PanelSettings & { includeHistory: boolean } = {
    group: (await settingsApi.get<boolean>("panel:group")) ?? true,
    order: (await settingsApi.get<boolean>("panel:order")) ?? true,
    hidden: (await settingsApi.get<string>("privacy:hidden")) ?? "",
    includeHistory: (await settingsApi.get<boolean>("report:history")) ?? false,
  };

  const persistSetting = async (key: string, value: unknown): Promise<void> => {
    try {
      await settingsApi.set(key, value);
    } catch (error) {
      console.warn(`${logPrefix} settings.set(${key}) failed:`, error);
    }
  };

  // ── Runtime state ──────────────────────────────────────────────────────────
  // Geometry-aware viewport reads (never raw window.innerWidth).
  const viewportSize = (): { width: number; height: number } => {
    try {
      const geometry = (ctx.ui as { geometry?: { layoutViewportSize?: () => { width: number; height: number } } })
        .geometry;
      const size = geometry?.layoutViewportSize?.();
      if (size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0) {
        return { width: size.width, height: size.height };
      }
    } catch {
      // Older hosts without the geometry API fall through to the window.
    }
    return { width: window.innerWidth, height: window.innerHeight };
  };

  let activeChatId: string | null = ctx.getActiveChat().chatId;
  let latestSnapshot: ActivationSnapshot | null = null;
  let history: ActivationSnapshot[] = [];
  let role: UserRole = "unknown";
  let widgetRefs: { badge: HTMLElement; button: HTMLElement } | null = null;
  let widgetHandle: {
    moveTo(x: number, y: number): void;
    getPosition(): WidgetPosition;
    destroy(): void;
  } | null = null;

  // ── Backend bridge helpers ─────────────────────────────────────────────────
  const pendingRoleReplies = new Map<string, (role: UserRole) => void>();
  const pendingHistoryReplies = new Map<string, (snapshots: ActivationSnapshot[]) => void>();

  disposers.push(
    ctx.onBackendMessage((payload: unknown) => {
      const message = payload as Partial<BackendToFrontend> | null;
      if (!message || typeof message.type !== "string") return;
      if (message.type === "lumiworld_info:role") {
        const requestId = message.requestId ?? "";
        const resolver = pendingRoleReplies.get(requestId);
        pendingRoleReplies.delete(requestId);
        resolver?.((message.role ?? "unknown") as UserRole);
        return;
      }
      if (message.type === "lumiworld_info:history") {
        const requestId = message.requestId ?? "";
        const resolver = pendingHistoryReplies.get(requestId);
        pendingHistoryReplies.delete(requestId);
        // Ignore stale replies for a chat the user already left.
        const snapshots = Array.isArray(message.snapshots) ? message.snapshots : [];
        if (message.chatId && message.chatId !== activeChatId) resolver?.([]);
        else resolver?.(snapshots);
        return;
      }
      if (message.type === "lumiworld_info:command") {
        if (message.command === "report") void openReport();
        else if (message.command === "triggered") openTriggered();
        else if (message.command === "reset-position") void resetWidgetPosition();
        return;
      }
    }),
  );

  const sendToBackend = (payload: FrontendToBackend): void => {
    try {
      ctx.sendToBackend(payload);
    } catch (error) {
      console.warn(`${logPrefix} sendToBackend failed:`, error);
    }
  };

  const requestRole = async (): Promise<UserRole> => {
    const requestId = crypto.randomUUID();
    const promise = new Promise<UserRole>((resolve) => {
      pendingRoleReplies.set(requestId, resolve);
      window.setTimeout(() => {
        if (pendingRoleReplies.delete(requestId)) resolve("unknown");
      }, 5000);
    });
    sendToBackend({ type: "lumiworld_info:get-role", requestId });
    return promise;
  };

  const loadHistory = async (chatId: string): Promise<void> => {
    const requestId = crypto.randomUUID();
    const promise = new Promise<ActivationSnapshot[]>((resolve) => {
      pendingHistoryReplies.set(requestId, resolve);
      window.setTimeout(() => {
        if (pendingHistoryReplies.delete(requestId)) resolve([]);
      }, 5000);
    });
    sendToBackend({ type: "lumiworld_info:history:load", requestId, chatId });
    history = await promise;
  };

  const appendHistory = (snapshot: ActivationSnapshot, chatId: string): void => {
    sendToBackend({
      type: "lumiworld_info:history:append",
      chatId,
      snapshot: { ...snapshot, entries: boundEntries(snapshot.entries) },
    });
  };

  // ── Drawer tab + panel ─────────────────────────────────────────────────────
  const tab = ctx.ui.registerDrawerTab({
    id: "lumiworld_info_main",
    title: "World Info Info",
    shortName: "WI Info",
    description: "World Info entries activated by the latest generation.",
    keywords: ["world info", "lore", "activated", "keywords", "report"],
  });

  const panel = createPanel(
    doc,
    tab.root,
    settings,
    {
      onToggle(key) {
        if (key === "group" || key === "order") {
          settings[key] = !settings[key];
          void persistSetting(key === "group" ? "panel:group" : "panel:order", settings[key]);
        } else if (key === "hidden") {
          void editHiddenPatterns();
          return;
        }
        panel.render(latestSnapshot, settings, role);
      },
      onReport: () => void openReport(),
      onTriggered: () => openTriggered(),
      onResetPosition: () => void resetWidgetPosition(),
      onEntryClick: (entry) => void openEntryModal(entry),
    },
  );
  disposers.push(() => tab.destroy());

  const hiddenChip = doc.createElement("div");
  hiddenChip.className = "lwi-chip";
  hiddenChip.title = "Books starting with these prefixes are hidden from non-privileged users (comma-separated)";
  hiddenChip.textContent = "Hidden books…";
  hiddenChip.addEventListener("click", () => void editHiddenPatterns());
  const toolbar = tab.root.querySelector(".lwi-toolbar");
  toolbar?.appendChild(hiddenChip);

  const refreshHiddenChip = () => {
    hiddenChip.dataset.on = String(settings.hidden.trim().length > 0);
  };
  refreshHiddenChip();

  const editHiddenPatterns = async (): Promise<void> => {
    try {
      const modal = ctx.ui.showModal({
        title: "Hidden books",
        width: 420,
      });
      const wrap = doc.createElement("div");
      wrap.setAttribute("data-lwi-root", "");
      const label = doc.createElement("div");
      label.style.marginBottom = "8px";
      label.textContent =
        "Comma-separated book-name prefixes. Books starting with one of these are masked as “(hidden entries)” for non-operator/admin users.";
      const input = doc.createElement("input");
      input.type = "text";
      input.value = settings.hidden;
      input.placeholder = "9Z, Z-";
      input.style.width = "100%";
      input.style.boxSizing = "border-box";
      input.style.padding = "8px";
      input.style.borderRadius = "8px";
      input.style.border = "1px solid var(--lumiverse-border, rgba(255,255,255,0.12))";
      input.style.background = "var(--lumiverse-fill-subtle, rgba(255,255,255,0.03))";
      input.style.color = "var(--lumiverse-text, #fff)";
      const actions = doc.createElement("div");
      actions.style.display = "flex";
      actions.style.justifyContent = "flex-end";
      actions.style.gap = "8px";
      actions.style.marginTop = "12px";
      const save = doc.createElement("button");
      save.type = "button";
      save.textContent = "Save";
      save.className = "lwi-btn lwi-btn--accent";
      save.addEventListener("click", () => {
        settings.hidden = input.value;
        void persistSetting("privacy:hidden", settings.hidden);
        refreshHiddenChip();
        panel.render(latestSnapshot, settings, role);
        modal.dismiss();
      });
      actions.append(save);
      wrap.append(label, input, actions);
      modal.root.appendChild(wrap);
    } catch (error) {
      console.warn(`${logPrefix} hidden-books editor unavailable:`, error);
    }
  };

  // ── Float widget (book icon) ───────────────────────────────────────────────
  const restoreWidgetPosition = (): WidgetPosition => {
    const saved = savedWidgetPos;
    return saved ? clampPosition(saved, viewportSize()) : { ...DEFAULT_WIDGET_POS };
  };

  const storedPos: unknown = await settingsApi.get<WidgetPosition>("widget:pos");
  let savedWidgetPos: WidgetPosition | null = isPosition(storedPos)
    ? clampPosition(storedPos, viewportSize())
    : null;

  const attachWidget = (): void => {
    try {
      const handle = ctx.ui.createFloatWidget({
        width: 46,
        height: 46,
        initialPosition: restoreWidgetPosition(),
        snapToEdge: true,
        // The extension owns the visuals: the host strips its own
        // border/background/shadow AND its overflow clipping, so our button
        // and badge render exactly as designed (fixes the cut-off icon).
        chromeless: true,
        tooltip: "Active World Info",
      });
      widgetRefs = mountWidgetButton(doc, handle.root);
      widgetRefs.button.addEventListener("click", () => {
        tab.activate();
      });
      const offDrag = handle.onDragEnd?.((position: WidgetPosition) => {
        savedWidgetPos = clampPosition(position, viewportSize());
        void persistSetting("widget:pos", savedWidgetPos);
      });
      if (typeof offDrag === "function") disposers.push(offDrag);
      widgetHandle = {
        moveTo: (x, y) => handle.moveTo?.(x, y),
        getPosition: () => handle.getPosition?.() ?? { ...DEFAULT_WIDGET_POS },
        destroy: () => handle.destroy(),
      };
      disposers.push(() => widgetHandle?.destroy());
      const saved = savedWidgetPos;
      if (saved) widgetHandle.moveTo(saved.x, saved.y);
    } catch (error) {
      console.warn(
        `${logPrefix} float widget unavailable (grant the ui_panels permission to enable the book icon):`,
        error,
      );
      widgetHandle = null;
      widgetRefs = null;
    }
  };

  attachWidget();
  disposers.push(() => {
    widgetHandle = null;
    widgetRefs = null;
  });

  const resetWidgetPosition = async (): Promise<void> => {
    savedWidgetPos = null;
    await persistSetting("widget:pos", null);
    if (widgetHandle) widgetHandle.moveTo(DEFAULT_WIDGET_POS.x, DEFAULT_WIDGET_POS.y);
  };

  // ── Rendering helpers ──────────────────────────────────────────────────────
  const updateBadge = (count: number): void => {
    try {
      tab.setBadge(count > 0 ? String(count) : null);
    } catch {
      // Badge is cosmetic; never fail on it.
    }
    setWidgetCount(widgetRefs, count);
  };

  const renderAll = (): void => {
    panel.render(latestSnapshot, settings, role);
    updateBadge(latestSnapshot?.entries.length ?? 0);
    panel.setStatus(
      latestSnapshot
        ? `Last update: ${new Date(latestSnapshot.ts).toLocaleTimeString()} • ${latestSnapshot.entries.length} entries`
        : "Waiting for the first generation…",
    );
  };

  // ── WORLD_INFO_ACTIVATED handling ──────────────────────────────────────────
  disposers.push(
    ctx.events.on("WORLD_INFO_ACTIVATED", (payload: unknown) => {
      const { chatId, entries, stats } = normalizePayload(payload);
      const snapshot: ActivationSnapshot = {
        ts: Date.now(),
        chatId,
        entries,
        stats,
      };
      if (chatId && chatId !== activeChatId) {
        // Background/other-chat generation: persist for that chat only.
        appendHistory(snapshot, chatId);
        return;
      }
      // The host also emits with an empty list to clear stale entries.
      latestSnapshot = snapshot;
      if (entries.length > 0) {
        history = [...history, snapshot].slice(-50);
        if (chatId) appendHistory(snapshot, chatId);
      }
      renderAll();
    }),
  );

  // ── Chat tracking ──────────────────────────────────────────────────────────
  const switchChat = async (chatId: string | null): Promise<void> => {
    activeChatId = chatId;
    latestSnapshot = null;
    history = [];
    if (chatId) await loadHistory(chatId);
    renderAll();
  };

  disposers.push(
    ctx.events.on("CHAT_SWITCHED", (payload: unknown) => {
      const chatId =
        typeof payload === "object" && payload !== null && "chatId" in payload
          ? (payload as { chatId?: unknown }).chatId
          : null;
      void switchChat(typeof chatId === "string" ? chatId : null);
    }),
  );
  disposers.push(
    ctx.events.on("CHAT_CHANGED", (payload: unknown) => {
      const chatId =
        typeof payload === "object" && payload !== null && "chatId" in payload
          ? (payload as { chatId?: unknown }).chatId
          : null;
      if (typeof chatId === "string" && chatId !== activeChatId) void switchChat(chatId);
    }),
  );

  // ── Report / triggered modals ──────────────────────────────────────────────
  let openModals = 0;
  const trackModal = (modal: { onDismiss?(handler: () => void): () => void }): void => {
    openModals += 1;
    modal.onDismiss?.(() => {
      openModals = Math.max(0, openModals - 1);
    });
  };

  const openReport = async (): Promise<void> => {
    if (openModals >= 2) return; // Host caps extensions at 2 stacked modals.
    try {
      const modal = ctx.ui.showModal({ title: "World Info Report", width: 640, maxHeight: 640 });
      trackModal(modal);
      const content = buildReportContent(
        doc,
        history.length > 0 ? history : latestSnapshot ? [latestSnapshot] : [],
        settings,
        role,
        settings.includeHistory,
      );
      const footer = doc.createElement("div");
      footer.setAttribute("data-lwi-root", "");
      footer.style.display = "flex";
      footer.style.gap = "8px";
      footer.style.marginTop = "12px";
      const toggle = doc.createElement("button");
      toggle.type = "button";
      toggle.className = "lwi-btn";
      toggle.textContent = settings.includeHistory
        ? "Scope: all captured generations"
        : "Scope: latest generation only";
      toggle.addEventListener("click", () => {
        settings.includeHistory = !settings.includeHistory;
        void persistSetting("report:history", settings.includeHistory);
        modal.dismiss();
        openModals = Math.max(0, openModals - 1);
        void openReport();
      });
      footer.append(toggle);
      modal.root.appendChild(content);
      modal.root.appendChild(footer);
    } catch (error) {
      console.warn(`${logPrefix} report modal unavailable:`, error);
    }
  };

  // ── Entry content lookup (QOL: click an entry → view its content) ─────────
  // The WORLD_INFO_ACTIVATED payload is content-free by host design; the
  // worldBooks REST API (free tier) is the source of truth for content.
  const CONTENT_INDEX_TTL_MS = 60_000;
  const CONTENT_BOOK_LIMIT = 200;
  const CONTENT_ENTRY_LIMIT = 1000;
  let contentIndex: Map<string, { content: string }> | null = null;
  let contentIndexAt = 0;

  const cachedIndex = (): Map<string, { content: string }> | null =>
    contentIndex && Date.now() - contentIndexAt < CONTENT_INDEX_TTL_MS ? contentIndex : null;

  const buildContentIndex = async (): Promise<Map<string, { content: string }> | null> => {
    const api = ctx.worldBooks;
    if (!api) return null;
    try {
      const books = (await api.list({ limit: CONTENT_BOOK_LIMIT })).data;
      const index = new Map<string, { content: string }>();
      for (const book of books) {
        try {
          const { data: entries } = await api.entries.list(book.id, { limit: CONTENT_ENTRY_LIMIT });
          for (const entry of entries) {
            const record = { content: entry.content };
            index.set(entry.id, record);
            if (entry.uid && entry.uid !== entry.id) index.set(entry.uid, record);
          }
        } catch (error) {
          console.warn(`${logPrefix} entries.list(${book.id}) failed:`, error);
        }
      }
      contentIndex = index;
      contentIndexAt = Date.now();
      return index;
    } catch (error) {
      console.warn(`${logPrefix} worldBooks.list failed:`, error);
      return null;
    }
  };

  const lookupEntryContent = async (entry: ActivationEntry): Promise<EntryContentResult> => {
    if (isHiddenBook(entry.book, parseHiddenPatterns(settings.hidden), role)) {
      return { state: "hidden" };
    }
    const api = ctx.worldBooks;
    if (!api || typeof api.entries?.list !== "function") return { state: "unavailable" };

    // Fast path: the activation event tells us which book the entry lives in.
    if (entry.bookId) {
      try {
        const { data } = await api.entries.list(entry.bookId, { limit: CONTENT_ENTRY_LIMIT });
        const hit = data.find((candidate) => candidate.id === entry.id || candidate.uid === entry.id);
        if (hit) return { state: "ready", content: hit.content };
      } catch (error) {
        console.warn(`${logPrefix} entries.list(${entry.bookId}) failed:`, error);
      }
    }
    // Slow path: scan every book through a short-lived cached index —
    // covers hosts that omit bookId on the activation payload.
    const index = cachedIndex() ?? (await buildContentIndex());
    const record = index?.get(entry.id);
    if (record) return { state: "ready", content: record.content };
    // One forced refresh before giving up (the book may have just been added).
    const refreshed = await buildContentIndex();
    const retry = refreshed?.get(entry.id);
    return retry ? { state: "ready", content: retry.content } : { state: "missing" };
  };

  const openEntryModal = async (entry: ActivationEntry): Promise<void> => {
    if (openModals >= 2) return; // Host caps extensions at 2 stacked modals.
    try {
      const title = entry.title.length > 48 ? `${entry.title.slice(0, 47)}…` : entry.title;
      const modal = ctx.ui.showModal({ title, width: 560, maxHeight: 620 });
      trackModal(modal);
      modal.root.appendChild(buildEntryDetail(doc, entry, { state: "loading" }));
      const result = await lookupEntryContent(entry);
      modal.root.replaceChildren(buildEntryDetail(doc, entry, result));
      if (result.state === "ready") {
        const footer = doc.createElement("div");
        footer.setAttribute("data-lwi-root", "");
        footer.className = "lwi-detail-actions";
        appendCopyButton(doc, footer, () => result.content);
        modal.root.appendChild(footer);
      }
    } catch (error) {
      console.warn(`${logPrefix} entry modal unavailable:`, error);
    }
  };

  const openTriggered = (): void => {
    void (async () => {
      if (openModals >= 2) return;
      try {
        const modal = ctx.ui.showModal({ title: "Triggered World Info Entries", width: 560, maxHeight: 560 });
        trackModal(modal);
        const content = doc.createElement("div");
        content.setAttribute("data-lwi-root", "");
        content.className = "lwi-report";
        const entries = latestSnapshot?.entries ?? [];
        if (entries.length === 0) {
          content.textContent = "No active entries — run a generation first, nyaa~";
        } else {
          content.append(
            el(doc, "div", "lwi-report-summary", "Tap an entry to view its full content."),
          );
          const list = doc.createElement("ul");
          for (const entry of entries) {
            const li = doc.createElement("li");
            li.textContent = `${entry.book}:${entry.id} — ${entry.title}`;
            li.style.cursor = "pointer";
            li.addEventListener("click", () => void openEntryModal(entry));
            list.append(li);
          }
          content.append(list);
        }
        modal.root.appendChild(content);
      } catch (error) {
        console.warn(`${logPrefix} triggered modal unavailable:`, error);
      }
    })();
  };

  // ── CSS + initial refresh ──────────────────────────────────────────────────
  const removeStyle = ctx.dom.addStyle(PANEL_CSS);
  disposers.push(removeStyle);

  // Fire-and-forget warm-up: never delay setup() readiness on backend RPCs.
  void (async () => {
    role = await requestRole();
    if (activeChatId) await loadHistory(activeChatId);
    renderAll();
  })();
  renderAll();
  // ── Teardown (Nine Lives Rule) ─────────────────────────────────────────────
  const teardown = (): void => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // Idempotent cleanup: a second pass must never throw.
      }
    }
    widgetHandle = null;
    widgetRefs = null;
    console.info(`${logPrefix} torn down cleanly`);
  };

  ctx.onTeardown?.(teardown);
  return teardown;
}
