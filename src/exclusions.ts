import { App, Modal, TFolder, setIcon } from "obsidian";
import { EXTENSIONS, getCategory } from "./fuzzy";
import type { FileCategory } from "./types";

type ExtCategory = FileCategory | "other";

interface ExtensionRow {
	ext: string;
	cat: ExtCategory;
	count: number;
}

/** Visual multi-select picker for excluded vault folders. */
export class FolderSelectorModal extends Modal {
	private readonly selectedFolders: Set<string>;
	private searchQuery = "";
	private allFolders: string[] = [];
	private badgeEl!: HTMLElement;
	private confirmBtn!: HTMLButtonElement;
	private listContainer!: HTMLElement;

	constructor(
		app: App,
		currentExcludedFolders: string[],
		private readonly onSave: (folders: string[]) => void | Promise<void>,
	) {
		super(app);
		this.selectedFolders = new Set(currentExcludedFolders || []);
		this.modalEl.addClass("nt-folder-picker-modal");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const topBar = contentEl.createDiv({ cls: "nt-topbar" });
		const titleGroup = topBar.createDiv({ cls: "nt-title-group" });
		titleGroup.createEl("h2", { text: "Select Folders to Exclude" });
		this.badgeEl = titleGroup.createSpan({
			cls: "nt-badge-count",
			text: `${this.selectedFolders.size} selected`,
		});

		const closeBtn = topBar.createEl("button", { cls: "nt-icon-btn" });
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => this.close());

		contentEl.createEl("p", {
			cls: "nt-muted",
			text: "Navigate or search through vault folders. Checked folders will be completely excluded from Note Toolbox.",
		});

		const searchRow = contentEl.createDiv({ cls: "nt-filter-row" });
		const searchInput = searchRow.createEl("input", {
			type: "search",
			placeholder: "Filter folders by name or path...",
			cls: "nt-search-input",
		});

		const quickGroup = searchRow.createDiv({ cls: "nt-btn-group" });
		quickGroup.createEl("button", { text: "Select All", cls: "nt-btn-sm" }).addEventListener("click", () => {
			const list = this.getFilteredFolders();
			list.forEach((f) => this.selectedFolders.add(f));
			this.updateBadge();
			this.renderList();
		});
		quickGroup.createEl("button", { text: "Clear All", cls: "nt-btn-sm" }).addEventListener("click", () => {
			const list = this.getFilteredFolders();
			list.forEach((f) => this.selectedFolders.delete(f));
			this.updateBadge();
			this.renderList();
		});
		quickGroup.createEl("button", { text: "Invert", cls: "nt-btn-sm" }).addEventListener("click", () => {
			const list = this.getFilteredFolders();
			list.forEach((f) => {
				if (this.selectedFolders.has(f)) this.selectedFolders.delete(f);
				else this.selectedFolders.add(f);
			});
			this.updateBadge();
			this.renderList();
		});

		this.allFolders = [];
		const collect = (item: unknown): void => {
			if (item instanceof TFolder) {
				if (item.path && item.path !== "/") this.allFolders.push(item.path);
				if (item.children) item.children.forEach(collect);
			}
		};
		collect(this.app.vault.getRoot());
		this.allFolders.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

		this.listContainer = contentEl.createDiv({ cls: "nt-folder-list-container" });
		this.renderList();

		searchInput.addEventListener("input", () => {
			this.searchQuery = searchInput.value.trim().toLowerCase();
			this.renderList();
		});

		const footer = contentEl.createDiv({ cls: "nt-modal-actions" });
		footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

		this.confirmBtn = footer.createEl("button", {
			text: `Apply Exclusions (${this.selectedFolders.size})`,
			cls: "mod-cta",
		});
		this.confirmBtn.addEventListener("click", () => {
			this.close();
			void this.onSave(Array.from(this.selectedFolders));
		});
	}

	private getFilteredFolders(): string[] {
		if (!this.searchQuery) return this.allFolders;
		return this.allFolders.filter((folderPath) =>
			folderPath.toLowerCase().includes(this.searchQuery),
		);
	}

	private updateBadge(): void {
		if (this.badgeEl) this.badgeEl.setText(`${this.selectedFolders.size} selected`);
		if (this.confirmBtn) {
			this.confirmBtn.setText(`Apply Exclusions (${this.selectedFolders.size})`);
		}
	}

	private renderList(): void {
		this.listContainer.empty();
		const filtered = this.getFilteredFolders();

		if (filtered.length === 0) {
			const empty = this.listContainer.createDiv({ cls: "nt-empty" });
			empty.createSpan({ text: "No matching folders found." });
			return;
		}

		filtered.forEach((folderPath) => {
			const isSelected = this.selectedFolders.has(folderPath);
			const row = this.listContainer.createDiv({
				cls: `nt-folder-row ${isSelected ? "is-selected" : ""}`,
			});

			const check = row.createDiv({ cls: "nt-folder-row-checkbox" });
			if (isSelected) setIcon(check, "check");

			const icon = row.createDiv({ cls: "nt-folder-icon" });
			setIcon(icon, isSelected ? "folder-x" : "folder");

			row.createDiv({ cls: "nt-folder-name", text: folderPath });

			row.addEventListener("click", () => {
				if (this.selectedFolders.has(folderPath)) {
					this.selectedFolders.delete(folderPath);
					row.removeClass("is-selected");
					check.empty();
					setIcon(icon, "folder");
				} else {
					this.selectedFolders.add(folderPath);
					row.addClass("is-selected");
					setIcon(check, "check");
					setIcon(icon, "folder-x");
				}
				this.updateBadge();
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
	private badgeEl!: HTMLElement;
	private confirmBtn!: HTMLButtonElement;
	private listContainer!: HTMLElement;

	constructor(
		app: App,
		currentExcludedExtensions: string[],
		private readonly onSave: (extensions: string[]) => void | Promise<void>,
	) {
		super(app);
		this.selectedExtensions = new Set(
			(currentExcludedExtensions || []).map((e) =>
				e.trim().toLowerCase().replace(/^\./, ""),
			),
		);
		this.modalEl.addClass("nt-ext-picker-modal");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const topBar = contentEl.createDiv({ cls: "nt-topbar" });
		const titleGroup = topBar.createDiv({ cls: "nt-title-group" });
		titleGroup.createEl("h2", { text: "Manage Excluded Extensions" });
		this.badgeEl = titleGroup.createSpan({
			cls: "nt-badge-count",
			text: `${this.selectedExtensions.size} excluded`,
		});

		const closeBtn = topBar.createEl("button", { cls: "nt-icon-btn" });
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => this.close());

		contentEl.createEl("p", {
			cls: "nt-muted",
			text: "Select file extensions you want to hide. Use Select All, Clear All, or Invert for fast batch configuration.",
		});

		const searchRow = contentEl.createDiv({ cls: "nt-filter-row" });
		const searchInput = searchRow.createEl("input", {
			type: "search",
			placeholder: "Filter extensions (e.g. csv, png, mp4)...",
			cls: "nt-search-input",
		});

		const quickGroup = searchRow.createDiv({ cls: "nt-btn-group" });
		quickGroup.createEl("button", { text: "Select All", cls: "nt-btn-sm" }).addEventListener("click", () => {
			this.getFilteredExtensions().forEach((item) => this.selectedExtensions.add(item.ext));
			this.updateBadge();
			this.renderList();
		});
		quickGroup.createEl("button", { text: "Clear All", cls: "nt-btn-sm" }).addEventListener("click", () => {
			this.getFilteredExtensions().forEach((item) => this.selectedExtensions.delete(item.ext));
			this.updateBadge();
			this.renderList();
		});
		quickGroup.createEl("button", { text: "Invert", cls: "nt-btn-sm" }).addEventListener("click", () => {
			this.getFilteredExtensions().forEach((item) => {
				if (this.selectedExtensions.has(item.ext)) this.selectedExtensions.delete(item.ext);
				else this.selectedExtensions.add(item.ext);
			});
			this.updateBadge();
			this.renderList();
		});

		const catRow = contentEl.createDiv({ cls: "nt-chip-group" });
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

		this.listContainer = contentEl.createDiv({ cls: "nt-ext-list-container" });
		this.renderList();

		searchInput.addEventListener("input", () => {
			this.searchQuery = searchInput.value.trim().toLowerCase().replace(/^\./, "");
			this.renderList();
		});

		const footer = contentEl.createDiv({ cls: "nt-modal-actions" });
		footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

		this.confirmBtn = footer.createEl("button", {
			text: `Apply Exclusions (${this.selectedExtensions.size})`,
			cls: "mod-cta",
		});
		this.confirmBtn.addEventListener("click", () => {
			this.close();
			void this.onSave(Array.from(this.selectedExtensions));
		});
	}

	private updateBadge(): void {
		if (this.badgeEl) {
			this.badgeEl.setText(`${this.selectedExtensions.size} excluded`);
		}
		if (this.confirmBtn) {
			this.confirmBtn.setText(`Apply Exclusions (${this.selectedExtensions.size})`);
		}
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
				this.updateBadge();
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
