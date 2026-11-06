# Note Toolbox

Visual media manager, universal attachment picker, and inline dropdowns.

## This repo (TS scaffold from Mostakim2005 template)

- `src/types.ts` — typed settings surface from the live bundle
- `src/settings.ts` — `DEFAULT_SETTINGS` matching live `data.json` keys
- `src/main.ts` — typed plugin entry (onload/commands/settings lifecycle) ported from the bundle

## Parity checklist (next split steps)

- [ ] `MediaService` (index/cache, getCategory, linked cache)
- [ ] `MediaToolboxModal` (grid/list, categories, folder selector)
- [ ] `DropdownManagerUI` / `DropdownManagerModal`
- [ ] `InlineDropdownProcessor` (`?[listname]` post-processor)
- [ ] `NoteToolboxSettingTab` (full settings UI)
- [ ] `styles.css` — live glassmorphism, copied verbatim (36,649 bytes)
- [ ] Inter-plugin API: `openPicker`, `openImagePicker`, `pickFile`, `registerAliases`

## Develop

- `npm i` (Node 18+), `npm run dev`, `npm run build` → `main.js`

Manual install: copy `main.js`, `manifest.json`, `styles.css` to `<Vault>/.obsidian/plugins/note-toolbox/`.

## License

Code: PolyForm Noncommercial 1.0.0 (see `LICENSE`). Docs: CC BY-NC 4.0. Copyright © Mostakim2005. Source-available: free non-commercial use with credit, no commercial use.
