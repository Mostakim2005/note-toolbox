# Note Toolbox

Visual media manager, universal attachment picker, and inline dropdowns.

## This repo (faithful deep split from the live bundle)

- `src/types.ts` — `NoteToolboxSettings`, `FileCategory`
- `src/settings.ts` — `DEFAULT_SETTINGS` matching live `data.json` keys
- `src/fuzzy.ts` — helpers: `debounce`, `formatBytes`, `formatDuration`, `getCategory`
- `src/media.ts` — `MediaService` (folders, linked paths, `getValidFiles` filtering/sorting, rename/move)
- `src/dropdown.ts` — `InlineDropdownProcessor` (`?[listname]`, `?[listname|val]`, frontmatter)
- `src/main.ts` — plugin entry (onload/commands/settings lifecycle)

## Parity checklist

- [x] Entry, 2 commands, ribbon, aliases, vault events, browser events
- [ ] `MediaToolboxModal` (grid/list, categories, folder selector, search)
- [ ] `DropdownManagerUI` / `DropdownManagerModal`
- [x] Inline dropdown processor (post-processor wired)
- [x] Settings tab shell (glassmorphism, custom aliases)
- [x] `styles.css` — live glassmorphism, copied verbatim (36,649 bytes)
- [ ] Inter-plugin API: `openPicker`, `openImagePicker`, `pickFile`

## Develop

- `npm i` (Node 18+), `npm run dev`, `npm run build` → `main.js`

Manual install: copy `main.js`, `manifest.json`, `styles.css` to `<Vault>/.obsidian/plugins/note-toolbox/`.

## License

Code: PolyForm Noncommercial 1.0.0 (see `LICENSE`). Docs: CC BY-NC 4.0. Copyright © Mostakim2005. Source-available: free non-commercial use with credit, no commercial use.
