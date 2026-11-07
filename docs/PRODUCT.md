# Product Intent & Feature Map (`PRODUCT.md`)
> **1-Line Summary:** The permanent source of truth for what Note Toolbox does for the user, independent of how the code is implemented.

## 1. Core Vision & User Experience Intent
* **What This App Does (Plain English):** Turns Obsidian's attachment folders into a visual asset library. It browses images, video, audio, and documents in a fast grid or table, shows which files are unused, and performs batch renames, moves, and trashes without breaking links. It also renders `?[listname]` tokens as live dropdowns inside notes and exposes a picker API that other plugins can call.
* **How It Must Feel to Use:** Opening the toolbox is instant even in vaults with thousands of assets. Thumbnails never crop or distort, scrolling never stutters, the three toolbar tiers stay on screen, and every destructive action asks first and reports how many files changed.

## 2. Active Features (Do Not Break)

### [FEATURE: Three-Tier-Media-Browser] | Aliases: media toolbox, asset browser, modal, toolbar
> **1-Line Summary:** A modal asset browser split into navigation, filtering, and action rows so controls never wrap or collide.
* **User Intention (Non-Negotiable):** Every control needed to find and act on an asset must remain visible without horizontal scrolling or pushing the action bar off-screen.
* **Visual / UI Behavior:** Tier 1 holds category pills, search, and reset. Tier 2 holds folder, extension, usage, and sort selects plus exclusion controls. Tier 3 holds All/None/Invert and Insert, Move, Sequence, Rename, Trash.
* **Code Anchors (Grep Targets):**
  * `src/media-toolbox.ts` -> `MediaToolboxModal.render`
  * `src/media-toolbox.ts` -> `MediaToolboxModal.updateExtensionOptions`

### [FEATURE: Configurable-Grid-Gallery] | Aliases: grid view, thumbnails, rows, columns, gallery
> **1-Line Summary:** A thumbnail grid whose visible row count and column count are user-controlled and saved instantly.
* **User Intention (Non-Negotiable):** The whole image must be visible inside each tile (letterboxed if needed), never cropped or stretched, and the chosen geometry must survive reopening the modal and restarting Obsidian.
* **Visual / UI Behavior:** Rows 2–6 and columns 2–8 selectors in the top bar and in settings; a live `ResizeObserver` recalculates row height; the default view mode is remembered.
* **Code Anchors (Grep Targets):**
  * `src/media-toolbox.ts` -> `MediaToolboxModal.applyGalleryLayout`, `MediaToolboxModal.renderGridView`
  * `src/settings-tab.ts` -> `NoteToolboxSettingTab.display`
  * `src/media-toolbox.ts` -> `MediaToolboxModal.render` (`nt-gallery-rows-changed` listener)

### [FEATURE: Sortable-List-View] | Aliases: list view, table, columns, sort headers
> **1-Line Summary:** A dense table with clickable sort headers, mini thumbnails, detail tags, and hover row actions.
* **User Intention (Non-Negotiable):** Clicking Name, Type, Size, or Date must toggle direction and keep the toolbar’s sort select in sync.
* **Visual / UI Behavior:** Sticky header row, image thumbnails or type icons, name plus clickable path, dimensions/duration, size, modified date, and per-row insert, preview, copy, trash buttons.
* **Code Anchors (Grep Targets):**
  * `src/media-toolbox.ts` -> `MediaToolboxModal.renderListView`, `MediaToolboxModal.buildListRow`

### [FEATURE: Quick-Look-Lightbox] | Aliases: preview, lightbox, full size, quick look
> **1-Line Summary:** Opens one asset in a bounded lightbox that shows the entire image, plays media, and offers a single attach action.
* **User Intention (Non-Negotiable):** Tall or wide images must be fully visible with centered letterboxing; the modal must never clip its header or footer.
* **Visual / UI Behavior:** Header with filename and close button; image/video/audio/document preview area; footer with extension, dimensions or duration, size, and Insert/Choose.
* **Code Anchors (Grep Targets):**
  * `src/quick-look.ts` -> `QuickLookModal.onOpen`
  * `src/media-toolbox.ts` -> `MediaToolboxModal.openQuickLook`

### [FEATURE: Category-And-Text-Filtering] | Aliases: images, videos, audio, documents, search
> **1-Line Summary:** Filters assets by media category, filename or path substring, folder, and extension.
* **User Intention (Non-Negotiable):** Typing in search must debounce, resetting filters must restore every default at once, and the extension list must only show extensions present in the current category.
* **Visual / UI Behavior:** Category chips (All/Images/Videos/Audio/Documents), 160 ms debounced search, folder select, extension select with counts, reset icon button.
* **Code Anchors (Grep Targets):**
  * `src/media.ts` -> `MediaService.getValidFiles`
  * `src/media-toolbox.ts` -> `MediaToolboxModal.render`, `MediaToolboxModal.updateExtensionOptions`

### [FEATURE: Orphan-And-Linked-Detection] | Aliases: unused, orphans, in use, linked assets, link graph
> **1-Line Summary:** Marks assets referenced by any note and filters to only unused or only linked files.
* **User Intention (Non-Negotiable):** The link graph must be cached briefly and invalidated on metadata, rename, and delete events, or every keystroke would rescan the whole vault.
* **Visual / UI Behavior:** Usage select with All Assets, Unused / Orphans, In Use (Linked); counts update in the header badge.
* **Code Anchors (Grep Targets):**
  * `src/media.ts` -> `MediaService.getLinkedFilePaths`, `MediaService.clearLinkedCache`
  * `src/main.ts` -> `NoteToolboxPlugin.onload` (metadata/vault event wiring)

### [FEATURE: Multi-Select-And-Range-Selection] | Aliases: select all, invert, shift click, keyboard
> **1-Line Summary:** Supports click, Shift-click ranges, All/None/Invert, arrow-key focus, and Enter/Space actions across grid and list.
* **User Intention (Non-Negotiable):** Selection lookups must be O(1) by path; clicking or dragging in a 10,000-file vault must not freeze the UI.
* **Visual / UI Behavior:** Check badge on cards, `is-selected` outline, header badge “N assets • M selected”, range fill on Shift-click, Space opens Quick Look, Enter inserts or chooses.
* **Code Anchors (Grep Targets):**
  * `src/media-toolbox.ts` -> `MediaToolboxModal.handleCardClick`, `MediaToolboxModal.getSelectedFiles`, `MediaToolboxModal.updateSelectionVisuals`

### [FEATURE: Drag-And-Drop-Asset-Links] | Aliases: drag, drop, wikilink, uri-list, canvas
> **1-Line Summary:** Dragging a card exports Markdown embeds for notes and a resource URL for Canvas or Excalidraw.
* **User Intention (Non-Negotiable):** Dragging a selected card must drag the whole selection, and the text payload must be valid Markdown.
* **Visual / UI Behavior:** Native drag ghost; `text/plain` receives one embed per line; `text/uri-list` receives the active file's resource URL.
* **Code Anchors (Grep Targets):**
  * `src/media-toolbox.ts` -> `MediaToolboxModal.buildCard` (`dragstart`)

### [FEATURE: Collision-Safe-Batch-Rename] | Aliases: sequence rename, tokens, pattern, batch
> **1-Line Summary:** Renames many files from a token pattern while appending numeric suffixes instead of overwriting.
* **User Intention (Non-Negotiable):** Existing files must never be silently replaced, and links in notes must update through Obsidian's file manager.
* **Visual / UI Behavior:** Sequence button opens a prompt with `{folder}`, `{n}`, `{name}` tokens; success notice reports how many files were renamed.
* **Code Anchors (Grep Targets):**
  * `src/media.ts` -> `MediaService.batchRename`
  * `src/media-toolbox.ts` -> `MediaToolboxModal.handleBatchRename`

### [FEATURE: Collision-Safe-Move-And-Trash] | Aliases: move, relocate, delete, trash, recycle
> **1-Line Summary:** Moves or trashes selected assets with per-file error isolation and accurate result counts.
* **User Intention (Non-Negotiable):** One locked or missing file must not abort the rest of the batch; trashing must use Obsidian's trash so links and recovery behave normally.
* **Visual / UI Behavior:** Move opens a folder select; Trash opens a confirmation naming the file or count; notices report moved/trashed counts.
* **Code Anchors (Grep Targets):**
  * `src/media.ts` -> `MediaService.moveFiles`
  * `src/media-toolbox.ts` -> `MediaToolboxModal.handleMoveSelected`, `MediaToolboxModal.handleTrashSelected`

### [FEATURE: Right-Click-Asset-Actions] | Aliases: context menu, exclude, rename, explorer
> **1-Line Summary:** A context menu exposes insert, preview, copy link, folder/extension exclusion, system actions, rename, and trash.
* **User Intention (Non-Negotiable):** Excluding a folder or extension from the menu must immediately remove matching assets from the browser.
* **Visual / UI Behavior:** Native Obsidian menu at the pointer; folder and extension exclusion shortcuts, browse selectors, Show in System Explorer, Open with Default App.
* **Code Anchors (Grep Targets):**
  * `src/media-toolbox.ts` -> `MediaToolboxModal.showContextMenu`

### [FEATURE: Folder-Exclusion-Manager] | Aliases: exclude folders, folder picker, hide directory
> **1-Line Summary:** A searchable folder list with Select All, Clear All, and Invert that persists excluded directories.
* **User Intention (Non-Negotiable):** Checking a parent folder must hide everything beneath it; unchecking must restore it without a restart.
* **Visual / UI Behavior:** Folder rows with checkbox, folder/folder-x icons, live selected badge, Apply Exclusions footer; chips in settings mirror the same list.
* **Code Anchors (Grep Targets):**
  * `src/exclusions.ts` -> `FolderSelectorModal.renderList`, `FolderSelectorModal.getFilteredFolders`
  * `src/settings-tab.ts` -> `NoteToolboxSettingTab.display` (`renderFolderChips`)

### [FEATURE: Extension-Exclusion-Manager] | Aliases: exclude extensions, file types, hide ext
> **1-Line Summary:** A searchable extension list with vault counts, category tabs, and Select All, Clear All, Invert.
* **User Intention (Non-Negotiable):** Extensions already present in the vault and known media formats must both appear, and counts must reflect the vault.
* **Visual / UI Behavior:** Category chips, extension badges (`.PNG`), category label, “N in vault” count, selected row styling, Apply Exclusions footer.
* **Code Anchors (Grep Targets):**
  * `src/exclusions.ts` -> `ExtensionSelectorModal.onOpen`, `ExtensionSelectorModal.renderList`
  * `src/fuzzy.ts` -> `EXTENSIONS`, `getCategory`

### [FEATURE: Inline-Dropdowns] | Aliases: dropdown, frontmatter property, inline select, form
> **1-Line Summary:** Renders `?[list]` as a live select bound to frontmatter and `?[list|value]` as a self-contained inline select.
* **User Intention (Non-Negotiable):** Writes must go through `processFrontMatter` for property-bound dropdowns, never regex-edited YAML.
* **Visual / UI Behavior:** “Choose...” placeholder, active value preselected, `nt-inline-select` styling, notice confirming the new value; code blocks and preformatted text are skipped.
* **Code Anchors (Grep Targets):**
  * `src/dropdown.ts` -> `InlineDropdownProcessor.process`, `InlineDropdownProcessor.handleChange`
  * `src/main.ts` -> `NoteToolboxPlugin.onload` (post-processor registration)

### [FEATURE: Dropdown-List-Manager] | Aliases: manage dropdowns, options editor, list builder
> **1-Line Summary:** Creates, renames, reorders, and deletes dropdown lists and options without editing JSON.
* **User Intention (Non-Negotiable):** Every edit saves immediately, and deleting a list must warn that existing notes are not rewritten.
* **Visual / UI Behavior:** List chips with counts, New Dropdown field, rename input, copy-token badge, Delete List, All/None/Invert, multi-delete, add comma-separated options, up/down/remove per row.
* **Code Anchors (Grep Targets):**
  * `src/dropdown-manager.ts` -> `DropdownManagerUI.render`, `DropdownManagerUI.saveAndRefresh`
  * `src/dropdown-manager-modal.ts` -> `DropdownManagerModal.onOpen`

### [FEATURE: Inter-Plugin-Chooser-API] | Aliases: openPicker, pickFile, pickAsset, Practice Engine
> **1-Line Summary:** Exposes callback and Promise pickers so other plugins can request images, video, audio, documents, or any asset.
* **User Intention (Non-Negotiable):** Existing `open*Picker(callback, options)` signatures and the `(file, path, payload)` argument order must never change; cancelling resolves `null`.
* **Visual / UI Behavior:** The same toolbox modal with an optional locked category, custom title, multi-select, extension allow/deny lists, and Choose instead of Insert.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `NoteToolboxPlugin.openPicker`, `openImagePicker`, `pickFile`, `pickAsset`, `createAssetPayload`
  * `src/media-toolbox.ts` -> `MediaToolboxModal.resolvePicker`

### [FEATURE: Canvas-And-Excalidraw-Insertion] | Aliases: canvas, excalidraw, whiteboard, overlay button
> **1-Line Summary:** Inserts assets directly into Canvas or Excalidraw, with a floating overlay button on those views.
* **User Intention (Non-Negotiable):** Canvas uses `createFileNode`; Excalidraw uses its public `ea` API and must fail gracefully when the plugin is absent.
* **Visual / UI Behavior:** Floating grid icon in the canvas/excalidraw container; cascade offset for multi-insert; success notice; Markdown notes receive an embed at the cursor.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `NoteToolboxPlugin.injectOverlayButtons`
  * `src/media-toolbox.ts` -> `MediaToolboxModal.insertTargetFile`, `MediaToolboxModal.handleInsertSelected`

### [FEATURE: Settings-And-Removable-Chips] | Aliases: settings tab, chips, defaults, aliases
> **1-Line Summary:** A native settings tab for view defaults, gallery geometry, glassmorphism, command aliases, scanned folders, and exclusion chips.
* **User Intention (Non-Negotiable):** Manual comma-separated text and visual chips must stay in sync both ways.
* **Visual / UI Behavior:** Dropdowns, toggles, text fields, textareas, Select Folders/Extensions buttons, removable `✕` chips, and the embedded dropdown manager.
* **Code Anchors (Grep Targets):**
  * `src/settings-tab.ts` -> `NoteToolboxSettingTab.display`
  * `src/settings.ts` -> `DEFAULT_SETTINGS`
