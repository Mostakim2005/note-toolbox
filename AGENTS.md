# Project Operating Instructions (`AGENTS.md`)
> **Notice:** This project inherits user persona, confirmation gates, and documentation blueprints from the global master `AGENTS.md`. Do not duplicate those rules here.

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
  * `file-service.ts` / `file-check-view.ts` — standalone multi-select view, not registered by the plugin.
* `docs/` — `PRODUCT.md`, `ARCHITECTURE.md`, `DECISIONS_AND_TRAPS.md`, `VISUAL_GUIDE.html`.
* `runtime/` — frozen plug-and-play bundle (`main.js`, `manifest.json`, `styles.css`) kept as the emergency fallback. Never regenerate into this folder.
* `main.js` at the root is a generated build artifact; edit `src/` instead.

## 4. Repository-Specific Engineering Traps
* **TRAP 1:** `runtime/` is a frozen snapshot and is not byte-identical to the newest live vault bundle. Treat `src/` as the evolution target and `runtime/` as a user-facing fallback only.
* **TRAP 2:** `data.json` keys (`dropdownLists`, `scannedFolders`, `excludedFolders`, `excludedExtensions`, `customAliases`, `defaultViewMode`, `galleryRows`, `galleryColumns`, `glassmorphism`) are user data. Renaming or reshaping one without migration silently discards existing settings.
* **TRAP 3:** Every `nt-*` class in `styles.css` is coupled to `createEl({ cls })` calls. Renaming one side without the other strips layout or selection styling.
* **TRAP 4:** `getSelectedFiles()` must stay O(1) per selection via `app.vault.getAbstractFileByPath`; switching back to `getFiles().filter(...)` freezes drag and trash on large vaults.
* **TRAP 5:** Frontmatter dropdown writes must use `app.fileManager.processFrontMatter`; regex replacement corrupts multiline YAML.
* **TRAP 6:** `MediaToolboxModal` attaches a `ResizeObserver` and a `nt-gallery-rows-changed` window listener. Both must be removed in `onClose()` or every open leaks handlers.
* **TRAP 7:** The picker API signature `(chosen, path, payload)` and the `open*Picker(callback, options)` argument order are consumed by external plugins. Do not reorder or rename.
