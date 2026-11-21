import { App, Modal, TFolder, setIcon } from "obsidian";
import { EXTENSIONS, getCategory } from "./fuzzy";
import type { FileCategory } from "./types";

type ExtCategory = FileCategory | "other";

interface ExtensionRow {
	ext: string;
	cat: ExtCategory;
	count: number;
}

interface ExclusionModalShellOptions {
	contentEl: HTMLElement;
	title: string;
	initialCount: number;
	description: string;
	searchPlaceholder: string;
	onClose: () => void;
	onSelectAll: () => void;
	onClearAll: () => void;
	onInvert: () => void;
	onSearch: (value: string) => void;
	onConfirm: () => void;
}

interface ExclusionModalShell {
	badgeEl: HTMLElement;
	confirmBtn: HTMLButtonElement;
	bodyAnchor: HTMLElement;
	updateCount: (count: number) => void;
}

/** Trim, strip trailing slashes, and deduplicate excluded folder paths (case-insensitively). */
export function normalizeExcludedFolders(folders: readonly string[] | null | undefined): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of folders ?? []) {
		const cleaned = raw.trim().replace(/^\/+|\/+$/g, "");
		if (!cleaned) continue;
		const key = cleaned.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(cleaned);
	}
	return result;
}

/** Trim, lowercase, strip leading dots, and deduplicate excluded file extensions. */
export function normalizeExcludedExtensions(
	extensions: readonly string[] | null | undefined,
): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of extensions ?? []) {
		const cleaned = raw.trim().toLowerCase().replace(/^\.+/, "");
		if (!cleaned || seen.has(cleaned)) continue;
		seen.add(cleaned);
		result.push(cleaned);
	}
	return result;
}

function buildExclusionModalShell(opts: ExclusionModalShellOptions): ExclusionModalShell {
	const { contentEl } = opts;
	contentEl.empty();

	const topBar = contentEl.createDiv({ cls: "nt-topbar" });
	const titleGroup = topBar.createDiv({ cls: "nt-title-group" });
	titleGroup.createEl("h2", { text: opts.title });
	const badgeEl = titleGroup.createSpan({
		cls: "nt-badge-count",
		text: `${opts.initialCount} excluded`,
	});

	const closeBtn = topBar.createEl("button", { cls: "nt-icon-btn" });
	setIcon(closeBtn, "x");
	closeBtn.addEventListener("click", opts.onClose);

	contentEl.createEl("p", {
		cls: "nt-muted",
		text: opts.description,
	});

	const searchRow = contentEl.createDiv({ cls: "nt-filter-row" });
	const searchInput = searchRow.createEl("input", {
		type: "search",
		placeholder: opts.searchPlaceholder,
		cls: "nt-search-input",
	});
	searchInput.addEventListener("input", () => opts.onSearch(searchInput.value));

	const quickGroup = searchRow.createDiv({ cls: "nt-btn-group" });
	quickGroup
		.createEl("button", { text: "Select All", cls: "nt-btn-sm" })
		.addEventListener("click", opts.onSelectAll);
	quickGroup
		.createEl("button", { text: "Clear All", cls: "nt-btn-sm" })
		.addEventListener("click", opts.onClearAll);
	quickGroup
		.createEl("button", { text: "Invert", cls: "nt-btn-sm" })
		.addEventListener("click", opts.onInvert);

	const bodyAnchor = contentEl.createDiv({ cls: "nt-exclusion-body-anchor" });

	const footer = contentEl.createDiv({ cls: "nt-modal-actions" });
	footer.createEl("button", { text: "Cancel" }).addEventListener("click", opts.onClose);

	const confirmBtn = footer.createEl("button", {
		text: `Apply Exclusions (${opts.initialCount})`,
		cls: "nt-exclude-cta",
	});
	confirmBtn.addEventListener("click", opts.onConfirm);

	const updateCount = (count: number): void => {
		badgeEl.setText(`${count} excluded`);
		confirmBtn.setText(`Apply Exclusions (${count})`);
	};

	return { badgeEl, confirmBtn, bodyAnchor, updateCount };
}

/** Visual multi-select picker for excluded vault folders. */
export class FolderSelectorModal extends Modal {
	private readonly selectedFolders: Set<string>;
	private searchQuery = "";
	private allFolders: string[] = [];
	private folderAssetCounts = new Map<string, number>();
	private shell!: ExclusionModalShell;
	private listContainer!: HTMLElement;

	constructor(
		app: App,
		currentExcludedFolders: string[],
		private readonly onSave: (folders: string[]) => void | Promise<void>,
	) {
		super(app);
		this.selectedFolders = new Set(normalizeExcludedFolders(currentExcludedFolders));
		this.modalEl.addClass("nt-folder-picker-modal");
	}

	onOpen(): void {
		this.allFolders = [];
		const collect = (item: unknown): void => {
			if (item instanceof TFolder) {
				if (item.path && item.path !== "/") this.allFolders.push(item.path);
				if (item.children) item.children.forEach(collect);
			}
		};
		collect(this.app.vault.getRoot());
		this.allFolders.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

		// Precompute recursive media asset counts per folder once.
		this.folderAssetCounts.clear();
		for (const file of this.app.vault.getFiles()) {
			if (!getCategory(file)) continue;
			let parent = file.parent;
			while (parent && parent.path && parent.path !== "/") {
				this.folderAssetCounts.set(
					parent.path,
					(this.folderAssetCounts.get(parent.path) ?? 0) + 1,
				);
				parent = parent.parent;
			}
		}

		this.shell = buildExclusionModalShell({
			contentEl: this.contentEl,
			title: "Select Folders to Exclude",
			initialCount: this.selectedFolders.size,
			description:
				"Navigate or search vault folders. Excluding a folder automatically excludes all of its subfolders.",
			searchPlaceholder: "Filter folders by name or path...",
			onClose: () => this.close(),
			onSelectAll: () => {
				this.getFilteredFolders().forEach((f) => this.selectedFolders.add(f));
				this.shell.updateCount(this.selectedFolders.size);
				this.renderList();
			},
			onClearAll: () => {
				this.getFilteredFolders().forEach((f) => this.selectedFolders.delete(f));
				this.shell.updateCount(this.selectedFolders.size);
				this.renderList();
			},
			onInvert: () => {
				this.getFilteredFolders().forEach((f) => {
					if (this.selectedFolders.has(f)) this.selectedFolders.delete(f);
					else this.selectedFolders.add(f);
				});
				this.shell.updateCount(this.selectedFolders.size);
				this.renderList();
			},
			onSearch: (value) => {
				this.searchQuery = value.trim().toLowerCase();
				this.renderList();
			},
			onConfirm: () => {
				this.close();
				void this.onSave(normalizeExcludedFolders(Array.from(this.selectedFolders)));
			},
		});

		this.listContainer = this.shell.bodyAnchor.createDiv({ cls: "nt-folder-list-container" });
		this.renderList();
	}

	private getFilteredFolders(): string[] {
		if (!this.searchQuery) return this.allFolders;
		return this.allFolders.filter((folderPath) =>
			folderPath.toLowerCase().includes(this.searchQuery),
		);
	}

	private hasExcludedAncestor(folderPath: string): boolean {
		const lower = folderPath.toLowerCase();
		for (const selected of this.selectedFolders) {
			const selLower = selected.toLowerCase();
			if (lower.startsWith(`${selLower}/`)) return true;
		}
		return false;
	}

	private renderList(): void {
		this.listContainer.empty();
		const filtered = this.getFilteredFolders();

		if (filtered.length === 0) {
			const empty = this.listContainer.createDiv({ cls: "nt-empty" });
			empty.createSpan({ text: "No matching folders found." });
			return;
		}

		const isSearching = this.searchQuery.length > 0;

		filtered.forEach((folderPath) => {
			const isSelected = this.selectedFolders.has(folderPath);
			const isInherited = !isSelected && this.hasExcludedAncestor(folderPath);
			const depth = isSearching ? 0 : Math.min(folderPath.split("/").length - 1, 6);

			const rowClasses = ["nt-folder-row"];
			if (isSelected) rowClasses.push("is-selected");
			else if (isInherited) rowClasses.push("is-inherited");

			const row = this.listContainer.createDiv({ cls: rowClasses.join(" ") });
			if (depth > 0) {
				row.style.paddingLeft = `${10 + depth * 18}px`;
			}

			const check = row.createDiv({ cls: "nt-folder-row-checkbox" });
			if (isSelected) setIcon(check, "check");
			else if (isInherited) setIcon(check, "minus");

			const icon = row.createDiv({ cls: "nt-folder-icon" });
			setIcon(icon, isSelected || isInherited ? "folder-x" : "folder");

			const displayName = isSearching
				? folderPath
				: folderPath.split("/").pop() || folderPath;
			const nameEl = row.createDiv({ cls: "nt-folder-name", text: displayName });
			if (!isSearching && depth > 0) {
				nameEl.setAttribute("title", folderPath);
			}

			if (isInherited) {
				row.createSpan({ cls: "nt-folder-inherited-tag", text: "via parent" });
			}

			const assetCount = this.folderAssetCounts.get(folderPath) ?? 0;
			row.createDiv({
				cls: "nt-folder-count",
				text:
					assetCount === 0
						? "empty"
						: assetCount === 1
							? "1 asset"
							: `${assetCount} assets`,
			});

			row.addEventListener("click", () => {
				if (this.selectedFolders.has(folderPath)) {
					this.selectedFolders.delete(folderPath);
				} else {
					this.selectedFolders.add(folderPath);
				}
				this.shell.updateCount(this.selectedFolders.size);
				this.renderList();
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Visual multi-select picker for excluded file extensions. */
export class ExtensionSelectorModal extends Modal {
	private readonly selectedExtensions: Set<string>;
	private searchQuery = "";
	private activeCategory = "all";
	private allExtensions: ExtensionRow[] = [];
	private catBtns = new Map<string, HTMLButtonElement>();
	private shell!: ExclusionModalShell;
	private listContainer!: HTMLElement;

	constructor(
		app: App,
		currentExcludedExtensions: string[],
		private readonly onSave: (extensions: string[]) => void | Promise<void>,
	) {
		super(app);
		this.selectedExtensions = new Set(normalizeExcludedExtensions(currentExcludedExtensions));
		this.modalEl.addClass("nt-ext-picker-modal");
	}

	onOpen(): void {
		this.shell = buildExclusionModalShell({
			contentEl: this.contentEl,
			title: "Manage Excluded Extensions",
			initialCount: this.selectedExtensions.size,
			description:
				"Select file extensions you want to hide. Use Select All, Clear All, or Invert for fast batch configuration.",
			searchPlaceholder: "Filter extensions (e.g. csv, png, mp4)...",
			onClose: () => this.close(),
			onSelectAll: () => {
				this.getFilteredExtensions().forEach((item) => this.selectedExtensions.add(item.ext));
				this.shell.updateCount(this.selectedExtensions.size);
				this.renderList();
			},
			onClearAll: () => {
				this.getFilteredExtensions().forEach((item) => this.selectedExtensions.delete(item.ext));
				this.shell.updateCount(this.selectedExtensions.size);
				this.renderList();
			},
			onInvert: () => {
				this.getFilteredExtensions().forEach((item) => {
					if (this.selectedExtensions.has(item.ext)) this.selectedExtensions.delete(item.ext);
					else this.selectedExtensions.add(item.ext);
				});
				this.shell.updateCount(this.selectedExtensions.size);
				this.renderList();
			},
			onSearch: (value) => {
				this.searchQuery = value.trim().toLowerCase().replace(/^\./, "");
				this.renderList();
			},
			onConfirm: () => {
				this.close();
				void this.onSave(normalizeExcludedExtensions(Array.from(this.selectedExtensions)));
			},
		});

		const catRow = this.shell.bodyAnchor.createDiv({ cls: "nt-chip-group" });
		const cats: Array<{ id: string; label: string }> = [
			{ id: "all", label: "All Types" },
			{ id: "image", label: "Images" },
			{ id: "video", label: "Videos" },
			{ id: "audio", label: "Audio" },
			{ id: "document", label: "Documents" },
		];
		this.catBtns = new Map();
		cats.forEach((cat) => {
			const chip = catRow.createEl("button", {
				cls: `nt-chip mod-pill-filter ${this.activeCategory === cat.id ? "is-active" : ""}`,
				text: cat.label,
			});
			chip.addEventListener("click", () => {
				if (this.activeCategory === cat.id) return;
				this.activeCategory = cat.id;
				this.catBtns.forEach((btn, id) => btn.toggleClass("is-active", id === this.activeCategory));
				this.renderList();
			});
			this.catBtns.set(cat.id, chip);
		});

		const extMap = new Map<string, ExtensionRow>();
		EXTENSIONS.images.forEach((e) => extMap.set(e, { ext: e, cat: "image", count: 0 }));
		EXTENSIONS.video.forEach((e) => extMap.set(e, { ext: e, cat: "video", count: 0 }));
		EXTENSIONS.audio.forEach((e) => extMap.set(e, { ext: e, cat: "audio", count: 0 }));
		EXTENSIONS.docs.forEach((e) => extMap.set(e, { ext: e, cat: "document", count: 0 }));

		this.app.vault.getFiles().forEach((file) => {
			if (!file.extension) return;
			const ext = file.extension.toLowerCase();
			const existing = extMap.get(ext);
			if (existing) {
				existing.count++;
			} else {
				const cat = getCategory(file) ?? "other";
				extMap.set(ext, { ext, cat, count: 1 });
			}
		});

		this.allExtensions = Array.from(extMap.values()).sort((a, b) => {
			if (b.count !== a.count) return b.count - a.count;
			return a.ext.localeCompare(b.ext);
		});

		this.listContainer = this.shell.bodyAnchor.createDiv({ cls: "nt-ext-list-container" });
		this.renderList();
	}

	private getFilteredExtensions(): ExtensionRow[] {
		return this.allExtensions.filter((item) => {
			if (this.activeCategory !== "all" && item.cat !== this.activeCategory) return false;
			if (this.searchQuery && !item.ext.includes(this.searchQuery)) return false;
			return true;
		});
	}

	private renderList(): void {
		this.listContainer.empty();
		const filtered = this.getFilteredExtensions();

		if (filtered.length === 0) {
			const empty = this.listContainer.createDiv({ cls: "nt-empty" });
			empty.createSpan({ text: "No matching extensions found." });
			return;
		}

		filtered.forEach((item) => {
			const isSelected = this.selectedExtensions.has(item.ext);
			const row = this.listContainer.createDiv({
				cls: `nt-ext-row ${isSelected ? "is-selected" : ""}`,
			});

			const check = row.createDiv({ cls: "nt-folder-row-checkbox" });
			if (isSelected) setIcon(check, "check");

			row.createDiv({ cls: "nt-ext-badge", text: `.${item.ext.toUpperCase()}` });
			row.createDiv({ cls: "nt-ext-cat", text: item.cat });
			row.createDiv({
				cls: "nt-ext-count",
				text: item.count > 0 ? `${item.count} in vault` : "none",
			});

			row.addEventListener("click", () => {
				if (this.selectedExtensions.has(item.ext)) {
					this.selectedExtensions.delete(item.ext);
					row.removeClass("is-selected");
					check.empty();
				} else {
					this.selectedExtensions.add(item.ext);
					row.addClass("is-selected");
					setIcon(check, "check");
				}
				this.shell.updateCount(this.selectedExtensions.size);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
