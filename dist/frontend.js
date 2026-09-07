// src/shared/types.ts
var HISTORY_MAX_ENTRIES = 200;
function boundEntries(entries) {
  if (entries.length <= HISTORY_MAX_ENTRIES)
    return [...entries];
  return entries.slice(entries.length - HISTORY_MAX_ENTRIES);
}

// src/normalize.ts
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function str(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function strList(value) {
  if (!Array.isArray(value))
    return [];
  return value.filter((item) => typeof item === "string" && item.length > 0);
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function bool(value) {
  return value === true;
}
function originFrom(record) {
  const provenance = asRecord(record.activationProvenance);
  const provenanceOrigin = str(provenance?.origin);
  if (provenanceOrigin === "constant" || provenanceOrigin === "sticky" || provenanceOrigin === "keyword" || provenanceOrigin === "vector") {
    return provenanceOrigin;
  }
  const activationType = str(record.activationType);
  if (activationType === "constant" || activationType === "sticky" || activationType === "keyword" || activationType === "vector") {
    return activationType;
  }
  const source = str(record.source);
  if (source === "vector")
    return "vector";
  if (source === "keyword")
    return "keyword";
  return "unknown";
}
function normalizeEntry(raw) {
  const record = asRecord(raw);
  if (!record)
    return null;
  const id = str(record.id) ?? str(record.uid);
  if (!id)
    return null;
  const keys = strList(record.keys);
  const comment = str(record.comment) ?? str(record.label);
  const title = comment ?? (keys.length > 0 ? keys.join(", ") : id);
  const book = str(record.bookName) ?? str(record.world) ?? "(no book)";
  const provenance = asRecord(record.activationProvenance);
  const origin = originFrom(record);
  const matchedPrimary = origin === "keyword" ? strList(provenance?.matchedPrimaryKeys) : [];
  const matchedSecondary = origin === "keyword" ? strList(provenance?.matchedSecondaryKeys) : [];
  const rawPass = num(provenance?.activationPass);
  return {
    id,
    title,
    book,
    keys,
    origin,
    matchedPrimary,
    matchedSecondary,
    pass: rawPass ?? -1,
    firstTriggeredForBook: bool(record.firstTriggeredForBook),
    score: num(record.score),
    estimatedTokens: num(record.estimatedTokens),
    activationOrder: num(record.activationOrder)
  };
}
function normalizePayload(payload) {
  const record = asRecord(payload);
  if (!record)
    return { chatId: null, entries: [], stats: undefined };
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const entries = rawEntries.map(normalizeEntry).filter((entry) => entry !== null);
  const statsRecord = asRecord(record.stats);
  const stats = statsRecord ? {
    totalActivated: num(statsRecord.totalActivated),
    keywordActivated: num(statsRecord.keywordActivated),
    vectorActivated: num(statsRecord.vectorActivated),
    recursionPassesUsed: num(statsRecord.recursionPassesUsed),
    estimatedTokens: num(statsRecord.estimatedTokens)
  } : undefined;
  const chatId = str(record.chatId) ?? null;
  return { chatId, entries, stats };
}
function parseHiddenPatterns(raw) {
  if (typeof raw !== "string")
    return [];
  return raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}
function isPrivilegedRole(role) {
  return role === "operator" || role === "admin";
}
function isHiddenBook(book, patterns, role) {
  if (patterns.length === 0 || isPrivilegedRole(role))
    return false;
  const normalized = book.trim().toLowerCase();
  return patterns.some((pattern) => normalized.startsWith(pattern.toLowerCase()));
}
function applyPrivacy(entries, patterns, role) {
  const visible = [];
  const hiddenBooks = new Set;
  for (const entry of entries) {
    if (isHiddenBook(entry.book, patterns, role)) {
      hiddenBooks.add(entry.book);
    } else {
      visible.push(entry);
    }
  }
  return { visible, hiddenCount: entries.length - visible.length, hiddenBooks: [...hiddenBooks] };
}

// src/panel.ts
var BOOK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>';
var ORIGIN_LABEL = {
  constant: "constant",
  sticky: "sticky",
  keyword: "keyword",
  vector: "vector",
  unknown: "activated"
};
function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className)
    node.className = className;
  if (text !== undefined)
    node.textContent = text;
  return node;
}
function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}
function keywordTextFor(entry) {
  if (entry.origin === "constant")
    return "(constant)";
  if (entry.origin === "sticky")
    return "(sticky)";
  const primary = entry.matchedPrimary;
  const secondary = entry.matchedSecondary.filter((item) => !primary.some((p) => p.toLowerCase() === item.toLowerCase()));
  if (primary.length > 0 && secondary.length > 0) {
    return `(${primary.join(", ")} AND ANY ${secondary.join(", ")})`;
  }
  if (primary.length > 0)
    return `(${primary.join(", ")})`;
  if (secondary.length > 0)
    return `(secondary: ${secondary.join(", ")})`;
  if (entry.origin === "vector")
    return "(vector match)";
  return "(no keyword)";
}
function entryTooltip(entry) {
  const lines = [
    `[${entry.book}] ${entry.title}`,
    "---",
    `Activation: ${ORIGIN_LABEL[entry.origin] ?? entry.origin}`
  ];
  if (entry.keys.length > 0)
    lines.push(`Keys: ${entry.keys.join(", ")}`);
  if (entry.matchedPrimary.length > 0)
    lines.push(`Matched primary: ${entry.matchedPrimary.join(", ")}`);
  if (entry.matchedSecondary.length > 0)
    lines.push(`Matched secondary: ${entry.matchedSecondary.join(", ")}`);
  const extras = [];
  if (entry.pass >= 0)
    extras.push(`pass ${entry.pass + 1}`);
  if (entry.activationOrder !== undefined)
    extras.push(`order ${entry.activationOrder}`);
  if (entry.estimatedTokens !== undefined)
    extras.push(`~${entry.estimatedTokens} tokens`);
  if (entry.score !== undefined)
    extras.push(`score ${entry.score.toFixed(3)}`);
  if (extras.length > 0)
    lines.push(extras.join(" • "));
  return lines.join(`
`);
}
var PANEL_CSS = `
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
  padding: 6px 8px; border-radius: var(--lwi-radius); cursor: default;
  transition: background var(--lwi-fast);
}
.lwi-entry:hover { background: var(--lwi-fill); }
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
/* Float widget */
.lwi-widget {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  border-radius: var(--lwi-radius); border: 1px solid var(--lwi-border);
  background: var(--lumiverse-bg, rgba(20,24,28,0.92));
  color: var(--lwi-text); cursor: pointer; position: relative;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  transition: border-color var(--lwi-fast), transform var(--lwi-fast);
}
.lwi-widget:hover { border-color: var(--lwi-accent); transform: translateY(-1px); }
.lwi-widget[data-empty="true"] { opacity: 0.55; }
.lwi-badge {
  position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px;
  padding: 0 4px; border-radius: 999px; background: var(--lwi-accent);
  color: var(--lwi-accent-fg); font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.lwi-badge[data-zero="true"] { display: none; }
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
function createPanel(doc, root, settings, callbacks) {
  root.setAttribute("data-lwi-root", "");
  const toolbar = el(doc, "div", "lwi-toolbar");
  const chips = {
    group: el(doc, "div", "lwi-chip"),
    order: el(doc, "div", "lwi-chip")
  };
  const buildChip = (node, label, title, key) => {
    const dot = el(doc, "span", "lwi-chip-dot");
    node.append(dot, el(doc, "span", undefined, label));
    node.title = title;
    node.addEventListener("click", () => callbacks.onToggle(key));
    toolbar.append(node);
  };
  buildChip(chips.group, "Group by book", "Group activated entries by World Info book", "group");
  buildChip(chips.order, "Activation order", "Show entries in activation order instead of alphabetically", "order");
  const reportBtn = el(doc, "button", "lwi-btn lwi-btn--accent", "Report");
  reportBtn.type = "button";
  reportBtn.title = "Keyword trigger report (same as the wi-report command)";
  reportBtn.addEventListener("click", () => callbacks.onReport());
  const triggeredBtn = el(doc, "button", "lwi-btn", "Triggered");
  triggeredBtn.type = "button";
  triggeredBtn.title = "List the entries activated by the latest generation";
  triggeredBtn.addEventListener("click", () => callbacks.onTriggered());
  const resetBtn = el(doc, "button", "lwi-btn", "Reset icon");
  resetBtn.type = "button";
  resetBtn.title = "Reset the floating book icon to its default position";
  resetBtn.addEventListener("click", () => callbacks.onResetPosition());
  toolbar.append(reportBtn, triggeredBtn, resetBtn);
  const status = el(doc, "div", "lwi-status", "Waiting for the first generation…");
  const list = el(doc, "div", "lwi-list");
  root.append(toolbar, status, list);
  let currentSnapshot = null;
  let currentRole = "unknown";
  let currentSettings = settings;
  const refreshChips = () => {
    chips.group.dataset.on = String(currentSettings.group);
    chips.order.dataset.on = String(currentSettings.order);
  };
  refreshChips();
  const sortedEntries = (entries) => {
    const copy = [...entries];
    if (currentSettings.order) {
      copy.sort((a, b) => (a.activationOrder ?? Number.MAX_SAFE_INTEGER) - (b.activationOrder ?? Number.MAX_SAFE_INTEGER) || a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    } else {
      copy.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    }
    return copy;
  };
  const renderEntryRow = (entry) => {
    const row = el(doc, "div", "lwi-entry");
    row.title = entryTooltip(entry);
    row.append(el(doc, "span", `lwi-dot lwi-dot--${entry.origin}`));
    const title = el(doc, "div", "lwi-title", entry.title);
    const tags = el(doc, "span", "lwi-tags");
    if (entry.origin === "sticky")
      tags.append(el(doc, "span", "lwi-tag", "sticky"));
    if (entry.origin === "constant")
      tags.append(el(doc, "span", "lwi-tag", "constant"));
    if (entry.origin === "vector")
      tags.append(el(doc, "span", "lwi-tag", "vector"));
    if (entry.firstTriggeredForBook)
      tags.append(el(doc, "span", "lwi-tag", "first"));
    if (tags.childElementCount > 0)
      title.append(tags);
    row.append(title);
    return row;
  };
  const renderList = () => {
    list.replaceChildren();
    const snapshot = currentSnapshot;
    if (!snapshot || snapshot.entries.length === 0) {
      list.append(el(doc, "div", "lwi-empty", "No active entries for this generation."));
      return;
    }
    const privacy = applyPrivacy(snapshot.entries, parseHiddenPatterns(currentSettings.hidden), currentRole);
    if (currentSettings.group) {
      const byBook = new Map;
      for (const entry of sortedEntries(privacy.visible)) {
        const bucket = byBook.get(entry.book) ?? [];
        bucket.push(entry);
        byBook.set(entry.book, bucket);
      }
      for (const [book, entries] of byBook) {
        list.append(el(doc, "div", "lwi-book", book));
        for (const entry of entries)
          list.append(renderEntryRow(entry));
      }
      for (const book of privacy.hiddenBooks) {
        list.append(el(doc, "div", "lwi-book", book));
        list.append(el(doc, "div", "lwi-hidden", "(hidden entries)"));
      }
    } else {
      for (const entry of sortedEntries(privacy.visible))
        list.append(renderEntryRow(entry));
      if (privacy.hiddenCount > 0) {
        list.append(el(doc, "div", "lwi-hidden", `(hidden entries: ${privacy.hiddenCount})`));
      }
    }
  };
  return {
    setStatus(text) {
      status.textContent = text;
    },
    updateBadge(count) {},
    render(snapshot, nextSettings, role) {
      currentSnapshot = snapshot;
      currentSettings = nextSettings;
      currentRole = role;
      refreshChips();
      renderList();
    }
  };
}
function mountWidgetButton(doc, root) {
  root.setAttribute("data-lwi-root", "");
  const button = el(doc, "div", "lwi-widget");
  button.title = `Active World Info
---
Click: open the World Info Info tab`;
  button.innerHTML = BOOK_SVG;
  const badge = el(doc, "span", "lwi-badge", "0");
  badge.dataset.zero = "true";
  button.append(badge);
  root.replaceChildren(button);
  return { badge };
}
function setWidgetCount(refs, count) {
  if (!refs)
    return;
  refs.badge.textContent = String(count);
  refs.badge.dataset.zero = String(count === 0);
}
function buildFrequency(snapshots, settings, role) {
  const patterns = parseHiddenPatterns(settings.hidden);
  const freq = new Map;
  let hiddenCount = 0;
  const entryLabel = (entry) => {
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
      let keywords;
      if (entry.origin === "constant" || entry.origin === "sticky" || entry.origin === "vector") {
        continue;
      }
      keywords = [...entry.matchedPrimary, ...entry.matchedSecondary];
      if (keywords.length === 0)
        keywords = ["(no keyword)"];
      for (const keyword of keywords) {
        const record = freq.get(keyword) ?? { hits: 0, entries: new Set };
        record.hits += 1;
        record.entries.add(entryLabel(entry));
        freq.set(keyword, record);
      }
    }
  }
  const rows = [...freq.entries()].map(([keyword, record]) => ({
    keyword,
    hits: record.hits,
    entries: [...record.entries].sort((a, b) => a.localeCompare(b))
  })).sort((a, b) => b.hits - a.hits || a.keyword.localeCompare(b.keyword));
  return { rows, hiddenCount };
}
function buildStatsLine(snapshot) {
  if (!snapshot)
    return "No activation events captured yet — run a generation first, nyaa~";
  const stats = snapshot.stats ?? {};
  const parts = [];
  parts.push(`Entries: ${stats.totalActivated ?? snapshot.entries.length}`);
  if (stats.keywordActivated !== undefined)
    parts.push(`Keyword: ${stats.keywordActivated}`);
  if (stats.vectorActivated !== undefined)
    parts.push(`Vector: ${stats.vectorActivated}`);
  if (stats.recursionPassesUsed !== undefined)
    parts.push(`Recursion passes: ${stats.recursionPassesUsed}`);
  if (stats.estimatedTokens !== undefined)
    parts.push(`Est. tokens: ${stats.estimatedTokens}`);
  return parts.join(" • ");
}
function buildPassSections(container, doc, snapshot, settings, role) {
  if (!snapshot || snapshot.entries.length === 0)
    return;
  const privacy = applyPrivacy(snapshot.entries, parseHiddenPatterns(settings.hidden), role);
  if (privacy.visible.length === 0)
    return;
  const byPass = new Map;
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
      if (entry.origin === "constant")
        li.classList.add("lwi-const");
      li.append(kw);
      list.append(li);
    }
    container.append(list);
  }
}
function buildHistorySection(container, doc, snapshots) {
  if (snapshots.length === 0)
    return;
  container.append(el(doc, "div", "lwi-report-subtitle", `History (${snapshots.length} generations)`));
  const list = el(doc, "ul");
  for (const snapshot of [...snapshots].slice(-10).reverse()) {
    list.append(el(doc, "li", undefined, `${formatTime(snapshot.ts)} — ${snapshot.entries.length} entries`));
  }
  container.append(list);
}
function buildReportContent(doc, snapshots, settings, role, includeHistory) {
  const container = el(doc, "div", "lwi-report");
  container.setAttribute("data-lwi-root", "");
  const latest = snapshots.at(-1);
  const scoped = includeHistory ? snapshots : latest ? [latest] : [];
  const { rows, hiddenCount } = buildFrequency(scoped, settings, role);
  container.append(el(doc, "div", "lwi-report-title", "World Info Keyword Report"));
  const summaryLines = [buildStatsLine(latest)];
  summaryLines.push(includeHistory ? `Scope: ${scoped.length} generations • Unique keywords: ${rows.length}` : `Scope: latest generation • Unique keywords: ${rows.length}`);
  if (hiddenCount > 0)
    summaryLines.push(`Hidden-book entries omitted: ${hiddenCount}`);
  container.append(el(doc, "div", "lwi-report-summary", summaryLines.join(`
`)));
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
      for (const entry of row.entries)
        ul.append(el(doc, "li", undefined, entry));
      details.append(ul);
      tdEntries.append(details);
      tr.append(tdEntries);
      tbody.append(tr);
    }
    table.append(tbody);
    container.append(table);
  }
  buildPassSections(container, doc, latest, settings, role);
  if (includeHistory)
    buildHistorySection(container, doc, snapshots);
  return container;
}

// src/frontend.ts
var DEFAULT_WIDGET_POS = { x: 16, y: 16 };
function isPosition(value) {
  return typeof value === "object" && value !== null && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
}
function clampPosition(position, viewport) {
  const maxX = Math.max(0, viewport.width - 56);
  const maxY = Math.max(0, viewport.height - 56);
  return {
    x: Math.min(Math.max(0, Math.round(position.x)), maxX),
    y: Math.min(Math.max(0, Math.round(position.y)), maxY)
  };
}
async function setup(ctx) {
  const doc = ctx.dom && typeof document !== "undefined" ? document : globalThis.document;
  const disposers = [];
  const logPrefix = "[lumiworld_info]";
  console.info(`${logPrefix} setup() running`);
  const settingsApi = ctx.settings;
  if (!settingsApi) {
    throw new Error("[lumiworld_info] ctx.settings unavailable: host is too old for this extension");
  }
  const settings = {
    group: await settingsApi.get("panel:group") ?? true,
    order: await settingsApi.get("panel:order") ?? true,
    hidden: await settingsApi.get("privacy:hidden") ?? "",
    includeHistory: await settingsApi.get("report:history") ?? false
  };
  const persistSetting = async (key, value) => {
    try {
      await settingsApi.set(key, value);
    } catch (error) {
      console.warn(`${logPrefix} settings.set(${key}) failed:`, error);
    }
  };
  const viewportSize = () => {
    try {
      const geometry = ctx.ui.geometry;
      const size = geometry?.layoutViewportSize?.();
      if (size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0) {
        return { width: size.width, height: size.height };
      }
    } catch {}
    return { width: window.innerWidth, height: window.innerHeight };
  };
  let activeChatId = ctx.getActiveChat().chatId;
  let latestSnapshot = null;
  let history = [];
  let role = "unknown";
  let widgetRefs = null;
  let widgetHandle = null;
  const pendingRoleReplies = new Map;
  const pendingHistoryReplies = new Map;
  disposers.push(ctx.onBackendMessage((payload) => {
    const message = payload;
    if (!message || typeof message.type !== "string")
      return;
    if (message.type === "lumiworld_info:role") {
      const requestId = message.requestId ?? "";
      const resolver = pendingRoleReplies.get(requestId);
      pendingRoleReplies.delete(requestId);
      resolver?.(message.role ?? "unknown");
      return;
    }
    if (message.type === "lumiworld_info:history") {
      const requestId = message.requestId ?? "";
      const resolver = pendingHistoryReplies.get(requestId);
      pendingHistoryReplies.delete(requestId);
      const snapshots = Array.isArray(message.snapshots) ? message.snapshots : [];
      if (message.chatId && message.chatId !== activeChatId)
        resolver?.([]);
      else
        resolver?.(snapshots);
      return;
    }
    if (message.type === "lumiworld_info:command") {
      if (message.command === "report")
        openReport();
      else if (message.command === "triggered")
        openTriggered();
      else if (message.command === "reset-position")
        resetWidgetPosition();
      return;
    }
  }));
  const sendToBackend = (payload) => {
    try {
      ctx.sendToBackend(payload);
    } catch (error) {
      console.warn(`${logPrefix} sendToBackend failed:`, error);
    }
  };
  const requestRole = async () => {
    const requestId = crypto.randomUUID();
    const promise = new Promise((resolve) => {
      pendingRoleReplies.set(requestId, resolve);
      window.setTimeout(() => {
        if (pendingRoleReplies.delete(requestId))
          resolve("unknown");
      }, 5000);
    });
    sendToBackend({ type: "lumiworld_info:get-role", requestId });
    return promise;
  };
  const loadHistory = async (chatId) => {
    const requestId = crypto.randomUUID();
    const promise = new Promise((resolve) => {
      pendingHistoryReplies.set(requestId, resolve);
      window.setTimeout(() => {
        if (pendingHistoryReplies.delete(requestId))
          resolve([]);
      }, 5000);
    });
    sendToBackend({ type: "lumiworld_info:history:load", requestId, chatId });
    history = await promise;
  };
  const appendHistory = (snapshot, chatId) => {
    sendToBackend({
      type: "lumiworld_info:history:append",
      chatId,
      snapshot: { ...snapshot, entries: boundEntries(snapshot.entries) }
    });
  };
  const tab = ctx.ui.registerDrawerTab({
    id: "lumiworld_info_main",
    title: "World Info Info",
    shortName: "WI Info",
    description: "World Info entries activated by the latest generation.",
    keywords: ["world info", "lore", "activated", "keywords", "report"]
  });
  const panel = createPanel(doc, tab.root, settings, {
    onToggle(key) {
      if (key === "group" || key === "order") {
        settings[key] = !settings[key];
        persistSetting(key === "group" ? "panel:group" : "panel:order", settings[key]);
      } else if (key === "hidden") {
        editHiddenPatterns();
        return;
      }
      panel.render(latestSnapshot, settings, role);
    },
    onReport: () => void openReport(),
    onTriggered: () => openTriggered(),
    onResetPosition: () => void resetWidgetPosition()
  });
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
  const editHiddenPatterns = async () => {
    try {
      const modal = ctx.ui.showModal({
        title: "Hidden books",
        width: 420
      });
      const wrap = doc.createElement("div");
      wrap.setAttribute("data-lwi-root", "");
      const label = doc.createElement("div");
      label.style.marginBottom = "8px";
      label.textContent = "Comma-separated book-name prefixes. Books starting with one of these are masked as “(hidden entries)” for non-operator/admin users.";
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
        persistSetting("privacy:hidden", settings.hidden);
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
  const restoreWidgetPosition = () => {
    const saved = savedWidgetPos;
    return saved ? clampPosition(saved, viewportSize()) : { ...DEFAULT_WIDGET_POS };
  };
  const storedPos = await settingsApi.get("widget:pos");
  let savedWidgetPos = isPosition(storedPos) ? clampPosition(storedPos, viewportSize()) : null;
  const attachWidget = () => {
    try {
      const handle = ctx.ui.createFloatWidget({
        width: 46,
        height: 46,
        initialPosition: restoreWidgetPosition(),
        snapToEdge: true,
        tooltip: "Active World Info"
      });
      widgetRefs = mountWidgetButton(doc, handle.root);
      widgetRefs.badge.parentElement?.addEventListener("click", () => {
        tab.activate();
      });
      const offDrag = handle.onDragEnd?.((position) => {
        savedWidgetPos = clampPosition(position, viewportSize());
        persistSetting("widget:pos", savedWidgetPos);
      });
      if (typeof offDrag === "function")
        disposers.push(offDrag);
      widgetHandle = {
        moveTo: (x, y) => handle.moveTo?.(x, y),
        getPosition: () => handle.getPosition?.() ?? { ...DEFAULT_WIDGET_POS },
        destroy: () => handle.destroy()
      };
      disposers.push(() => widgetHandle?.destroy());
      const saved = savedWidgetPos;
      if (saved)
        widgetHandle.moveTo(saved.x, saved.y);
    } catch (error) {
      console.warn(`${logPrefix} float widget unavailable (grant the ui_panels permission to enable the book icon):`, error);
      widgetHandle = null;
      widgetRefs = null;
    }
  };
  attachWidget();
  disposers.push(() => {
    widgetHandle = null;
    widgetRefs = null;
  });
  const resetWidgetPosition = async () => {
    savedWidgetPos = null;
    await persistSetting("widget:pos", null);
    if (widgetHandle)
      widgetHandle.moveTo(DEFAULT_WIDGET_POS.x, DEFAULT_WIDGET_POS.y);
  };
  const updateBadge = (count) => {
    try {
      tab.setBadge(count > 0 ? String(count) : null);
    } catch {}
    setWidgetCount(widgetRefs, count);
  };
  const renderAll = () => {
    panel.render(latestSnapshot, settings, role);
    updateBadge(latestSnapshot?.entries.length ?? 0);
    panel.setStatus(latestSnapshot ? `Last update: ${new Date(latestSnapshot.ts).toLocaleTimeString()} • ${latestSnapshot.entries.length} entries` : "Waiting for the first generation…");
  };
  disposers.push(ctx.events.on("WORLD_INFO_ACTIVATED", (payload) => {
    const { chatId, entries, stats } = normalizePayload(payload);
    const snapshot = {
      ts: Date.now(),
      chatId,
      entries,
      stats
    };
    if (chatId && chatId !== activeChatId) {
      appendHistory(snapshot, chatId);
      return;
    }
    latestSnapshot = snapshot;
    if (entries.length > 0) {
      history = [...history, snapshot].slice(-50);
      if (chatId)
        appendHistory(snapshot, chatId);
    }
    renderAll();
  }));
  const switchChat = async (chatId) => {
    activeChatId = chatId;
    latestSnapshot = null;
    history = [];
    if (chatId)
      await loadHistory(chatId);
    renderAll();
  };
  disposers.push(ctx.events.on("CHAT_SWITCHED", (payload) => {
    const chatId = typeof payload === "object" && payload !== null && "chatId" in payload ? payload.chatId : null;
    switchChat(typeof chatId === "string" ? chatId : null);
  }));
  disposers.push(ctx.events.on("CHAT_CHANGED", (payload) => {
    const chatId = typeof payload === "object" && payload !== null && "chatId" in payload ? payload.chatId : null;
    if (typeof chatId === "string" && chatId !== activeChatId)
      switchChat(chatId);
  }));
  let openModals = 0;
  const trackModal = (modal) => {
    openModals += 1;
    modal.onDismiss?.(() => {
      openModals = Math.max(0, openModals - 1);
    });
  };
  const openReport = async () => {
    if (openModals >= 2)
      return;
    try {
      const modal = ctx.ui.showModal({ title: "World Info Report", width: 640, maxHeight: 640 });
      trackModal(modal);
      const content = buildReportContent(doc, history.length > 0 ? history : latestSnapshot ? [latestSnapshot] : [], settings, role, settings.includeHistory);
      const footer = doc.createElement("div");
      footer.setAttribute("data-lwi-root", "");
      footer.style.display = "flex";
      footer.style.gap = "8px";
      footer.style.marginTop = "12px";
      const toggle = doc.createElement("button");
      toggle.type = "button";
      toggle.className = "lwi-btn";
      toggle.textContent = settings.includeHistory ? "Scope: all captured generations" : "Scope: latest generation only";
      toggle.addEventListener("click", () => {
        settings.includeHistory = !settings.includeHistory;
        persistSetting("report:history", settings.includeHistory);
        modal.dismiss();
        openModals = Math.max(0, openModals - 1);
        openReport();
      });
      footer.append(toggle);
      modal.root.appendChild(content);
      modal.root.appendChild(footer);
    } catch (error) {
      console.warn(`${logPrefix} report modal unavailable:`, error);
    }
  };
  const openTriggered = () => {
    (async () => {
      if (openModals >= 2)
        return;
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
          const list = doc.createElement("ul");
          for (const entry of entries) {
            const li = doc.createElement("li");
            li.textContent = `${entry.book}:${entry.id} — ${entry.title}`;
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
  const removeStyle = ctx.dom.addStyle(PANEL_CSS);
  disposers.push(removeStyle);
  (async () => {
    role = await requestRole();
    if (activeChatId)
      await loadHistory(activeChatId);
    renderAll();
  })();
  renderAll();
  const teardown = () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
    widgetHandle = null;
    widgetRefs = null;
    console.info(`${logPrefix} torn down cleanly`);
  };
  ctx.onTeardown?.(teardown);
  return teardown;
}
export {
  setup
};
