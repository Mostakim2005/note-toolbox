import {
	ItemView,
	Menu,
	Notice,
	TFile,
	TFolder,
	WorkspaceLeaf,
	normalizePath,
	setIcon,
	setTooltip,
} from "obsidian";
import { voidAsync } from "./async";
import { debounce } from "./fuzzy";
import type NoteToolboxPlugin from "./main";
import type { NotePreviewData } from "./note-preview-cache";
import type { NavDisplayMode, NavGroupMode, NavLayoutMode, NavSortMode } from "./types";

export const VIEW_TYPE_NOTE_NAVIGATOR = "nt-note-navigator";

type NavFilter =
	| { kind: "all" }
	| { kind: "pinned" }
	| { kind: "recent" }
	| { kind: "images" }
	| { kind: "folder"; path: string }
	| { kind: "tag"; tag: string };

interface FolderNode {
	name: string;
	path: string;
	count: number;
	children: FolderNode[];
}

function formatShortDate(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	const sameDay =
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate();
	if (sameDay) {
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
	const sameYear = d.getFullYear() === now.getFullYear();
	return d.toLocaleDateString([], sameYear
		? { month: "short", day: "numeric" }
		: { year: "numeric", month: "short", day: "numeric" });
}

function getDateGroupLabel(ts: number): string {
	const now = new Date();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const dayMs = 86_400_000;
	if (ts >= startOfToday) return "Today";
	if (ts >= startOfToday - dayMs) return "Yesterday";
	if (ts >= startOfToday - 7 * dayMs) return "Previous 7 Days";
	if (ts >= startOfToday - 30 * dayMs) return "Previous 30 Days";
	return new Date(ts).toLocaleDateString([], { year: "numeric", month: "long" });
}

export class NoteNavigatorView extends ItemView {
	private filter: NavFilter = { kind: "all" };
	private singlePaneStage: "nav" | "list" = "list";
	private searchQuery = "";
	private collapsedFolders = new Set<string>();
	private focusedIndex = -1;
	private visibleFiles: TFile[] = [];
	private renderToken = 0;

	private rootEl!: HTMLElement;
	private navPaneEl!: HTMLElement;
	private listPaneEl!: HTMLElement;
	private listBodyEl!: HTMLElement;
	private searchInputEl: HTMLInputElement | null = null;
	private countBadgeEl: HTMLElement | null = null;
	private breadcrumbEl: HTMLElement | null = null;

	private readonly debouncedRefresh = debounce(() => {
		this.renderAll();
	}, 140);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: NoteToolboxPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_NOTE_NAVIGATOR;
	}

	getDisplayText(): string {
		return "Note Navigator";
	}

	getIcon(): string {
		return "layout-panel-left";
	}

	onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("nt-nav-root-host");

		this.buildShell();
		this.renderAll();

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") this.debouncedRefresh();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") this.debouncedRefresh();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file) => {
				if (file instanceof TFile && file.extension === "md") this.debouncedRefresh();
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") this.debouncedRefresh();
			}),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.syncActiveHighlight();
			}),
		);

		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.renderToken += 1;
		this.contentEl.empty();
		return Promise.resolve();
	}

	private get layoutMode(): NavLayoutMode {
		return this.plugin.settings.navLayoutMode === "single" ? "single" : "dual";
	}

	private get displayMode(): NavDisplayMode {
		const m = this.plugin.settings.navDisplayMode;
		return m === "grid" || m === "compact" ? m : "preview";
	}

	private get sortMode(): NavSortMode {
		return this.plugin.settings.navSortMode || "mtime-desc";
	}

	private get groupMode(): NavGroupMode {
		return this.plugin.settings.navGroupMode || "date";
	}

	private isPinned(path: string): boolean {
		return (this.plugin.settings.navPinnedNotes || []).includes(path);
	}

	private async togglePin(path: string): Promise<void> {
		const current = new Set(this.plugin.settings.navPinnedNotes || []);
		if (current.has(path)) {
			current.delete(path);
		} else {
			current.add(path);
		}
		this.plugin.settings.navPinnedNotes = Array.from(current);
		await this.plugin.saveSettings();
		this.renderAll();
	}

	private isExcluded(filePath: string): boolean {
		const excluded = this.plugin.settings.excludedFolders || [];
		if (excluded.length === 0) return false;
		const lower = filePath.toLowerCase();
		return excluded.some((folder) => {
			const norm = folder.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
			return norm && (lower === norm || lower.startsWith(`${norm}/`));
		});
	}

	private getAllMarkdownNotes(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => !this.isExcluded(f.path));
	}

	private buildShell(): void {
		const host = this.contentEl;
		host.empty();

		// Top control bar
		const topBar = host.createDiv({ cls: "nt-nav-topbar" });

		const leftControls = topBar.createDiv({ cls: "nt-nav-topbar-group" });
		const paneToggleBtn = leftControls.createEl("button", {
			cls: "nt-nav-icon-btn",
			attr: { "aria-label": "Toggle dual-pane or single-pane layout" },
		});
		const syncPaneToggleIcon = () => {
			setIcon(paneToggleBtn, this.layoutMode === "dual" ? "panel-left" : "columns-2");
			setTooltip(
				paneToggleBtn,
				this.layoutMode === "dual"
					? "Switch to single-pane mode"
					: "Switch to dual-pane mode",
			);
		};
		syncPaneToggleIcon();
		paneToggleBtn.addEventListener(
			"click",
			voidAsync(async () => {
				this.plugin.settings.navLayoutMode = this.layoutMode === "dual" ? "single" : "dual";
				await this.plugin.saveSettings();
				syncPaneToggleIcon();
				this.applyLayoutClasses();
			}),
		);

		this.breadcrumbEl = leftControls.createEl("button", {
			cls: "nt-nav-breadcrumb",
			text: "All Notes",
		});
		this.breadcrumbEl.addEventListener("click", () => {
			if (this.layoutMode === "single") {
				this.singlePaneStage = this.singlePaneStage === "list" ? "nav" : "list";
				this.applyLayoutClasses();
			} else {
				this.filter = { kind: "all" };
				this.renderAll();
			}
		});

		this.countBadgeEl = leftControls.createSpan({ cls: "nt-nav-count-badge", text: "0" });

		// Right controls: Display mode switch (Grid / Preview / Compact) + New Note
		const rightControls = topBar.createDiv({ cls: "nt-nav-topbar-group" });
		const modeSwitch = rightControls.createDiv({ cls: "nt-nav-segmented" });
		const modeDefs: Array<{ id: NavDisplayMode; icon: string; label: string }> = [
			{ id: "grid", icon: "layout-grid", label: "Gallery Grid view" },
			{ id: "preview", icon: "layout-list", label: "Visual Preview list" },
			{ id: "compact", icon: "list", label: "Compact list" },
		];
		const modeBtns = new Map<NavDisplayMode, HTMLButtonElement>();
		const syncModeBtns = () => {
			for (const [id, btn] of modeBtns.entries()) {
				btn.toggleClass("is-active", this.displayMode === id);
			}
		};
		for (const def of modeDefs) {
			const b = modeSwitch.createEl("button", {
				cls: "nt-nav-seg-btn",
				attr: { "aria-label": def.label },
			});
			setIcon(b, def.icon);
			setTooltip(b, def.label);
			b.addEventListener(
				"click",
				voidAsync(async () => {
					this.plugin.settings.navDisplayMode = def.id;
					await this.plugin.saveSettings();
					syncModeBtns();
					this.renderListPane();
				}),
			);
			modeBtns.set(def.id, b);
		}
		syncModeBtns();

		const newNoteBtn = rightControls.createEl("button", {
			cls: "nt-nav-icon-btn nt-nav-accent-btn",
			attr: { "aria-label": "Create new note in current folder" },
		});
		setIcon(newNoteBtn, "file-plus");
		setTooltip(newNoteBtn, "Create new note in active folder");
		newNoteBtn.addEventListener(
			"click",
			voidAsync(async () => {
				await this.createNoteInCurrentScope();
			}),
		);

		// Main split body
		this.rootEl = host.createDiv({ cls: "nt-nav-split" });
		this.navPaneEl = this.rootEl.createDiv({ cls: "nt-nav-pane-left" });
		this.listPaneEl = this.rootEl.createDiv({ cls: "nt-nav-pane-right" });

		// Filter / Sort / Group toolbar inside right pane
		const listToolbar = this.listPaneEl.createDiv({ cls: "nt-nav-list-toolbar" });
		const searchWrap = listToolbar.createDiv({ cls: "nt-nav-search-wrap" });
		setIcon(searchWrap.createSpan({ cls: "nt-nav-search-icon" }), "search");
		this.searchInputEl = searchWrap.createEl("input", {
			type: "search",
			cls: "nt-nav-search-input",
			placeholder: "Filter title, excerpt, or #tag…",
		});
		this.searchInputEl.addEventListener("input", () => {
			this.searchQuery = this.searchInputEl?.value ?? "";
			this.focusedIndex = -1;
			this.debouncedRefresh();
		});

		const selectWrap = listToolbar.createDiv({ cls: "nt-nav-select-wrap" });

		const sortSel = selectWrap.createEl("select", { cls: "dropdown nt-nav-select" });
		const sortOpts: Array<[NavSortMode, string]> = [
			["mtime-desc", "Modified ↓"],
			["mtime-asc", "Modified ↑"],
			["ctime-desc", "Created ↓"],
			["name-asc", "Title A–Z"],
			["name-desc", "Title Z–A"],
		];
		for (const [val, text] of sortOpts) {
			const opt = sortSel.createEl("option", { value: val, text });
			opt.selected = this.sortMode === val;
		}
		sortSel.addEventListener(
			"change",
			voidAsync(async () => {
				this.plugin.settings.navSortMode = sortSel.value as NavSortMode;
				await this.plugin.saveSettings();
				this.renderListPane();
			}),
		);

		const groupSel = selectWrap.createEl("select", { cls: "dropdown nt-nav-select" });
		const groupOpts: Array<[NavGroupMode, string]> = [
			["date", "Group: Date"],
			["folder", "Group: Folder"],
			["none", "No Grouping"],
		];
		for (const [val, text] of groupOpts) {
			const opt = groupSel.createEl("option", { value: val, text });
			opt.selected = this.groupMode === val;
		}
		groupSel.addEventListener(
			"change",
			voidAsync(async () => {
				this.plugin.settings.navGroupMode = groupSel.value as NavGroupMode;
				await this.plugin.saveSettings();
				this.renderListPane();
			}),
		);

		this.listBodyEl = this.listPaneEl.createDiv({
			cls: "nt-nav-list-body",
			attr: { tabindex: "0" },
		});
		this.listBodyEl.addEventListener("keydown", (e) => this.handleListKeydown(e));

		this.applyLayoutClasses();
	}

	private applyLayoutClasses(): void {
		const isSingle = this.layoutMode === "single";
		this.rootEl.toggleClass("is-single-pane", isSingle);
		this.rootEl.toggleClass("is-dual-pane", !isSingle);
		this.rootEl.toggleClass("stage-nav", isSingle && this.singlePaneStage === "nav");
		this.rootEl.toggleClass("stage-list", isSingle && this.singlePaneStage === "list");
	}

	private updateBreadcrumb(count: number): void {
		if (!this.breadcrumbEl || !this.countBadgeEl) return;
		let label = "All Notes";
		if (this.filter.kind === "pinned") label = "Pinned Notes";
		else if (this.filter.kind === "recent") label = "Recent (7 Days)";
		else if (this.filter.kind === "images") label = "Notes with Images";
		else if (this.filter.kind === "folder") label = this.filter.path || "Vault Root";
		else if (this.filter.kind === "tag") label = `#${this.filter.tag}`;

		const prefix = this.layoutMode === "single"
			? this.singlePaneStage === "list"
				? "☰ "
				: "← "
			: "";
		this.breadcrumbEl.setText(`${prefix}${label}`);
		this.countBadgeEl.setText(String(count));
	}

	private selectFilter(next: NavFilter): void {
		this.filter = next;
		this.focusedIndex = -1;
		if (this.layoutMode === "single") {
			this.singlePaneStage = "list";
			this.applyLayoutClasses();
		}
		this.renderAll();
	}

	private renderAll(): void {
		this.renderNavPane();
		this.renderListPane();
	}

	private buildFolderTree(notes: TFile[]): FolderNode[] {
		const countByFolder = new Map<string, number>();
		for (const file of notes) {
			let cur = file.parent;
			while (cur && cur.path !== "/") {
				countByFolder.set(cur.path, (countByFolder.get(cur.path) ?? 0) + 1);
				cur = cur.parent;
			}
		}

		const build = (folder: TFolder): FolderNode[] => {
			const nodes: FolderNode[] = [];
			for (const child of folder.children) {
				if (!(child instanceof TFolder)) continue;
				if (this.isExcluded(child.path)) continue;
				const count = countByFolder.get(child.path) ?? 0;
				const sub = build(child);
				if (count > 0 || sub.length > 0) {
					nodes.push({ name: child.name, path: child.path, count, children: sub });
				}
			}
			nodes.sort((a, b) => a.name.localeCompare(b.name));
			return nodes;
		};

		return build(this.app.vault.getRoot());
	}

	private renderNavPane(): void {
		this.navPaneEl.empty();
		const notes = this.getAllMarkdownNotes();
		const now = Date.now();
		const sevenDaysAgo = now - 7 * 86_400_000;

		let pinnedCount = 0;
		let recentCount = 0;
		let imageNoteCount = 0;
		const tagCounts = new Map<string, number>();

		for (const f of notes) {
			if (this.isPinned(f.path)) pinnedCount += 1;
			if (f.stat.mtime >= sevenDaysAgo) recentCount += 1;
			const meta = this.plugin.notePreviewCache.getQuickMetadata(f);
			if (meta.images.length > 0) imageNoteCount += 1;
			for (const tag of meta.tags) {
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}

		// Section 1: Smart Shortcuts
		const shortcutSec = this.navPaneEl.createDiv({ cls: "nt-nav-section" });
		shortcutSec.createDiv({ cls: "nt-nav-section-title", text: "Shortcuts" });
		const shortcuts: Array<{ filter: NavFilter; icon: string; label: string; count: number }> = [
			{ filter: { kind: "all" }, icon: "files", label: "All Notes", count: notes.length },
			{ filter: { kind: "pinned" }, icon: "pin", label: "Pinned", count: pinnedCount },
			{ filter: { kind: "recent" }, icon: "clock", label: "Recent (7d)", count: recentCount },
			{ filter: { kind: "images" }, icon: "image", label: "With Images", count: imageNoteCount },
		];
		for (const sc of shortcuts) {
			const active = this.filter.kind === sc.filter.kind;
			const item = shortcutSec.createDiv({
				cls: `nt-nav-tree-item ${active ? "is-active" : ""}`,
			});
			setIcon(item.createSpan({ cls: "nt-nav-tree-icon" }), sc.icon);
			item.createSpan({ cls: "nt-nav-tree-label", text: sc.label });
			item.createSpan({ cls: "nt-nav-tree-count", text: String(sc.count) });
			item.addEventListener("click", () => this.selectFilter(sc.filter));
		}

		// Section 2: Folders
		const folderSec = this.navPaneEl.createDiv({ cls: "nt-nav-section" });
		folderSec.createDiv({ cls: "nt-nav-section-title", text: "Folders" });
		const tree = this.buildFolderTree(notes);
		const renderFolderNodes = (nodes: FolderNode[], depth: number) => {
			for (const node of nodes) {
				const isActive = this.filter.kind === "folder" && this.filter.path === node.path;
				const hasChildren = node.children.length > 0;
				const collapsed = this.collapsedFolders.has(node.path);

				const row = folderSec.createDiv({
					cls: `nt-nav-tree-item ${isActive ? "is-active" : ""}`,
				});
				row.setCssProps({ "--nt-depth": String(depth) });

				const twisty = row.createSpan({ cls: "nt-nav-twisty" });
				if (hasChildren) {
					setIcon(twisty, collapsed ? "chevron-right" : "chevron-down");
					twisty.addEventListener("click", (ev) => {
						ev.stopPropagation();
						if (collapsed) this.collapsedFolders.delete(node.path);
						else this.collapsedFolders.add(node.path);
						this.renderNavPane();
					});
				}

				setIcon(row.createSpan({ cls: "nt-nav-tree-icon" }), collapsed ? "folder" : "folder-open");
				row.createSpan({ cls: "nt-nav-tree-label", text: node.name });
				row.createSpan({ cls: "nt-nav-tree-count", text: String(node.count) });
				row.addEventListener("click", () =>
					this.selectFilter({ kind: "folder", path: node.path }),
				);

				if (hasChildren && !collapsed) {
					renderFolderNodes(node.children, depth + 1);
				}
			}
		};
		if (tree.length === 0) {
			folderSec.createDiv({ cls: "nt-nav-empty-mini", text: "No subfolders" });
		} else {
			renderFolderNodes(tree, 0);
		}

		// Section 3: Tags
		if (tagCounts.size > 0) {
			const tagSec = this.navPaneEl.createDiv({ cls: "nt-nav-section" });
			tagSec.createDiv({ cls: "nt-nav-section-title", text: "Tags" });
			const sortedTags = Array.from(tagCounts.entries()).sort(
				(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
			);
			for (const [tag, count] of sortedTags.slice(0, 60)) {
				const isActive = this.filter.kind === "tag" && this.filter.tag === tag;
				const row = tagSec.createDiv({
					cls: `nt-nav-tree-item ${isActive ? "is-active" : ""}`,
				});
				setIcon(row.createSpan({ cls: "nt-nav-tree-icon" }), "hash");
				row.createSpan({ cls: "nt-nav-tree-label", text: tag });
				row.createSpan({ cls: "nt-nav-tree-count", text: String(count) });
				row.addEventListener("click", () => this.selectFilter({ kind: "tag", tag }));
			}
		}
	}

	private getFilteredAndSortedNotes(): TFile[] {
		const notes = this.getAllMarkdownNotes();
		const q = this.searchQuery.trim().toLowerCase();
		const sevenDaysAgo = Date.now() - 7 * 86_400_000;

		const filtered = notes.filter((file) => {
			const quick = this.plugin.notePreviewCache.getQuickMetadata(file);

			if (this.filter.kind === "pinned" && !this.isPinned(file.path)) return false;
			if (this.filter.kind === "recent" && file.stat.mtime < sevenDaysAgo) return false;
			if (this.filter.kind === "images" && quick.images.length === 0) return false;
			if (this.filter.kind === "folder") {
				const prefix = `${this.filter.path}/`;
				if (!(file.path === this.filter.path || file.path.startsWith(prefix))) return false;
			}
			if (this.filter.kind === "tag") {
				const target = this.filter.tag.toLowerCase();
				const hit = quick.tags.some((t) => {
					const tl = t.toLowerCase();
					return tl === target || tl.startsWith(`${target}/`);
				});
				if (!hit) return false;
			}

			if (q) {
				const hay = [
					quick.title,
					file.path,
					quick.excerpt,
					...quick.tags.map((t) => `#${t}`),
				]
					.join(" ")
					.toLowerCase();
				if (!hay.includes(q)) return false;
			}

			return true;
		});

		const sort = this.sortMode;
		filtered.sort((a, b) => {
			const pa = this.isPinned(a.path);
			const pb = this.isPinned(b.path);
			if (pa !== pb) return pa ? -1 : 1;

			if (sort === "mtime-desc") return b.stat.mtime - a.stat.mtime;
			if (sort === "mtime-asc") return a.stat.mtime - b.stat.mtime;
			if (sort === "ctime-desc") return b.stat.ctime - a.stat.ctime;
			if (sort === "name-asc") return a.basename.localeCompare(b.basename);
			return b.basename.localeCompare(a.basename);
		});

		return filtered;
	}

	private renderListPane(): void {
		const token = ++this.renderToken;
		this.listBodyEl.empty();

		const files = this.getFilteredAndSortedNotes();
		this.visibleFiles = files;
		this.updateBreadcrumb(files.length);

		const mode = this.displayMode;
		const previewLines = Math.max(1, Math.min(5, this.plugin.settings.navPreviewLines || 3));
		const gridCols = this.plugin.settings.navGridColumns || 0;
		this.listBodyEl.setCssProps({
			"--nt-nav-preview-lines": String(previewLines),
			"--nt-nav-grid-cols": gridCols >= 2 && gridCols <= 5 ? `repeat(${gridCols}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(230px, 1fr))",
		});

		if (files.length === 0) {
			const empty = this.listBodyEl.createDiv({ cls: "nt-nav-empty" });
			setIcon(empty.createSpan({ cls: "nt-nav-empty-icon" }), "file-search");
			empty.createEl("div", {
				cls: "nt-nav-empty-text",
				text: this.searchQuery
					? `No notes match "${this.searchQuery}".`
					: "No notes in this view.",
			});
			return;
		}

		// Group files if grouping enabled
		const groups: Array<{ title: string | null; items: TFile[] }> = [];
		const groupMode = this.groupMode;

		if (groupMode === "none") {
			groups.push({ title: null, items: files });
		} else {
			const buckets = new Map<string, TFile[]>();
			for (const file of files) {
				let key: string;
				if (this.isPinned(file.path)) {
					key = "Pinned";
				} else if (groupMode === "date") {
					key = getDateGroupLabel(file.stat.mtime);
				} else {
					key = file.parent && file.parent.path !== "/" ? file.parent.path : "Vault Root";
				}
				const arr = buckets.get(key) ?? [];
				arr.push(file);
				buckets.set(key, arr);
			}
			for (const [title, items] of buckets.entries()) {
				groups.push({ title, items });
			}
		}

		const activePath = this.app.workspace.getActiveFile()?.path ?? "";
		const hydrateTargets: Array<{
			file: TFile;
			excerptEl: HTMLElement | null;
			mediaHost: HTMLElement | null;
		}> = [];

		let globalIdx = 0;
		for (const group of groups) {
			if (group.title) {
				const header = this.listBodyEl.createDiv({ cls: "nt-nav-group-header" });
				header.createSpan({ text: group.title });
				header.createSpan({ cls: "nt-nav-group-count", text: String(group.items.length) });
			}

			const container = this.listBodyEl.createDiv({
				cls:
					mode === "grid"
						? "nt-nav-grid"
						: mode === "compact"
							? "nt-nav-compact-list"
							: "nt-nav-preview-list",
			});

			for (const file of group.items) {
				const idx = globalIdx++;
				const quick = this.plugin.notePreviewCache.getQuickMetadata(file);
				const isActive = file.path === activePath;
				const pinned = this.isPinned(file.path);

				const card = container.createDiv({
					cls: `nt-nav-item nt-nav-mode-${mode}${isActive ? " is-active" : ""}${pinned ? " is-pinned" : ""}`,
					attr: { "data-path": file.path, "data-idx": String(idx) },
				});

				let excerptEl: HTMLElement | null = null;
				let mediaHost: HTMLElement | null = null;

				if (mode === "grid") {
					// Gallery Grid Card: Multi-image header (up to 3 images) + title + excerpt + footer
					mediaHost = card.createDiv({ cls: "nt-nav-card-media" });
					this.renderMediaStrip(mediaHost, quick.images, "grid");

					const body = card.createDiv({ cls: "nt-nav-card-body" });
					const titleRow = body.createDiv({ cls: "nt-nav-title-row" });
					if (pinned) {
						setIcon(titleRow.createSpan({ cls: "nt-nav-pin-icon" }), "pin");
					}
					titleRow.createSpan({ cls: "nt-nav-title", text: quick.title });

					excerptEl = body.createDiv({
						cls: "nt-nav-excerpt",
						text: quick.excerpt || "",
					});

					this.renderCardMeta(body, file, quick, true);
				} else if (mode === "preview") {
					// Apple Notes / Notebook Navigator Preview Row
					const left = card.createDiv({ cls: "nt-nav-row-left" });
					const titleRow = left.createDiv({ cls: "nt-nav-title-row" });
					if (pinned) {
						setIcon(titleRow.createSpan({ cls: "nt-nav-pin-icon" }), "pin");
					}
					titleRow.createSpan({ cls: "nt-nav-title", text: quick.title });

					excerptEl = left.createDiv({
						cls: "nt-nav-excerpt",
						text: quick.excerpt || "",
					});

					this.renderCardMeta(left, file, quick, true);

					if (this.plugin.settings.navShowThumbnails !== false) {
						mediaHost = card.createDiv({ cls: "nt-nav-row-thumb" });
						this.renderMediaStrip(mediaHost, quick.images, "preview");
					}
				} else {
					// Compact List Row
					const left = card.createDiv({ cls: "nt-nav-compact-left" });
					if (pinned) {
						setIcon(left.createSpan({ cls: "nt-nav-pin-icon" }), "pin");
					} else {
						setIcon(left.createSpan({ cls: "nt-nav-compact-icon" }), "file-text");
					}
					left.createSpan({ cls: "nt-nav-title", text: quick.title });
					if (file.parent && file.parent.path !== "/") {
						left.createSpan({ cls: "nt-nav-folder-pill", text: file.parent.name });
					}
					const right = card.createDiv({ cls: "nt-nav-compact-right" });
					if (quick.taskTotal > 0) {
						right.createSpan({
							cls: "nt-nav-task-pill",
							text: `${quick.taskDone}/${quick.taskTotal}`,
						});
					}
					right.createSpan({
						cls: "nt-nav-date",
						text: formatShortDate(file.stat.mtime),
					});
				}

				card.addEventListener("click", (evt) => {
					this.focusedIndex = idx;
					void this.openNote(file, evt.ctrlKey || evt.metaKey);
				});

				card.addEventListener("contextmenu", (evt) => {
					evt.preventDefault();
					this.showItemContextMenu(evt, file);
				});

				if (mode !== "compact" && !this.plugin.notePreviewCache.getCached(file)) {
					hydrateTargets.push({ file, excerptEl, mediaHost });
				}
			}
		}

		// Lazily hydrate cleaned excerpts in small non-blocking batches
		if (hydrateTargets.length > 0) {
			void this.hydratePreviewsInBatches(hydrateTargets, token, mode);
		}
	}

	private renderMediaStrip(
		host: HTMLElement,
		images: string[],
		mode: "grid" | "preview",
	): void {
		host.empty();
		if (this.plugin.settings.navShowThumbnails === false || images.length === 0) {
			host.toggleClass("is-empty", true);
			return;
		}
		host.toggleClass("is-empty", false);

		if (mode === "preview") {
			host.createEl("img", {
				cls: "nt-nav-thumb-img",
				attr: { src: images[0] ?? "", loading: "lazy", alt: "" },
			});
			if (images.length > 1) {
				host.createSpan({
					cls: "nt-nav-thumb-more",
					text: `+${images.length - 1}`,
				});
			}
			return;
		}

		// Grid collage: 1 full cover image, or 2-3 side-by-side image mosaic
		host.toggleClass("nt-nav-collage-1", images.length === 1);
		host.toggleClass("nt-nav-collage-2", images.length === 2);
		host.toggleClass("nt-nav-collage-3", images.length >= 3);
		for (const src of images.slice(0, 3)) {
			host.createEl("img", {
				cls: "nt-nav-card-img",
				attr: { src, loading: "lazy", alt: "" },
			});
		}
	}

	private renderCardMeta(
		parent: HTMLElement,
		file: TFile,
		data: NotePreviewData,
		showTags: boolean,
	): void {
		const metaRow = parent.createDiv({ cls: "nt-nav-meta-row" });
		metaRow.createSpan({ cls: "nt-nav-date", text: formatShortDate(file.stat.mtime) });

		if (file.parent && file.parent.path !== "/" && this.filter.kind !== "folder") {
			metaRow.createSpan({ cls: "nt-nav-folder-pill", text: file.parent.name });
		}

		if (data.taskTotal > 0) {
			const doneAll = data.taskDone === data.taskTotal;
			metaRow.createSpan({
				cls: `nt-nav-task-pill${doneAll ? " is-complete" : ""}`,
				text: `✓ ${data.taskDone}/${data.taskTotal}`,
			});
		}

		if (showTags && this.plugin.settings.navShowTags !== false && data.tags.length > 0) {
			const tagWrap = metaRow.createDiv({ cls: "nt-nav-tag-pills" });
			for (const tag of data.tags.slice(0, 3)) {
				const pill = tagWrap.createSpan({ cls: "nt-nav-tag-pill", text: `#${tag}` });
				pill.addEventListener("click", (ev) => {
					ev.stopPropagation();
					this.selectFilter({ kind: "tag", tag });
				});
			}
			if (data.tags.length > 3) {
				tagWrap.createSpan({ cls: "nt-nav-tag-more", text: `+${data.tags.length - 3}` });
			}
		}
	}

	private async hydratePreviewsInBatches(
		targets: Array<{ file: TFile; excerptEl: HTMLElement | null; mediaHost: HTMLElement | null }>,
		token: number,
		mode: NavDisplayMode,
	): Promise<void> {
		const batchSize = 12;
		for (let i = 0; i < targets.length; i += batchSize) {
			if (token !== this.renderToken) return;
			const slice = targets.slice(i, i + batchSize);
			await Promise.all(
				slice.map(async ({ file, excerptEl, mediaHost }) => {
					const data = await this.plugin.notePreviewCache.getPreview(file);
					if (token !== this.renderToken) return;
					if (excerptEl) {
						excerptEl.setText(data.excerpt || "Empty note");
						excerptEl.toggleClass("is-muted", !data.excerpt);
					}
					if (mediaHost && data.images.length > 0 && mode !== "compact") {
						this.renderMediaStrip(mediaHost, data.images, mode);
					}
				}),
			);
			await new Promise<void>((r) => window.requestAnimationFrame(() => r()));
		}
	}

	private async openNote(file: TFile, newTab: boolean): Promise<void> {
		const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
		await leaf.openFile(file);
		this.syncActiveHighlight();
	}

	private syncActiveHighlight(): void {
		const activePath = this.app.workspace.getActiveFile()?.path ?? "";
		const items = this.listBodyEl.querySelectorAll<HTMLElement>(".nt-nav-item");
		items.forEach((el) => {
			const match = el.dataset.path === activePath;
			el.toggleClass("is-active", match);
			if (match && this.plugin.settings.navAutoReveal !== false) {
				el.scrollIntoView({ block: "nearest" });
			}
		});
	}

	private handleListKeydown(e: KeyboardEvent): void {
		if (this.visibleFiles.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			this.focusedIndex = Math.min(this.visibleFiles.length - 1, this.focusedIndex + 1);
			this.updateFocusVisual();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			this.focusedIndex = Math.max(0, this.focusedIndex - 1);
			this.updateFocusVisual();
		} else if (e.key === "Enter" && this.focusedIndex >= 0) {
			e.preventDefault();
			const file = this.visibleFiles[this.focusedIndex];
			if (file) void this.openNote(file, e.ctrlKey || e.metaKey);
		}
	}

	private updateFocusVisual(): void {
		const items = this.listBodyEl.querySelectorAll<HTMLElement>(".nt-nav-item");
		items.forEach((el, idx) => {
			el.toggleClass("is-focused", idx === this.focusedIndex);
			if (idx === this.focusedIndex) el.scrollIntoView({ block: "nearest" });
		});
	}

	private showItemContextMenu(evt: MouseEvent, file: TFile): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Open note")
				.setIcon("file-text")
				.onClick(() => void this.openNote(file, false)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Open in new tab")
				.setIcon("file-plus-2")
				.onClick(() => void this.openNote(file, true)),
		);
		menu.addSeparator();
		const pinned = this.isPinned(file.path);
		menu.addItem((item) =>
			item
				.setTitle(pinned ? "Unpin note" : "Pin note to top")
				.setIcon(pinned ? "pin-off" : "pin")
				.onClick(() => void this.togglePin(file.path)),
		);
		menu.addItem((item) =>
			item
				.setTitle("Copy wikilink")
				.setIcon("link")
				.onClick(() => {
					const link = this.app.fileManager.generateMarkdownLink(file, "");
					void navigator.clipboard.writeText(link);
					new Notice(`Copied ${link}`);
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Move to trash")
				.setIcon("trash-2")
				.onClick(
					voidAsync(async () => {
						await this.app.vault.trash(file, true);
						new Notice(`Moved "${file.basename}" to trash.`);
					}),
				),
		);
		menu.showAtMouseEvent(evt);
	}

	private async createNoteInCurrentScope(): Promise<void> {
		const folder = this.filter.kind === "folder" ? this.filter.path : "";
		const baseName = `Untitled ${new Date().toISOString().slice(0, 10)}`;
		let candidate = normalizePath(folder ? `${folder}/${baseName}.md` : `${baseName}.md`);
		let suffix = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			candidate = normalizePath(
				folder ? `${folder}/${baseName} ${suffix}.md` : `${baseName} ${suffix}.md`,
			);
			suffix += 1;
		}
		const initialContent =
			this.filter.kind === "tag" ? `---\ntags:\n  - ${this.filter.tag}\n---\n\n` : "";
		const created = await this.app.vault.create(candidate, initialContent);
		await this.openNote(created, false);
		new Notice(`Created ${created.basename}`);
	}
}
