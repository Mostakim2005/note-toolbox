# Note Toolbox

> [!NOTE]
> **Live Plug-and-Play Runtime Available:** The `runtime/` directory contains the production-tested JavaScript bundle (`main.js`, `manifest.json`, `styles.css`) that runs in the live Obsidian vault. Copy those three files into `<Vault>/.obsidian/plugins/note-toolbox/` for immediate use. The TypeScript source in `src/` is now a full behavioral port of that bundle.

Visual media manager, universal attachment picker, and inline dropdown system for Obsidian.

## Documentation

| File | What it answers |
| --- | --- |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What the plugin must do, feature by feature, with code anchors. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Mermaid system map, subsystem mechanics, verification commands, extension recipes. |
| [`docs/DECISIONS_AND_TRAPS.md`](docs/DECISIONS_AND_TRAPS.md) | Why each non-obvious mechanism exists and what must never be changed. |
| [`docs/VISUAL_GUIDE.html`](docs/VISUAL_GUIDE.html) | Self-contained browser dashboard of intent, architecture, decisions and landmines. |
| [`AGENTS.md`](AGENTS.md) | Repository-specific build commands, layout and traps. |

## Source layout

- `src/types.ts` — `NoteToolboxSettings`, `FileCategory`, `MediaMetadata`, `AssetPayload`, `ChooserOptions`, `PickerConfig`
- `src/settings.ts` — `DEFAULT_SETTINGS` matching the live `data.json` keys
- `src/fuzzy.ts` — `EXTENSIONS`, shared collators, `debounce`, `formatBytes`, `formatDuration`, `getCategory`
- `src/media.ts` — `MediaService` (folder listing, TTL link graph, `getValidFiles`, `getFullMetadata`, batch rename/move, cache purge)
- `src/media-toolbox.ts` — `MediaToolboxModal` (3-tier toolbar, grid/list, selection, drag-and-drop, context menu, insertion routing, chooser resolution)
- `src/quick-look.ts` — `QuickLookModal`
- `src/exclusions.ts` — `FolderSelectorModal`, `ExtensionSelectorModal`
- `src/dropdown.ts` — `InlineDropdownProcessor` (`?[list]`, `?[list|value]`, frontmatter and inline writes)
- `src/dropdown-manager.ts` + `src/dropdown-manager-modal.ts` — `DropdownManagerUI`, `DropdownManagerModal`
- `src/modals.ts` — `ConfirmModal`, `InputPromptModal`, `SelectFolderModal`, plus the file-view dialogs
- `src/settings-tab.ts` — settings tab with exclusion chips, synced textareas, gallery defaults and dropdown builder
- `src/main.ts` — plugin entry, commands, aliases, ribbon, overlays, vault cache events, inter-plugin API
- `src/async.ts` — `voidAsync` for async DOM listeners
- `src/file-service.ts` + `src/file-check-view.ts` — standalone multi-select view (not registered by the plugin)

## Parity checklist

- [x] Entry, 2 commands, ribbon, command aliases, vault/metadata events, unload cleanup
- [x] `MediaToolboxModal`: 3-tier toolbar, category chips, search/reset, folder/extension/usage/sort filters
- [x] Configurable grid gallery (rows/columns, `ResizeObserver`, `nt-gallery-rows-changed`, saved default view)
- [x] Sortable list view with row hover actions and clickable folder paths
- [x] Selection engine: click, Shift range, All/None/Invert, arrow keys, Space/Enter, O(1) path lookup
- [x] Drag-and-drop Markdown embeds and `text/uri-list`
- [x] `QuickLookModal` for image, video, audio and documents
- [x] `MediaService`: TTL link graph, fast collators, 1500 ms metadata timeouts, collision-safe rename/move
- [x] Batch trash with per-file error isolation
- [x] Right-click context menu with exclusion shortcuts, system explorer, rename and trash
- [x] Folder and extension exclusion pickers with search, categories and All/None/Invert
- [x] Settings tab with removable chips and two-way synced raw textareas
- [x] `InlineDropdownProcessor` with frontmatter and inline values, `processFrontMatter` writes
- [x] `DropdownManagerUI` / `DropdownManagerModal` (lists, options, reorder, bulk delete)
- [x] Inter-plugin API: `openPicker`, `openImagePicker`, `openVideoPicker`, `openAudioPicker`, `openDocumentPicker`, `pickFile`, `pickAsset`
- [x] Canvas and Excalidraw overlay buttons plus direct insertion routing
- [x] `styles.css` — live glassmorphism copied verbatim, plus three split-build helper classes
- [x] Data compatibility: live `data.json` key shapes

## Develop

```bash
npm install
npm run dev     # esbuild watch
npm run build   # tsc --noEmit + production bundle → main.js
npm run lint
```

Manual install: copy `main.js`, `manifest.json`, `styles.css` to `<Vault>/.obsidian/plugins/note-toolbox/`.

## License

Code: PolyForm Noncommercial 1.0.0 (see `LICENSE`). Docs: CC BY-NC 4.0. Copyright © Mostakim2005. Source-available: free non-commercial use with credit, no commercial use.
