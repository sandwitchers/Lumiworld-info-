# Lumiworld Info — World Info activation inspector for Lumiverse

A Lumiverse **Spindle** extension that shows which World Info (lorebook) entries were
activated for each generation: a live entry list, a draggable book widget with an
activation-count badge, click-to-read entry contents, and a keyword trigger report
with recursion-pass forensics.

> **v1.1.1** — fixed **entry content not loading** ("worldBooks API missing"):
> Lumiverse 1.1.x serves `worldBooks.entries(bookId)` as a plain-array function
> call, not the `entries.list(bookId)` object the previous build expected. The
> lookup now speaks **both shapes** (and both list envelopes), verified by a
> runtime simulation. Plus, from v1.1.0: fixed the cut-off widget icon/badge on
> mobile and added the **click an entry → read its content** QOL feature.

This is a native Lumiverse port of the SillyTavern extension
**[WorldInfo Info](https://github.com/aikohanasaki/SillyTavern-WorldInfoInfo)**
by aikohanasaki, itself a fork of the original by [LenAnderson](https://github.com/LenAnderson/SillyTavern-WorldInfoInfo).
Licensed under **AGPL-3.0** (see [LICENSE](./LICENSE)).

## What it does

- **Drawer tab "WI Info"** — lists every World Info entry the last generation
  activated, grouped by book or in activation order, with origin dots
  (constant / keyword / vector / sticky), matched keys, token estimates, and scores.
- **Click an entry → read its content** — tapping any entry (in the tab or in the
  *Triggered* list) opens a detail modal with the entry's full text, plus its
  book, keys, origin, and activation metadata. Content is fetched on demand from
  the host's world-book API (free tier) — the activation event itself stays
  content-free. Includes a *Copy content* button. Entries from hidden books stay
  masked for non-privileged roles. The lookup is dual-shape: it works on hosts
  exposing `worldBooks.entries(bookId)` (plain array) as well as hosts exposing
  `worldBooks.entries.list(bookId)` (`{ data }` envelope).
- **Floating book icon** — a small draggable widget with a live activation-count
  badge; click it to jump to the tab. Its position persists across reloads, and
  the tab's *Reset icon* button (or the `wi-position-reset` command) restores the
  default corner.
- **Keyword Report** — the port of `/wi-report`: a modal with a keyword-frequency
  table (which keywords triggered which entries), a per-recursion-pass breakdown,
  and the host's activation stats (keyword vs vector counts, recursion passes,
  estimated tokens). Toggle the scope between the latest generation and all
  captured generations of the current chat.
- **Command palette commands** — `WI Info: Keyword Report`, `WI Info: Show
  Triggered Entries`, `WI Info: Reset Book Icon Position` (open the palette with
  Ctrl/Cmd+K).
- **Hidden-book privacy** — configure comma-separated book-name prefixes
  ("Hidden books…" chip in the tab); books matching them are masked as
  *(hidden entries)* for non-operator/admin users. Operator and admin roles see
  everything.
- **Per-chat history** — the last 20 generations' activation snapshots are stored
  per chat (chat-scope variable, free tier) so the report survives page reloads.

## Installation

1. In Lumiverse, open the **Spindle** panel (drawer tab `spindle`).
2. Choose **Install from GitHub** and use:
   `https://github.com/sandwitchers/Lumiworld-info-`
3. Pick the branch (`main`), confirm the permission prompt, then **Enable** the
   extension.
4. Grant the **ui_panels** permission when asked — it powers the floating book
   icon. Everything else uses free-tier APIs.

`dist/` is committed, so Lumiverse can serve the bundles without building. To
rebuild locally instead:

```bash
bun install
bun run build
# bun build src/backend.ts  --outfile dist/backend.js  --target bun
# bun build src/frontend.ts --outfile dist/frontend.js --target browser --format esm
```

## Permissions (and why)

| Permission | Why |
|---|---|
| `ui_panels` | Creates the floating book widget (`ctx.ui.createFloatWidget`). Gated tier — Lumiverse asks for an explicit grant on enable. |

No other permission is used: events, settings, the drawer tab, backend commands,
chat variables, the user-role check, and the world-book content lookup are all
free tier. Entry *content* is read only when you click an entry, through the
host's world-book REST API. The extension never writes to chats and never calls
the LLM.

## Configuration surface

- **Drawer tab toolbar** — *Group by book*, *Activation order*, *Report*,
  *Triggered*, *Reset icon*, *Hidden books…* chips/buttons.
- **Settings keys** (host-namespaced, internal): `panel:group`, `panel:order`,
  `privacy:hidden`, `report:history`, `widget:pos`.
- **Commands**: `wi-report`, `wi-triggered`, `wi-position-reset`.
- **Backend macro/tool/hooks**: none — deliberately. The extension is an
  observer, not a pipeline participant.

## Supported versions

Built against the documented current APIs (`spindle.json`, `setup(ctx)`, the
injected `spindle` global) and verified against the Lumiverse `main` branch
source as of 2026-09-08. Entry fields are read defensively; if a future Lumiverse
release reshapes the `WORLD_INFO_ACTIVATED` payload, unknown fields are ignored
and missing fields degrade gracefully. Check `spindle.version.getBackend()` if
you need to report an issue.

## Known limitations (differences from the SillyTavern original)

- **Entry content is click-to-read, not hover.** The activation event ships a
  content-free projection (ids, keys, provenance, stats) — by design. Instead of
  the original's hover tooltip with full text, this port opens a detail modal
  with the entry content fetched from the world-book API. If a book was deleted
  or renamed since the activation, the modal explains that instead of failing.
- **No message-history interleaving / Author's Note row.** The original
  interleaves chat messages between depth-ordered entries using SillyTavern's
  prompt layout; Lumiverse's activation event carries no comparable depth
  positioning, so that view was intentionally not ported.
- **Recursion passes** come from the host's `activationProvenance.activationPass`
  and `stats.recursionPassesUsed` — more reliable than the original's
  console-scraping, but the per-pass grouping only appears when the host
  provides provenance data.
- **Sticky durations** are shown as a badge when the host marks an entry
  `sticky`; the "sticky for N more rounds" countdown of the original depends on
  SillyTavern-only APIs and is not available.
- **Multi-user installs:** palette commands nudge every frontend open on
  operator-scoped installs (the invocation carries no user id). Report content is
  always assembled client-side from each user's own event stream — no data moves
  between users.

## Troubleshooting

- **No book icon?** The `ui_panels` permission was not granted — re-enable the
  extension and accept the prompt, or use `ctx.permissions.request` by clicking
  any feature and re-enabling. The drawer tab works without it.
- **Icon/badge looks cut off?** Update to v1.1.0+ — the widget now renders
  chromeless with an inset badge, so nothing overflows the host float box. Use
  the tab's *Reset icon* button if a stale saved position bothers you.
- **"worldBooks API missing" in the content modal?** Update to v1.1.1+ — earlier
  builds called a world-book API shape this host doesn't ship. The lookup now
  supports both known shapes; if your host is older than both, the modal says so
  explicitly.
- **"Entry no longer exists" in the content modal?** The entry was edited or
  removed after that generation ran — the activation list is a historical
  snapshot, content always comes from the live world book.
- **Empty panel after a generation?** Check the browser console for
  `[lumiworld_info]` errors and the server log for `[Spindle:lumiworld_info]`.
  The host emits the activation event only when a generation completes.
- **Dev loop:** there is no hot reload — rebuild (`bun run build`), update/redeploy
  the extension, restart Lumiverse to resync the manifest/permissions, then hard
  refresh the browser.
- **Report looks empty?** Run at least one generation in the active chat; the
  report reads the captured snapshots for the currently open chat.

## Development

```text
src/
├── backend.ts        # commands, role lookup, per-chat history persistence
├── frontend.ts       # setup(ctx): state, events, widget, modals, teardown
├── panel.ts          # DOM rendering: drawer tab, float widget, report modal
├── normalize.ts      # defensive payload normalization + privacy rules
└── shared/types.ts   # frontend↔backend contracts and bounds
```

- `moduleResolution: bundler`, `strict: true`, types from `lumiverse-spindle-types`.
- All UI is scoped under the extension root with `--lumiverse-*` host tokens.
- Every registration is disposed in teardown (Nine Lives Rule).

## License

AGPL-3.0 — same as the upstream SillyTavern extensions this port derives from.
Port done with credit and gratitude to LenAnderson and aikohanasaki, nyaa~ 🐾
