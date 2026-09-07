/**
 * Lumiworld Info — drawer tab panel, float widget visuals, and report modal.
 * Pure DOM rendering: no framework, host tokens only, all classes prefixed
 * `lwi-` and scoped under the extension root.
 */
import type { ActivationEntry, ActivationSnapshot } from "./shared/types";
import { applyPrivacy, isPrivilegedRole, parseHiddenPatterns, type UserRole } from "./normalize";

const BOOK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>';

const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

const ORIGIN_LABEL: Record<string, string> = {
  constant: "constant",
  sticky: "sticky",
  keyword: "keyword",
  vector: "vector",
  unknown: "activated",
};

export interface PanelSettings {
  group: boolean;
  order: boolean;
  hidden: string;
}

export function el(
  doc: Document,
  tag: string,
  className?: string,
  text?: string,
): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function keywordTextFor(entry: ActivationEntry): string {
  if (entry.origin === "constant") return "(constant)";
  if (entry.origin === "sticky") return "(sticky)";
  const primary = entry.matchedPrimary;
  const secondary = entry.matchedSecondary.filter(
    (item) => !primary.some((p) => p.toLowerCase() === item.toLowerCase()),
  );
  if (primary.length > 0 && secondary.length > 0) {
    return `(${primary.join(", ")} AND ANY ${secondary.join(", ")})`;
  }
  if (primary.length > 0) return `(${primary.join(", ")})`;
  if (secondary.length > 0) return `(secondary: ${secondary.join(", ")})`;
  if (entry.origin === "vector") return "(vector match)";
  return "(no keyword)";
}

export function entryTooltip(entry: ActivationEntry): string {
  const lines = [
    `[${entry.book}] ${entry.title}`,
    "---",
    `Activation: ${ORIGIN_LABEL[entry.origin] ?? entry.origin}`,
  ];
  if (entry.keys.length > 0) lines.push(`Keys: ${entry.keys.join(", ")}`);
  if (entry.matchedPrimary.length > 0) lines.push(`Matched primary: ${entry.matchedPrimary.join(", ")}`);
  if (entry.matchedSecondary.length > 0) lines.push(`Matched secondary: ${entry.matchedSecondary.join(", ")}`);
  const extras: string[] = [];
  if (entry.pass >= 0) extras.push(`pass ${entry.pass + 1}`);
  if (entry.activationOrder !== undefined) extras.push(`order ${entry.activationOrder}`);
  if (entry.estimatedTokens !== undefined) extras.push(`~${entry.estimatedTokens} tokens`);
  if (entry.score !== undefined) extras.push(`score ${entry.score.toFixed(3)}`);
  if (extras.length > 0) lines.push(extras.join(" • "));
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles — host tokens with literal fallbacks, scoped under `data-lwi-root`.
// ─────────────────────────────────────────────────────────────────────────────

export const PANEL_CSS = `
[data-lwi-root] {
  --lwi-text: var(--lumiverse-text, rgba(255,255,255,0.92));
  --lwi-text-muted: var(--lumiverse-text-muted, rgba(255,255,255,0.6));
  --lwi-text-dim: var(--lumiverse-text-dim, rgba(255,255,255,0.4));
  --lwi-fill: var(--lumiverse-fill, rgba(255,255,255,0.06));
  --lwi-fill-subtle: var(--lumiverse-fill-subtle, rgba(255,255,255,0.03));
  --lwi-fill-hover: var(--lumiverse-fill-hover, rgba(255,255,255,0.1));
  --lwi-border: var(--lumiverse-border, rgba(255,255,255,0.12));
  --lwi-accent: var(--lumiverse-accent, #2dd4bf);
  --lwi-accent-fg: var(--lumiverse-accent-fg, #04211d);
  --lwi-radius: var(--lumiverse-radius, 10px);
  --lwi-fast: var(--lumiverse-transition-fast, 120ms ease);
  color: var(--lwi-text);
  font-size: calc(13px * var(--lumiverse-font-scale, 1));
}
.lwi-toolbar {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 8px; border-bottom: 1px solid var(--lwi-border);
}
.lwi-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px; cursor: pointer; user-select: none;
  border: 1px solid var(--lwi-border); background: var(--lwi-fill-subtle);
  color: var(--lwi-text-muted); transition: background var(--lwi-fast), color var(--lwi-fast);
}
.lwi-chip:hover { background: var(--lwi-fill-hover); }
.lwi-chip[data-on="true"] { color: var(--lwi-text); border-color: var(--lwi-accent); }
.lwi-chip[data-on="true"] .lwi-chip-dot { background: var(--lwi-accent); }
.lwi-chip-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--lwi-text-dim); }
.lwi-btn {
  padding: 4px 10px; border-radius: var(--lwi-radius); cursor: pointer;
  border: 1px solid var(--lwi-border); background: var(--lwi-fill);
  color: var(--lwi-text); transition: background var(--lwi-fast);
}
.lwi-btn:hover { background: var(--lwi-fill-hover); }
.lwi-btn--accent { background: var(--lwi-accent); border-color: var(--lwi-accent); color: var(--lwi-accent-fg); font-weight: 600; }
.lwi-status {
  padding: 6px 10px; color: var(--lwi-text-dim);
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  border-bottom: 1px solid var(--lwi-border);
}
.lwi-list { padding: 6px; overflow-y: auto; }
.lwi-book {
  padding: 6px 8px; margin-top: 6px; font-weight: 600;
  color: var(--lwi-text-muted); font-size: calc(11px * var(--lumiverse-font-scale, 1));
  text-transform: uppercase; letter-spacing: 0.06em;
}
.lwi-entry {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 8px; border-radius: var(--lwi-radius); cursor: pointer;
  transition: background var(--lwi-fast);
}
.lwi-entry:hover { background: var(--lwi-fill); }
.lwi-entry:focus-visible { outline: 1px solid var(--lwi-accent); outline-offset: 1px; }
.lwi-entry-chevron {
  flex: none; margin-top: 3px; color: var(--lwi-text-dim);
  transition: transform var(--lwi-fast);
}
.lwi-entry:hover .lwi-entry-chevron { color: var(--lwi-accent); }
/* Entry detail modal */
.lwi-detail-meta {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px;
}
.lwi-detail-content {
  margin: 0; padding: 10px; border-radius: var(--lwi-radius);
  border: 1px solid var(--lwi-border); background: var(--lwi-fill-subtle);
  color: var(--lwi-text); font-size: calc(12.5px * var(--lumiverse-font-scale, 1));
  line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere;
  max-height: 46vh; overflow-y: auto; user-select: text; cursor: auto;
}
.lwi-detail-notice { padding: 14px 6px; text-align: center; color: var(--lwi-text-muted); }
.lwi-detail-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.lwi-dot { flex: none; width: 10px; height: 10px; border-radius: 999px; margin-top: 4px; }
.lwi-dot--constant { background: #3b82f6; box-shadow: 0 0 6px rgba(59,130,246,0.7); }
.lwi-dot--keyword { background: #22c55e; }
.lwi-dot--vector { background: #a78bfa; }
.lwi-dot--sticky { background: #f59e0b; box-shadow: 0 0 6px rgba(245,158,11,0.7); }
.lwi-dot--unknown { background: var(--lwi-text-dim); }
.lwi-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.lwi-tags { display: inline-flex; gap: 4px; margin-left: 6px; vertical-align: middle; }
.lwi-tag {
  font-size: calc(10px * var(--lumiverse-font-scale, 1)); padding: 1px 6px;
  border-radius: 999px; border: 1px solid var(--lwi-border); color: var(--lwi-text-muted);
}
.lwi-empty { padding: 18px 10px; text-align: center; color: var(--lwi-text-dim); }
.lwi-hidden {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  color: var(--lwi-text-dim); font-style: italic;
}
/* Float widget.
   The host float container is exactly width x height and (in chromeless
   mode) gives the extension full visual ownership. The root must fill the
   host box 100% and the button must use border-box, otherwise the button
   collapses to its content height inside the empty host box and the badge
   gets clipped by the host's overflow boundaries. The badge therefore lives
   INSIDE the button box - nothing may overflow the root. */
[data-lwi-root].lwi-widget-host {
  width: 100%; height: 100%;
}
.lwi-widget {
  box-sizing: border-box; width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--lwi-radius); border: 1px solid var(--lwi-border);
  background: var(--lumiverse-bg, rgba(20,24,28,0.92));
  color: var(--lwi-text); cursor: pointer; position: relative;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  transition: border-color var(--lwi-fast), transform var(--lwi-fast);
}
.lwi-widget:hover { border-color: var(--lwi-accent); transform: translateY(-1px); }
.lwi-widget[data-empty="true"] { opacity: 0.55; }
.lwi-badge {
  position: absolute; top: 2px; right: 2px; min-width: 14px; max-width: 30px;
  height: 14px; padding: 0 4px; border-radius: 999px;
  background: var(--lwi-accent); border: 1px solid rgba(0,0,0,0.25);
  color: var(--lwi-accent-fg); font-size: calc(10px * var(--lumiverse-font-scale, 1));
  font-weight: 700; line-height: 1; display: flex; align-items: center; justify-content: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none; box-sizing: border-box;
}
.lwi-badge[data-zero="true"] { display: none; }
.lwi-widget-icon { display: block; margin-top: 6px; }
.lwi-widget[data-has-badge="true"] .lwi-widget-icon { margin-top: 8px; }
/* Report modal */
.lwi-report { color: var(--lwi-text); font-size: calc(13px * var(--lumiverse-font-scale, 1)); }
.lwi-report-summary { color: var(--lwi-text-muted); margin-bottom: 8px; }
.lwi-report-subtitle { font-weight: 700; margin: 14px 0 6px; }
.lwi-report table { width: 100%; border-collapse: collapse; }
.lwi-report th, .lwi-report td {
  text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--lwi-border);
  vertical-align: top;
}
.lwi-report th { color: var(--lwi-text-muted); font-weight: 600; }
.lwi-report td.lwi-count { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.lwi-report details summary { cursor: pointer; color: var(--lwi-text-muted); }
.lwi-report details ul { margin: 4px 0 4px 16px; padding: 0; }
.lwi-report li { margin: 2px 0; overflow-wrap: anywhere; }
.lwi-report .lwi-kw { color: var(--lwi-accent); }
.lwi-report .lwi-const { color: #3b82f6; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Drawer tab panel
// ─────────────────────────────────────────────────────────────────────────────

export interface PanelCallbacks {
  onToggle(key: keyof PanelSettings): void;
  onReport(): void;
  onTriggered(): void;
  onResetPosition(): void;
  /** QOL: clicking an entry opens its full content. */
  onEntryClick(entry: ActivationEntry): void;
}

export interface PanelHandles {
  setStatus(text: string): void;
  updateBadge(count: number): void;
  render(snapshot: ActivationSnapshot | null, settings: PanelSettings, role: UserRole): void;
}

interface ChipRefs {
  group: HTMLElement;
  order: HTMLElement;
}

export function createPanel(
  doc: Document,
  root: HTMLElement,
  settings: PanelSettings,
  callbacks: PanelCallbacks,
): PanelHandles {
  root.setAttribute("data-lwi-root", "");

  const toolbar = el(doc, "div", "lwi-toolbar");
  const chips: ChipRefs = {
    group: el(doc, "div", "lwi-chip"),
    order: el(doc, "div", "lwi-chip"),
  };
  const buildChip = (node: HTMLElement, label: string, title: string, key: keyof PanelSettings) => {
    const dot = el(doc, "span", "lwi-chip-dot");
    node.append(dot, el(doc, "span", undefined, label));
    node.title = title;
    node.addEventListener("click", () => callbacks.onToggle(key));
    toolbar.append(node);
  };
  buildChip(chips.group, "Group by book", "Group activated entries by World Info book", "group");
  buildChip(chips.order, "Activation order", "Show entries in activation order instead of alphabetically", "order");

  const hint = el(
    doc,
    "div",
    "lwi-status",
    "Tip: click any entry to read its full content, nyaa~",
  );
  hint.style.borderBottom = "none";
  hint.style.paddingBottom = "0";

  const reportBtn = el(doc, "button", "lwi-btn lwi-btn--accent", "Report") as HTMLButtonElement;
  reportBtn.type = "button";
  reportBtn.title = "Keyword trigger report (same as the wi-report command)";
  reportBtn.addEventListener("click", () => callbacks.onReport());
  const triggeredBtn = el(doc, "button", "lwi-btn", "Triggered") as HTMLButtonElement;
  triggeredBtn.type = "button";
  triggeredBtn.title = "List the entries activated by the latest generation";
  triggeredBtn.addEventListener("click", () => callbacks.onTriggered());
  const resetBtn = el(doc, "button", "lwi-btn", "Reset icon") as HTMLButtonElement;
  resetBtn.type = "button";
  resetBtn.title = "Reset the floating book icon to its default position";
  resetBtn.addEventListener("click", () => callbacks.onResetPosition());
  toolbar.append(reportBtn, triggeredBtn, resetBtn);

  const status = el(doc, "div", "lwi-status", "Waiting for the first generation…");
  const list = el(doc, "div", "lwi-list");
  root.append(toolbar, status, hint, list);
  let currentSnapshot: ActivationSnapshot | null = null;
  let currentRole: UserRole = "unknown";
  let currentSettings = settings;

  const refreshChips = () => {
    chips.group.dataset.on = String(currentSettings.group);
    chips.order.dataset.on = String(currentSettings.order);
  };
  refreshChips();

  const sortedEntries = (entries: readonly ActivationEntry[]): ActivationEntry[] => {
    const copy = [...entries];
    if (currentSettings.order) {
      copy.sort(
        (a, b) =>
          (a.activationOrder ?? Number.MAX_SAFE_INTEGER) -
            (b.activationOrder ?? Number.MAX_SAFE_INTEGER) ||
          a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
      );
    } else {
      copy.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    }
    return copy;
  };

  const renderEntryRow = (entry: ActivationEntry) => {
    const row = el(doc, "div", "lwi-entry");
    row.title = `${entryTooltip(entry)}\n---\nClick: view this entry's content`;
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.append(el(doc, "span", `lwi-dot lwi-dot--${entry.origin}`));
    const title = el(doc, "div", "lwi-title", entry.title);
    const tags = el(doc, "span", "lwi-tags");
    if (entry.origin === "sticky") tags.append(el(doc, "span", "lwi-tag", "sticky"));
    if (entry.origin === "constant") tags.append(el(doc, "span", "lwi-tag", "constant"));
    if (entry.origin === "vector") tags.append(el(doc, "span", "lwi-tag", "vector"));
    if (entry.firstTriggeredForBook) tags.append(el(doc, "span", "lwi-tag", "first"));
    if (tags.childElementCount > 0) title.append(tags);
    row.append(title);
    const chevron = el(doc, "span", "lwi-entry-chevron");
    chevron.innerHTML = CHEVRON_SVG;
    row.append(chevron);
    const open = () => callbacks.onEntryClick(entry);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    return row;
  };

  const renderList = () => {
    list.replaceChildren();
    const snapshot = currentSnapshot;
    if (!snapshot || snapshot.entries.length === 0) {
      list.append(el(doc, "div", "lwi-empty", "No active entries for this generation."));
      return;
    }

    const privacy = applyPrivacy(
      snapshot.entries,
      parseHiddenPatterns(currentSettings.hidden),
      currentRole,
    );

    if (currentSettings.group) {
      const byBook = new Map<string, ActivationEntry[]>();
      for (const entry of sortedEntries(privacy.visible)) {
        const bucket = byBook.get(entry.book) ?? [];
        bucket.push(entry);
        byBook.set(entry.book, bucket);
      }
      for (const [book, entries] of byBook) {
        list.append(el(doc, "div", "lwi-book", book));
        for (const entry of entries) list.append(renderEntryRow(entry));
      }
      for (const book of privacy.hiddenBooks) {
        list.append(el(doc, "div", "lwi-book", book));
        list.append(el(doc, "div", "lwi-hidden", "(hidden entries)"));
      }
    } else {
      for (const entry of sortedEntries(privacy.visible)) list.append(renderEntryRow(entry));
      if (privacy.hiddenCount > 0) {
        list.append(
          el(doc, "div", "lwi-hidden", `(hidden entries: ${privacy.hiddenCount})`),
        );
      }
    }
  };

  return {
    setStatus(text: string) {
      status.textContent = text;
    },
    updateBadge(count: number) {
      // Badge text lives on the drawer tab handle (set by the owner) and the
      // float widget bubble; the panel itself only tracks the list.
      void count;
    },
    render(snapshot: ActivationSnapshot | null, nextSettings: PanelSettings, role: UserRole) {
      currentSnapshot = snapshot;
      currentSettings = nextSettings;
      currentRole = role;
      refreshChips();
      renderList();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Float widget visuals
// ─────────────────────────────────────────────────────────────────────────────

export function mountWidgetButton(
  doc: Document,
  root: HTMLElement,
): { badge: HTMLElement; button: HTMLElement } {
  root.setAttribute("data-lwi-root", "");
  // Fill the host float box exactly so the button (and its badge) can never
  // be clipped by the host's overflow boundaries.
  root.classList.add("lwi-widget-host");
  const button = el(doc, "div", "lwi-widget");
  button.title = "Active World Info\n---\nClick: open the World Info Info tab";
  const icon = el(doc, "span", "lwi-widget-icon");
  icon.innerHTML = BOOK_SVG;
  button.append(icon);
  const badge = el(doc, "span", "lwi-badge", "0");
  badge.dataset.zero = "true";
  button.append(badge);
  root.replaceChildren(button);
  return { badge, button };
}

export function setWidgetCount(
  refs: { badge: HTMLElement } | null,
  count: number,
): void {
  if (!refs) return;
  // "99+" keeps the badge inside the 46px button even for huge activations.
  refs.badge.textContent = count > 99 ? "99+" : String(count);
  refs.badge.dataset.zero = String(count === 0);
  refs.badge.closest(".lwi-widget")?.setAttribute("data-has-badge", String(count > 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry detail modal (click an entry → view its content)
// ─────────────────────────────────────────────────────────────────────────────

export type EntryContentResult =
  | { state: "loading" }
  | { state: "ready"; content: string }
  | { state: "hidden" }
  | { state: "missing" }
  | { state: "unavailable" }
  | { state: "error" };

function detailChip(doc: Document, label: string): HTMLElement {
  return el(doc, "span", "lwi-tag", label);
}

export function buildEntryDetail(
  doc: Document,
  entry: ActivationEntry,
  result: EntryContentResult,
): HTMLElement {
  const wrap = el(doc, "div", "lwi-detail");
  wrap.setAttribute("data-lwi-root", "");

  const meta = el(doc, "div", "lwi-detail-meta");
  meta.append(detailChip(doc, `book: ${entry.book}`));
  meta.append(detailChip(doc, ORIGIN_LABEL[entry.origin] ?? entry.origin));
  if (entry.keys.length > 0) meta.append(detailChip(doc, `keys: ${entry.keys.join(", ")}`));
  const extras: string[] = [];
  if (entry.pass >= 0) extras.push(`pass ${entry.pass + 1}`);
  if (entry.activationOrder !== undefined) extras.push(`order ${entry.activationOrder}`);
  if (entry.estimatedTokens !== undefined) extras.push(`~${entry.estimatedTokens} tokens`);
  if (entry.score !== undefined) extras.push(`score ${entry.score.toFixed(3)}`);
  if (extras.length > 0) meta.append(detailChip(doc, extras.join(" • ")));
  wrap.append(meta);

  if (result.state === "loading") {
    wrap.append(el(doc, "div", "lwi-detail-notice", "Loading entry content…"));
  } else if (result.state === "hidden") {
    wrap.append(
      el(
        doc,
        "div",
        "lwi-detail-notice",
        "This entry belongs to a hidden book — content is masked for your role.",
      ),
    );
  } else if (result.state === "missing") {
    wrap.append(
      el(
        doc,
        "div",
        "lwi-detail-notice",
        "The entry no longer exists (it may have been edited or removed since this generation).",
      ),
    );
  } else if (result.state === "unavailable") {
    wrap.append(
      el(
        doc,
        "div",
        "lwi-detail-notice",
        "World book content is not available on this host (worldBooks API missing).",
      ),
    );
  } else if (result.state === "error") {
    wrap.append(el(doc, "div", "lwi-detail-notice", "Failed to load the entry content."));
  } else {
    const pre = el(doc, "pre", "lwi-detail-content", result.content);
    wrap.append(pre);
  }
  return wrap;
}

export function appendCopyButton(
  doc: Document,
  footer: HTMLElement,
  getText: () => string,
): void {
  const copy = el(doc, "button", "lwi-btn", "Copy content") as HTMLButtonElement;
  copy.type = "button";
  const flash = (label: string): void => {
    copy.textContent = label;
    window.setTimeout(() => {
      copy.textContent = "Copy content";
    }, 1500);
  };
  copy.addEventListener("click", () => {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      flash("Copy unavailable");
      return;
    }
    clipboard
      .writeText(getText())
      .then(() => flash("Copied!"))
      .catch(() => flash("Copy failed"));
  });
  footer.append(copy);
}

// ─────────────────────────────────────────────────────────────────────────────
// Report modal (port of the ST /wi-report popup)
// ─────────────────────────────────────────────────────────────────────────────

interface FrequencyRow {
  keyword: string;
  hits: number;
  entries: string[];
}

function buildFrequency(
  snapshots: readonly ActivationSnapshot[],
  settings: PanelSettings,
  role: UserRole,
): { rows: FrequencyRow[]; hiddenCount: number } {
  const patterns = parseHiddenPatterns(settings.hidden);
  const freq = new Map<string, { hits: number; entries: Set<string> }>();
  let hiddenCount = 0;

  const entryLabel = (entry: ActivationEntry): string => {
    const book = entry.book === "(no book)" ? entry.id : `${entry.book}:${entry.id}`;
    return `${book} — ${entry.title}`;
  };

  for (const snapshot of snapshots) {
    for (const entry of snapshot.entries) {
      if (!isPrivilegedRole(role) && patterns.length > 0) {
        const privacy = applyPrivacy([entry], patterns, role);
        if (privacy.hiddenCount > 0) {
          hiddenCount += 1;
          continue;
        }
      }
      let keywords: string[];
      if (entry.origin === "constant" || entry.origin === "sticky" || entry.origin === "vector") {
        continue; // Non-keyword activations carry no trigger keywords.
      }
      keywords = [...entry.matchedPrimary, ...entry.matchedSecondary];
      if (keywords.length === 0) keywords = ["(no keyword)"];
      for (const keyword of keywords) {
        const record = freq.get(keyword) ?? { hits: 0, entries: new Set<string>() };
        record.hits += 1;
        record.entries.add(entryLabel(entry));
        freq.set(keyword, record);
      }
    }
  }

  const rows: FrequencyRow[] = [...freq.entries()]
    .map(([keyword, record]) => ({
      keyword,
      hits: record.hits,
      entries: [...record.entries].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.hits - a.hits || a.keyword.localeCompare(b.keyword));
  return { rows, hiddenCount };
}

function buildStatsLine(snapshot: ActivationSnapshot | undefined): string {
  if (!snapshot) return "No activation events captured yet — run a generation first, nyaa~";
  const stats = snapshot.stats ?? {};
  const parts: string[] = [];
  parts.push(`Entries: ${stats.totalActivated ?? snapshot.entries.length}`);
  if (stats.keywordActivated !== undefined) parts.push(`Keyword: ${stats.keywordActivated}`);
  if (stats.vectorActivated !== undefined) parts.push(`Vector: ${stats.vectorActivated}`);
  if (stats.recursionPassesUsed !== undefined) parts.push(`Recursion passes: ${stats.recursionPassesUsed}`);
  if (stats.estimatedTokens !== undefined) parts.push(`Est. tokens: ${stats.estimatedTokens}`);
  return parts.join(" • ");
}

function buildPassSections(
  container: HTMLElement,
  doc: Document,
  snapshot: ActivationSnapshot | undefined,
  settings: PanelSettings,
  role: UserRole,
): void {
  if (!snapshot || snapshot.entries.length === 0) return;
  const privacy = applyPrivacy(snapshot.entries, parseHiddenPatterns(settings.hidden), role);
  if (privacy.visible.length === 0) return;

  const byPass = new Map<number, ActivationEntry[]>();
  for (const entry of privacy.visible) {
    const pass = entry.pass >= 0 ? entry.pass : 0;
    const bucket = byPass.get(pass) ?? [];
    bucket.push(entry);
    byPass.set(pass, bucket);
  }
  for (const [pass, entries] of [...byPass.entries()].sort((a, b) => a[0] - b[0])) {
    container.append(el(doc, "div", "lwi-report-subtitle", `Pass ${pass + 1}`));
    const list = el(doc, "ul");
    for (const entry of entries) {
      const li = el(doc, "li", undefined, `${entry.book}:${entry.id} — ${entry.title}`);
      const kw = el(doc, "span", "lwi-kw", ` ${keywordTextFor(entry)}`);
      if (entry.origin === "constant") li.classList.add("lwi-const");
      li.append(kw);
      list.append(li);
    }
    container.append(list);
  }
}

function buildHistorySection(
  container: HTMLElement,
  doc: Document,
  snapshots: readonly ActivationSnapshot[],
): void {
  if (snapshots.length === 0) return;
  container.append(el(doc, "div", "lwi-report-subtitle", `History (${snapshots.length} generations)`));
  const list = el(doc, "ul");
  for (const snapshot of [...snapshots].slice(-10).reverse()) {
    list.append(
      el(
        doc,
        "li",
        undefined,
        `${formatTime(snapshot.ts)} — ${snapshot.entries.length} entries`,
      ),
    );
  }
  container.append(list);
}

export function buildReportContent(
  doc: Document,
  snapshots: readonly ActivationSnapshot[],
  settings: PanelSettings,
  role: UserRole,
  includeHistory: boolean,
): HTMLElement {
  const container = el(doc, "div", "lwi-report");
  container.setAttribute("data-lwi-root", "");

  const latest = snapshots.at(-1);
  const scoped = includeHistory ? snapshots : latest ? [latest] : [];
  const { rows, hiddenCount } = buildFrequency(scoped, settings, role);

  container.append(el(doc, "div", "lwi-report-title", "World Info Keyword Report"));
  const summaryLines = [buildStatsLine(latest)];
  summaryLines.push(
    includeHistory
      ? `Scope: ${scoped.length} generations • Unique keywords: ${rows.length}`
      : `Scope: latest generation • Unique keywords: ${rows.length}`,
  );
  if (hiddenCount > 0) summaryLines.push(`Hidden-book entries omitted: ${hiddenCount}`);
  container.append(el(doc, "div", "lwi-report-summary", summaryLines.join("\n")));

  if (rows.length > 0) {
    container.append(el(doc, "div", "lwi-report-subtitle", "Keyword Frequency"));
    const table = el(doc, "table");
    const thead = el(doc, "thead");
    const headRow = el(doc, "tr");
    for (const label of ["Keyword", "Hits", "Entries"]) {
      const th = el(doc, "th", label === "Hits" ? "lwi-count" : undefined, label);
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);
    const tbody = el(doc, "tbody");
    for (const row of rows) {
      const tr = el(doc, "tr");
      tr.append(el(doc, "td", undefined, row.keyword));
      tr.append(el(doc, "td", "lwi-count", String(row.hits)));
      const tdEntries = el(doc, "td");
      const details = el(doc, "details");
      const summary = el(doc, "summary", undefined, `${row.entries.length} ${row.entries.length === 1 ? "entry" : "entries"}`);
      details.append(summary);
      const ul = el(doc, "ul");
      for (const entry of row.entries) ul.append(el(doc, "li", undefined, entry));
      details.append(ul);
      tdEntries.append(details);
      tr.append(tdEntries);
      tbody.append(tr);
    }
    table.append(tbody);
    container.append(table);
  }

  buildPassSections(container, doc, latest, settings, role);
  if (includeHistory) buildHistorySection(container, doc, snapshots);
  return container;
}
