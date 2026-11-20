# Project Operating Instructions (`AGENTS.md`)
> **Notice:** This project inherits user persona, confirmation gates, visual standards, and documentation blueprints from the global master `AGENTS.md`. Do not duplicate those rules here.

## 1. Project Tech Stack & Environment
* **Runtime / Language:** Node.js 18+, TypeScript 5.8 (`strict` + `noUncheckedIndexedAccess`).
* **Framework / Host:** Obsidian plugin API, `minAppVersion` 1.7.0, desktop and mobile (`isDesktopOnly: false`).
* **Build Output:** `main.js` (CommonJS bundle) at the repository root, shipped with `manifest.json` and `styles.css`.
* **Package Manager / Bundler:** npm + esbuild (`esbuild.config.mjs`, entry `src/main.ts`).

## 2. Mandatory Verification & Build Commands
* **Type Check:** `npx tsc -noEmit -skipLibCheck`
* **Lint:** `npm run lint`
* **Build:** `npm run build`
* **Watch / Dev:** `npm run dev`

## 3. Repository Directory Structure & Conventions
* `src/` — modular TypeScript source; one responsibility per file:
  * `main.ts` — plugin lifecycle, commands, overlays, public chooser API.
  * `media.ts` — `MediaService`: filtering, link graph, metadata decoding, batch rename/move.
  * `media-toolbox.ts` — `MediaToolboxModal`: 3-tier browser, grid/list, selection, insertion.
  * `quick-look.ts` — `QuickLookModal` lightbox.
  * `exclusions.ts` — `FolderSelectorModal`, `ExtensionSelectorModal`.
  * `dropdown.ts` — `InlineDropdownProcessor` for `?[list]` / `?[list|value]`.
  * `dropdown-manager.ts` / `dropdown-manager-modal.ts` — list and option editor.
  * `modals.ts` — confirm, input prompt, folder select, and the file-view dialogs.
  * `settings-tab.ts` — native settings tab with chips and synced textareas.
  * `settings.ts` / `types.ts` — defaults and shared contracts.
  * `fuzzy.ts` — extension sets, collators, `debounce`, byte/duration formatting, category lookup.
  * `async.ts` — `voidAsync` wrapper for async DOM listeners.
* `docs/` — Core Markdown documentation suite (`PRODUCT.md`, `ARCHITECTURE.md`, `DECISIONS_AND_TRAPS.md`, `VISUAL_LOG.md`).
* `preview/` — On-demand interactive HTML/CSS/JS visual previews (e.g., `preview/visual-guide.html`), created only upon explicit request.
* `main.js` at the root is a generated build artifact; edit `src/` instead.

## 4. Critical Trap Pointers (1-Line Warnings Only)
* **TRAP 1:** Keep file lookups O(1) via `app.vault.getAbstractFileByPath` rather than scanning arrays — see `docs/DECISIONS_AND_TRAPS.md` -> `[DECISION: O1-Selection-Lookups]`.
* **TRAP 2:** Update frontmatter properties atomically via `app.fileManager.processFrontMatter` — see `docs/DECISIONS_AND_TRAPS.md` -> `[DECISION: Atomic-Frontmatter-Updates]`.
* **TRAP 3:** Preserve persisted `data.json` keys (`dropdownLists`, etc.) with migrations rather than reshaping defaults — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Data-Json-Key-Shape]`.
* **TRAP 4:** Remove `ResizeObserver` and window event listeners in `MediaToolboxModal.onClose` — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Async-DOM-Listeners]`.
* **TRAP 5:** Preserve the public picker API contract `(chosen, path, payload)` for inter-plugin callers — see `docs/DECISIONS_AND_TRAPS.md` -> `[SUBSYSTEM: Picker-API-Compatibility]`.
