import {
	MarkdownView,
	Menu,
	Modal,
	Notice,
	TFile,
	normalizePath,
	setIcon,
	setTooltip,
	type App,
	type WorkspaceLeaf,
} from "obsidian";
import type NoteToolboxPlugin from "./main";
import type { MediaService } from "./media";
import type {
	CategoryFilter,
	ChooserOptions,
	MediaMetadata,
	PickerConfig,
	PickerSelectHandler,
	SortMode,
	UsageFilter,
	ViewMode,
} from "./types";
import { debounce, getCategory, getExtensions } from "./fuzzy";
import { ConfirmModal, InputPromptModal, SelectFolderModal } from "./modals";
import { ExtensionSelectorModal, FolderSelectorModal } from "./exclusions";
import { QuickLookModal } from "./quick-look";
import { DropdownManagerModal } from "./dropdown-manager-modal";
import { voidAsync } from "./async";

interface CanvasLike {
	x?: number;
	y?: number;
	zoom?: number;
	createFileNode?: (options: {
		file: TFile;
		pos: { x: number; y: number };
		size: { width: number; height: number };
		save: boolean;
	}) => void;
	requestSave?: () => void;
}

interface ExcalidrawApi {
	reset: () => void;
	setView: (view: unknown) => void;
	addImage?: (x: number, y: number, file: TFile) => Promise<void>;
	addEmbeddable?: (
		x: number,
		y: number,
		width: number,
		height: number,
		unknown: null,
		file: TFile,
	) => Promise<void>;
	addElementsToView: (a: boolean, b: boolean) => Promise<void>;
}

function normalizePicker(options: ChooserOptions, onSelect: PickerSelectHandler): PickerConfig {
	return {
		category: options.category ?? "all",
		lockCategory: options.lockCategory ?? Boolean(options.category && options.category !== "all"),
		multiple: Boolean(options.multiple),
		title: options.title ?? "",
		initialFolder: options.initialFolder ?? "/ (All Vault)",
		allowedExtensions: options.allowedExtensions ?? null,
		excludeExtensions: options.excludeExtensions ?? null,
		excludeFolders: options.excludeFolders ?? null,
		onSelect,
		onCancel: options.onCancel,
	};
}

/**
 * Primary 3-tier media browser, selection engine, and picker surface.
 * Port of MediaToolboxModal (Nihon main.js L1391–2844).
 */
export class MediaToolboxModal extends Modal {
	private readonly service: MediaService;
	private readonly picker: PickerConfig | null;
	private readonly targetLeaf: WorkspaceLeaf | null;

	private readonly selected = new Set<string>();
	private category: CategoryFilter;
	private readonly lockCategory: boolean;
	private readonly multiple: boolean;
	private selectedFolder: string;
	private searchQuery = "";
	private sortMode: SortMode = "mtime-desc";
	private usageFilter: UsageFilter = "all";
	private selectedExtension = "all";
	private hideExcluded = true;
	private viewMode: ViewMode;

	private readonly pickerAllowedExtensions: string[] | null;
	private readonly pickerExcludedExtensions: string[] | null;
	private readonly pickerExcludedFolders: string[] | null;

	private badgeEl?: HTMLElement;
	private folderSelect?: HTMLSelectElement;
	private extSelect?: HTMLSelectElement;
	private sortSelect?: HTMLSelectElement;
	private viewportWrapper!: HTMLElement;
	private viewportContainer!: HTMLElement;
	private scrollTopBtn?: HTMLButtonElement;
	private observer: IntersectionObserver | null = null;
	private galleryResizeObserver: ResizeObserver | null = null;
	private rowsChangedListener: (() => void) | null = null;
	private readonly chipButtons = new Map<string, HTMLButtonElement>();

	private lastClickedIndex: number | null = null;
	private currentRenderedFiles: TFile[] = [];
	private readonly pageSize = 50;
	private renderedCount = 50;
	private resolved = false;

	constructor(
		app: App,
		private readonly plugin: NoteToolboxPlugin,
		targetLeaf: WorkspaceLeaf | null = null,
		pickerOptions: ChooserOptions | null = null,
	) {
		super(app);
		this.service = plugin.service;
		this.targetLeaf = targetLeaf ?? this.app.workspace.getMostRecentLeaf();
		this.picker =
			pickerOptions?.onSelect !== undefined
				? normalizePicker(pickerOptions, pickerOptions.onSelect)
				: null;

		this.category = this.picker?.category ?? "all";
		this.lockCategory = Boolean(this.picker?.lockCategory);
		this.multiple = this.picker ? Boolean(this.picker.multiple) : true;
		this.selectedFolder = this.picker?.initialFolder ?? "/ (All Vault)";
		this.viewMode = this.plugin.settings.defaultViewMode || "grid";

		this.pickerAllowedExtensions = this.picker?.allowedExtensions ?? null;
		this.pickerExcludedExtensions = this.picker?.excludeExtensions ?? null;
		this.pickerExcludedFolders = this.picker?.excludeFolders ?? null;
	}

	onOpen(): void {
		this.modalEl.addClass("nt-media-modal", "nt-media-window");
		this.setupIntersectionObserver();
		this.render();
	}

	private setupIntersectionObserver(): void {
		this.observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) void this.hydrateEntry(entry);
				});
			},
			{ rootMargin: "250px 0px" },
		);
	}

	private async hydrateEntry(entry: IntersectionObserverEntry): Promise<void> {
		const element = entry.target as HTMLElement;
		this.observer?.unobserve(element);

		const filePath = element.dataset.path;
		if (!filePath) return;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		const meta = await this.service.getFullMetadata(file);
		const detailTag = element.classList.contains("nt-detail-tag")
			? element
			: element.querySelector(".nt-detail-tag");
		if (detailTag instanceof HTMLElement && meta.detail) {
			detailTag.setText(meta.detail);
			detailTag.removeClass("nt-hidden");
		}
	}

	private getModalTitle(): string {
		if (this.picker?.title) return this.picker.title;
		if (this.picker) {
			const labels: Record<string, string> = {
				image: "Choose Image",
				video: "Choose Video",
				audio: "Choose Audio",
				document: "Choose Document",
				all: "Choose Asset",
			};
			return labels[this.category] ?? "Choose Asset";
		}
		return "Media & Asset Toolbox";
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const topBar = contentEl.createDiv({ cls: "nt-topbar" });
		const titleGroup = topBar.createDiv({ cls: "nt-title-group" });
		titleGroup.createEl("h2", { text: this.getModalTitle() });
		this.badgeEl = titleGroup.createSpan({ cls: "nt-badge-count", text: "0 assets" });

		const topRightGroup = topBar.createDiv({ cls: "nt-btn-group" });

		const viewToggleBtn = topRightGroup.createEl("button", { cls: "nt-btn-sm" });
		const viewIconEl = viewToggleBtn.createSpan({ cls: "nt-btn-icon" });
		const viewLabelEl = viewToggleBtn.createSpan();
		const syncViewToggle = () => {
			if (!viewIconEl || !viewLabelEl) return;
			if (this.viewMode === "grid") {
				setIcon(viewIconEl, "list");
				viewLabelEl.setText("List");
				setTooltip(viewToggleBtn, "Switch to List View");
			} else {
				setIcon(viewIconEl, "layout-grid");
				viewLabelEl.setText("Grid");
				setTooltip(viewToggleBtn, "Switch to Grid View");
			}
		};
		syncViewToggle();
		viewToggleBtn.addEventListener("click", () => {
			this.viewMode = this.viewMode === "grid" ? "list" : "grid";
			syncViewToggle();
			if (!this.picker) {
				this.plugin.settings.defaultViewMode = this.viewMode;
				void this.plugin.saveSettings();
			}
			this.renderViewport(true);
		});

		const layoutGroup = topRightGroup.createDiv({ cls: "nt-layout-group" });
		const layoutIcon = layoutGroup.createSpan({ cls: "nt-btn-icon" });
		setIcon(layoutIcon, "layout-grid");

		const rowsSelect = layoutGroup.createEl("select", { cls: "nt-layout-select" });
		for (let r = 2; r <= 6; r++) {
			rowsSelect.createEl("option", { text: `${r} rows`, value: String(r) });
		}
		rowsSelect.value = String(this.plugin.settings.galleryRows || 4);
		setTooltip(rowsSelect, "Visible gallery rows");

		const colsSelect = layoutGroup.createEl("select", { cls: "nt-layout-select" });
		for (let c = 2; c <= 8; c++) {
			colsSelect.createEl("option", { text: `${c} cols`, value: String(c) });
		}
		colsSelect.value = String(this.plugin.settings.galleryColumns || 5);
		setTooltip(colsSelect, "Gallery columns (fewer = larger previews)");

		const applyLayoutChange = () => {
			this.plugin.settings.galleryRows = Number(rowsSelect.value) || 4;
			this.plugin.settings.galleryColumns = Number(colsSelect.value) || 5;
			void this.plugin.saveSettings();
			if (this.viewMode !== "grid") {
				this.viewMode = "grid";
				syncViewToggle();
				this.renderViewport(true);
			} else {
				this.applyGalleryLayout();
			}
		};
		rowsSelect.addEventListener("change", applyLayoutChange);
		colsSelect.addEventListener("change", applyLayoutChange);

		if (!this.picker) {
			const ddBtn = topRightGroup.createEl("button", { cls: "nt-btn-sm" });
			setIcon(ddBtn.createSpan({ cls: "nt-btn-icon" }), "list-checks");
			ddBtn.createSpan({ text: "Dropdowns" });
			setTooltip(ddBtn, "Open Inline Dropdown Manager");
			ddBtn.addEventListener("click", () => {
				new DropdownManagerModal(this.app, this.plugin).open();
			});
		}

		const closeBtn = topRightGroup.createEl("button", { cls: "nt-icon-btn" });
		setIcon(closeBtn, "x");
		setTooltip(closeBtn, "Close (Esc)");
		closeBtn.addEventListener("click", () => this.close());

		const navRow = contentEl.createDiv({ cls: "nt-nav-row" });
		const navLeft = navRow.createDiv({ cls: "nt-nav-left" });
		const navRight = navRow.createDiv({ cls: "nt-nav-right" });

		const categoryBar = navLeft.createDiv({ cls: "nt-chip-group" });
		this.chipButtons.clear();
		const categories: Array<{ id: CategoryFilter; label: string; icon: string }> = [
			{ id: "all", label: "All Assets", icon: "layers" },
			{ id: "image", label: "Images", icon: "image" },
			{ id: "video", label: "Videos", icon: "video" },
			{ id: "audio", label: "Audio", icon: "music" },
			{ id: "document", label: "Documents", icon: "file-text" },
		];

		categories.forEach((cat) => {
			if (this.lockCategory && this.category !== "all" && cat.id !== this.category) {
				return;
			}
			const chip = categoryBar.createEl("button", {
				cls: `nt-chip ${this.category === cat.id ? "is-active" : ""}`,
			});
			const iconSpan = chip.createSpan({ cls: "nt-chip-icon" });
			setIcon(iconSpan, cat.icon);
			chip.createSpan({ text: cat.label });
			chip.addEventListener("click", () => {
				if (this.category === cat.id) return;
				this.category = cat.id;
				this.chipButtons.forEach((btn, id) => btn.toggleClass("is-active", id === this.category));
				this.selectedExtension = "all";
				this.updateExtensionOptions();
				this.renderViewport(true);
			});
			this.chipButtons.set(cat.id, chip);
		});

		const search = navRight.createEl("input", {
			type: "search",
			placeholder: "Search name or path...",
			cls: "nt-search-input",
		});
		search.value = this.searchQuery;

		const debouncedFilter = debounce(() => {
			this.renderViewport(true);
		}, 160);

		search.addEventListener("input", () => {
			this.searchQuery = search.value;
			debouncedFilter();
		});

		const resetBtn = navRight.createEl("button", { cls: "nt-icon-btn" });
		setIcon(resetBtn, "rotate-ccw");
		setTooltip(resetBtn, "Reset all search & filter rules");

		const filterRow = contentEl.createDiv({ cls: "nt-filter-row" });
		const filterLeft = filterRow.createDiv({ cls: "nt-filter-left" });
		const filterRight = filterRow.createDiv({ cls: "nt-filter-right" });

		this.folderSelect = filterLeft.createEl("select", { cls: "nt-select" });
		this.service.getAllFolders().forEach((f) => {
			const opt = this.folderSelect?.createEl("option", { text: f, value: f });
			if (opt) opt.selected = f === this.selectedFolder;
		});
		this.folderSelect.addEventListener("change", () => {
			this.selectedFolder = this.folderSelect?.value ?? "/ (All Vault)";
			this.updateExtensionOptions();
			this.renderViewport(true);
		});

		this.extSelect = filterLeft.createEl("select", { cls: "nt-select" });
		this.updateExtensionOptions();
		this.extSelect.addEventListener("change", () => {
			this.selectedExtension = this.extSelect?.value ?? "all";
			this.renderViewport(true);
		});

		const usageSelect = filterLeft.createEl("select", { cls: "nt-select" });
		[
			{ id: "all", label: "All Assets" },
			{ id: "orphan", label: "Unused / Orphans" },
			{ id: "linked", label: "In Use (Linked)" },
		].forEach((u) => {
			const opt = usageSelect.createEl("option", { text: u.label, value: u.id });
			opt.selected = u.id === this.usageFilter;
		});
		usageSelect.addEventListener("change", () => {
			this.usageFilter = usageSelect.value as UsageFilter;
			this.renderViewport(true);
		});

		this.sortSelect = filterLeft.createEl("select", { cls: "nt-select" });
		[
			{ id: "mtime-desc", label: "Date (Newest)" },
			{ id: "mtime-asc", label: "Date (Oldest)" },
			{ id: "name-asc", label: "Name (A–Z)" },
			{ id: "name-desc", label: "Name (Z–A)" },
			{ id: "size-desc", label: "Size (Largest)" },
			{ id: "size-asc", label: "Size (Smallest)" },
		].forEach((s) => {
			const opt = this.sortSelect?.createEl("option", { text: s.label, value: s.id });
			if (opt) opt.selected = s.id === this.sortMode;
		});
		this.sortSelect.addEventListener("change", () => {
			this.sortMode = (this.sortSelect?.value ?? "mtime-desc") as SortMode;
			this.renderViewport(true);
		});

		const excludeToggleBtn = filterRight.createEl("button", {
			cls: `nt-btn-sm ${this.hideExcluded ? "is-active" : ""}`,
		});
		setIcon(excludeToggleBtn.createSpan({ cls: "nt-btn-icon" }), "filter");
		const excludeText = excludeToggleBtn.createSpan({
			text: this.hideExcluded ? "Exclusions On" : "Show All",
		});
		setTooltip(
			excludeToggleBtn,
			this.hideExcluded
				? "Excluded folders/extensions are hidden. Click to show all."
				: "Showing all files. Click to hide excluded.",
		);
		excludeToggleBtn.addEventListener("click", () => {
			this.hideExcluded = !this.hideExcluded;
			excludeToggleBtn.toggleClass("is-active", this.hideExcluded);
			excludeText.setText(this.hideExcluded ? "Exclusions On" : "Show All");
			setTooltip(
				excludeToggleBtn,
				this.hideExcluded
					? "Excluded folders/extensions are hidden. Click to show all."
					: "Showing all files. Click to hide excluded.",
			);
			this.updateExtensionOptions();
			this.renderViewport(true);
		});

		const manageExclusionsBtn = filterRight.createEl("button", { cls: "nt-icon-btn" });
		setIcon(manageExclusionsBtn, "folder-cog");
		setTooltip(manageExclusionsBtn, "Browse & select excluded folders graphically");
		manageExclusionsBtn.addEventListener("click", () => {
			new FolderSelectorModal(
				this.app,
				this.plugin.settings.excludedFolders || [],
				async (selected) => {
					this.plugin.settings.excludedFolders = selected;
					await this.plugin.saveSettings();
					this.updateExtensionOptions();
					this.renderViewport(true);
					new Notice(`Updated excluded folders (${selected.length} excluded).`);
				},
			).open();
		});

		const manageExtBtn = filterRight.createEl("button", { cls: "nt-icon-btn" });
		setIcon(manageExtBtn, "file-cog");
		setTooltip(manageExtBtn, "Browse & select excluded file extensions graphically");
		manageExtBtn.addEventListener("click", () => {
			new ExtensionSelectorModal(
				this.app,
				this.plugin.settings.excludedExtensions || [],
				async (selected) => {
					this.plugin.settings.excludedExtensions = selected;
					await this.plugin.saveSettings();
					this.updateExtensionOptions();
					this.renderViewport(true);
					new Notice(`Updated excluded extensions (${selected.length} excluded).`);
				},
			).open();
		});

		resetBtn.addEventListener("click", () => {
			search.value = "";
			this.searchQuery = "";
			this.selectedFolder = "/ (All Vault)";
			if (this.folderSelect) this.folderSelect.value = "/ (All Vault)";
			this.usageFilter = "all";
			usageSelect.value = "all";
			this.selectedExtension = "all";
			this.sortMode = "mtime-desc";
			if (this.sortSelect) this.sortSelect.value = "mtime-desc";
			this.hideExcluded = true;
			excludeToggleBtn.addClass("is-active");
			excludeText.setText("Exclusions On");
			this.updateExtensionOptions();
			this.renderViewport(true);
		});

		const actionToolbar = contentEl.createDiv({ cls: "nt-actions-toolbar" });

		const selectGroup = actionToolbar.createDiv({ cls: "nt-btn-group" });
		if (this.multiple) {
			selectGroup.createEl("button", { text: "All", cls: "nt-btn-sm" }).addEventListener("click", () => {
				this.currentRenderedFiles.forEach((f) => this.selected.add(f.path));
				this.updateSelectionState();
				this.updateSelectionVisuals();
			});
			selectGroup.createEl("button", { text: "None", cls: "nt-btn-sm" }).addEventListener("click", () => {
				this.selected.clear();
				this.updateSelectionState();
				this.updateSelectionVisuals();
			});
			selectGroup.createEl("button", { text: "Invert", cls: "nt-btn-sm" }).addEventListener("click", () => {
				this.currentRenderedFiles.forEach((f) => {
					if (this.selected.has(f.path)) this.selected.delete(f.path);
					else this.selected.add(f.path);
				});
				this.updateSelectionState();
				this.updateSelectionVisuals();
			});
		} else {
			selectGroup.createSpan({
				cls: "nt-picker-hint",
				text: "Click to select • Double-click or press Enter to choose • Space for Quick Look",
			});
		}

		const opsGroup = actionToolbar.createDiv({ cls: "nt-btn-group" });

		const btnInsert = opsGroup.createEl("button", { cls: "nt-btn-mint" });
		setIcon(btnInsert.createSpan({ cls: "nt-btn-icon" }), this.picker ? "check" : "paperclip");
		btnInsert.createSpan({ text: this.picker ? "Choose" : "Insert" });
		setTooltip(
			btnInsert,
			this.picker
				? "Use selected file"
				: "Insert selected assets into active View, Canvas, or Excalidraw",
		);
		btnInsert.addEventListener("click", () => void this.handleInsertSelected());

		const btnMove = opsGroup.createEl("button", { cls: "nt-btn-sm" });
		setIcon(btnMove.createSpan({ cls: "nt-btn-icon" }), "folder-input");
		btnMove.createSpan({ text: "Move" });
		btnMove.addEventListener("click", () => this.handleMoveSelected());

		if (!this.picker) {
			const btnBatch = opsGroup.createEl("button", { cls: "nt-btn-sm" });
			setIcon(btnBatch.createSpan({ cls: "nt-btn-icon" }), "file-edit");
			btnBatch.createSpan({ text: "Sequence" });
			setTooltip(btnBatch, "Batch sequence rename");
			btnBatch.addEventListener("click", () => this.handleBatchRename());
		}

		const btnRename = opsGroup.createEl("button", { cls: "nt-btn-sm" });
		setIcon(btnRename.createSpan({ cls: "nt-btn-icon" }), "pencil");
		btnRename.createSpan({ text: "Rename" });
		btnRename.addEventListener("click", () => this.handleSingleRename());

		const btnTrash = opsGroup.createEl("button", { cls: "nt-btn-sm mod-warning" });
		setIcon(btnTrash.createSpan({ cls: "nt-btn-icon" }), "trash-2");
		btnTrash.createSpan({ text: "Trash" });
		btnTrash.addEventListener("click", () => this.handleTrashSelected());

		this.viewportWrapper = contentEl.createDiv({ cls: "nt-viewport-wrapper" });
		this.viewportContainer = this.viewportWrapper.createDiv();

		this.galleryResizeObserver = new ResizeObserver(
			debounce(() => this.applyGalleryLayout(), 100),
		);
		this.galleryResizeObserver.observe(this.viewportWrapper);
		this.rowsChangedListener = () => this.applyGalleryLayout();
		window.addEventListener("nt-gallery-rows-changed", this.rowsChangedListener);

		this.scrollTopBtn = this.viewportWrapper.createEl("button", { cls: "nt-scroll-top-btn" });
		setIcon(this.scrollTopBtn.createSpan({ cls: "nt-btn-icon" }), "arrow-up");
		this.scrollTopBtn.createSpan({ text: "Top" });
		this.scrollTopBtn.addEventListener("click", () => {
			this.viewportContainer.scrollTo({ top: 0, behavior: "smooth" });
		});

		this.renderViewport(true);
	}

	private updateExtensionOptions(): void {
		if (!this.extSelect) return;
		this.extSelect.empty();

		const currentExt = this.selectedExtension;
		this.extSelect.createEl("option", { text: "All Extensions", value: "all" });

		const files = this.service.getValidFiles(
			this.category,
			this.selectedFolder,
			this.searchQuery,
			this.sortMode,
			this.usageFilter,
			"all",
			this.hideExcluded,
			false,
			this.pickerAllowedExtensions,
			this.pickerExcludedExtensions,
			this.pickerExcludedFolders,
			true,
		);

		const extCounts = new Map<string, number>();
		files.forEach((f) => {
			const ext = f.extension.toLowerCase();
			extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
		});

		const sortedExts = Array.from(extCounts.keys()).sort();
		sortedExts.forEach((ext) => {
			const opt = this.extSelect?.createEl("option", {
				text: `.${ext.toUpperCase()} (${extCounts.get(ext) ?? 0})`,
				value: ext,
			});
			if (opt) opt.selected = ext === currentExt;
		});
	}

	private updateSelectionState(): void {
		if (!this.badgeEl) return;
		const total = this.currentRenderedFiles.length;
		if (this.selected.size > 0) {
			this.badgeEl.setText(
				`${total} asset${total === 1 ? "" : "s"} • ${this.selected.size} selected`,
			);
		} else {
			this.badgeEl.setText(`${total} asset${total === 1 ? "" : "s"}`);
		}
	}

	private updateSelectionVisuals(): void {
		if (!this.viewportContainer) return;
		const cards = this.viewportContainer.querySelectorAll(".nt-card, .nt-list-row");
		cards.forEach((el) => {
			const path = (el as HTMLElement).dataset.path;
			if (path) {
				el.toggleClass("is-selected", this.selected.has(path));
			}
		});
	}

	private renderViewport(resetScroll = true): void {
		if (this.observer) this.observer.disconnect();
		this.viewportContainer.empty();
		if (resetScroll) this.renderedCount = this.pageSize;

		this.currentRenderedFiles = this.service.getValidFiles(
			this.category,
			this.selectedFolder,
			this.searchQuery,
			this.sortMode,
			this.usageFilter,
			this.selectedExtension,
			this.hideExcluded,
			false,
			this.pickerAllowedExtensions,
			this.pickerExcludedExtensions,
			this.pickerExcludedFolders,
		);

		this.updateSelectionState();

		if (this.currentRenderedFiles.length === 0) {
			this.viewportContainer.className = "nt-empty-wrap";
			const empty = this.viewportContainer.createDiv({ cls: "nt-empty" });
			const emptyIcon = empty.createDiv({ cls: "nt-empty-icon" });
			setIcon(emptyIcon, "search-x");
			empty.createEl("strong", { text: "No matching assets found" });
			empty.createSpan({
				text: "Try adjusting search query, filters, or extension exclusion rules.",
			});
			return;
		}

		if (this.viewMode === "grid") this.renderGridView(resetScroll);
		else this.renderListView(resetScroll);

		let scrollTicking = false;
		this.viewportContainer.onscroll = () => {
			if (scrollTicking) return;
			scrollTicking = true;
			requestAnimationFrame(() => {
				scrollTicking = false;
				if (!this.viewportContainer) return;
				const { scrollTop, clientHeight, scrollHeight } = this.viewportContainer;

				if (this.scrollTopBtn) {
					this.scrollTopBtn.toggleClass("is-visible", scrollTop > 140);
				}

				if (scrollTop + clientHeight >= scrollHeight - 300) {
					if (this.renderedCount < this.currentRenderedFiles.length) {
						const nextBatch = this.currentRenderedFiles.slice(
							this.renderedCount,
							this.renderedCount + this.pageSize,
						);
						const startIndex = this.renderedCount;
						this.renderedCount += nextBatch.length;

						const fragment = document.createDocumentFragment();
						if (this.viewMode === "grid") {
							nextBatch.forEach((file, idx) => {
								const meta = this.service.getBaseMetadata(file);
								this.buildCard(fragment, file, meta, startIndex + idx);
							});
							this.viewportContainer.appendChild(fragment);
						} else {
							const tbody = this.viewportContainer.querySelector("tbody");
							if (tbody) {
								nextBatch.forEach((file, idx) => {
									const meta = this.service.getBaseMetadata(file);
									this.buildListRow(fragment, file, meta, startIndex + idx);
								});
								tbody.appendChild(fragment);
							}
						}
					}
				}
			});
		};
	}

	private renderGridView(resetScroll = true): void {
		this.viewportContainer.className = "nt-grid-viewport";
		if (resetScroll) this.viewportContainer.scrollTop = 0;

		const filesToRender = this.currentRenderedFiles.slice(0, this.renderedCount);
		const fragment = document.createDocumentFragment();
		filesToRender.forEach((file, index) => {
			const meta = this.service.getBaseMetadata(file);
			this.buildCard(fragment, file, meta, index);
		});
		this.viewportContainer.appendChild(fragment);
		this.applyGalleryLayout();
	}

	/**
	 * Applies the configured grid geometry so exactly `galleryRows` rows are
	 * visible per screen with `galleryColumns` columns.
	 */
	private applyGalleryLayout(): void {
		const vp = this.viewportContainer;
		if (!vp || !vp.classList.contains("nt-grid-viewport")) return;
		const rows = Math.max(2, Math.min(6, Number(this.plugin.settings.galleryRows) || 4));
		const GAP = 12;
		const PAD = 12;

		const contentH = vp.clientHeight - PAD * 2;
		if (contentH < 140 || vp.clientWidth < 140) return;

		const rowH = Math.floor((contentH - (rows - 1) * GAP) / rows);
		const cols = Math.max(1, Math.min(12, Number(this.plugin.settings.galleryColumns) || 5));

		vp.style.setProperty("--nt-gallery-rows", String(rows));
		vp.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
		vp.style.gridAutoRows = `${rowH}px`;
	}

	private renderListView(resetScroll = true): void {
		this.viewportContainer.className = "nt-list-viewport";
		if (resetScroll) this.viewportContainer.scrollTop = 0;

		const table = this.viewportContainer.createEl("table", { cls: "nt-list-table" });
		const thead = table.createEl("thead");
		const hrow = thead.createEl("tr");

		hrow.createEl("th", { text: "", cls: "cell-thumb" });

		const thName = hrow.createEl("th", { cls: "nt-sortable-th", text: "Name & Path" });
		if (this.sortMode === "name-asc" || this.sortMode === "name-desc") {
			thName.createSpan({
				cls: "nt-sort-arrow",
				text: this.sortMode === "name-asc" ? " ▲" : " ▼",
			});
		}
		thName.addEventListener("click", () => {
			this.sortMode = this.sortMode === "name-asc" ? "name-desc" : "name-asc";
			if (this.sortSelect) this.sortSelect.value = this.sortMode;
			this.renderViewport(true);
		});

		const thType = hrow.createEl("th", { cls: "nt-sortable-th", text: "Type" });
		if (this.sortMode === "ext-asc" || this.sortMode === "ext-desc") {
			thType.createSpan({
				cls: "nt-sort-arrow",
				text: this.sortMode === "ext-asc" ? " ▲" : " ▼",
			});
		}
		thType.addEventListener("click", () => {
			this.sortMode = this.sortMode === "ext-asc" ? "ext-desc" : "ext-asc";
			if (this.sortSelect) this.sortSelect.value = this.sortMode;
			this.renderViewport(true);
		});

		hrow.createEl("th", { text: "Details" });

		const thSize = hrow.createEl("th", { cls: "nt-sortable-th", text: "Size" });
		if (this.sortMode === "size-desc" || this.sortMode === "size-asc") {
			thSize.createSpan({
				cls: "nt-sort-arrow",
				text: this.sortMode === "size-desc" ? " ▼" : " ▲",
			});
		}
		thSize.addEventListener("click", () => {
			this.sortMode = this.sortMode === "size-desc" ? "size-asc" : "size-desc";
			if (this.sortSelect) this.sortSelect.value = this.sortMode;
			this.renderViewport(true);
		});

		const thDate = hrow.createEl("th", { cls: "nt-sortable-th", text: "Date Modified" });
		if (this.sortMode === "mtime-desc" || this.sortMode === "mtime-asc") {
			thDate.createSpan({
				cls: "nt-sort-arrow",
				text: this.sortMode === "mtime-desc" ? " ▼" : " ▲",
			});
		}
		thDate.addEventListener("click", () => {
			this.sortMode = this.sortMode === "mtime-desc" ? "mtime-asc" : "mtime-desc";
			if (this.sortSelect) this.sortSelect.value = this.sortMode;
			this.renderViewport(true);
		});

		hrow.createEl("th", { text: "Actions", cls: "cell-actions" });

		const tbody = table.createEl("tbody");
		const filesToRender = this.currentRenderedFiles.slice(0, this.renderedCount);
		const fragment = document.createDocumentFragment();

		filesToRender.forEach((file, index) => {
			const meta = this.service.getBaseMetadata(file);
			this.buildListRow(fragment, file, meta, index);
		});
		tbody.appendChild(fragment);
	}

	private buildCard(
		container: DocumentFragment,
		file: TFile,
		meta: MediaMetadata,
		index: number,
	): void {
		const isSelected = this.selected.has(file.path);
		const card = document.createElement("div");
		card.className = `nt-card ${isSelected ? "is-selected" : ""}`;
		container.appendChild(card);

		card.dataset.path = file.path;
		card.dataset.index = String(index);
		card.tabIndex = 0;
		card.setAttribute("draggable", "true");

		card.addEventListener("dragstart", (evt) => {
			if (!evt.dataTransfer) return;
			const draggedFiles = this.selected.has(file.path) ? this.getSelectedFiles() : [file];
			const activeFilePath = this.app.workspace.getActiveFile()?.path ?? "";
			const links = draggedFiles
				.map((f) => {
					const link = this.app.fileManager.generateMarkdownLink(f, activeFilePath);
					return link.startsWith("!") ? link : `!${link}`;
				})
				.join("\n");

			evt.dataTransfer.setData("text/plain", links);
			evt.dataTransfer.setData("text/uri-list", this.app.vault.getResourcePath(file));
		});

		const checkBadge = card.createDiv({ cls: "nt-card-check" });
		setIcon(checkBadge, "check");

		const thumb = card.createDiv({ cls: "nt-card-thumb" });
		if (meta.type === "image") {
			thumb.createEl("img", {
				attr: { src: this.app.vault.getResourcePath(file), loading: "lazy", alt: file.name },
			});
		} else if (meta.type === "video") {
			const badge = thumb.createDiv({ cls: "nt-badge-media mod-video" });
			setIcon(badge.createDiv({ cls: "nt-badge-icon" }), "video");
			badge.createSpan({ text: "VIDEO" });
		} else if (meta.type === "audio") {
			const badge = thumb.createDiv({ cls: "nt-badge-media mod-audio" });
			setIcon(badge.createDiv({ cls: "nt-badge-icon" }), "music");
			badge.createSpan({ text: "AUDIO" });
		} else {
			const badge = thumb.createDiv({ cls: "nt-badge-media mod-doc" });
			setIcon(badge.createDiv({ cls: "nt-badge-icon" }), "file-text");
			badge.createSpan({ text: meta.ext });
		}

		const metaWrap = card.createDiv({ cls: "nt-card-details" });
		const title = metaWrap.createDiv({ cls: "nt-card-title", text: file.name });
		setTooltip(title, file.path);

		const chips = metaWrap.createDiv({ cls: "nt-card-meta-chips" });
		chips.createSpan({ cls: "nt-tag-chip", text: meta.ext });

		const cached = this.service.cache.get(file.path);
		const detailText = cached?.detail || meta.detail;
		const detailTag = chips.createSpan({
			cls: `nt-tag-chip nt-detail-tag ${detailText ? "" : "nt-hidden"}`,
		});
		if (detailText) detailTag.setText(detailText);

		chips.createSpan({ cls: "nt-tag-chip", text: meta.size });

		card.addEventListener("click", (evt) => {
			this.handleCardClick(evt, index, file, card);
		});

		card.addEventListener("dblclick", () => {
			if (this.picker) this.resolvePicker([file]);
			else void this.insertTargetFile(file, 0, true);
		});

		card.addEventListener("keydown", (evt) => {
			if (evt.key === " ") {
				evt.preventDefault();
				void this.openQuickLook(file);
			} else if (evt.key === "Enter") {
				evt.preventDefault();
				if (this.picker) this.resolvePicker([file]);
				else void this.insertTargetFile(file, 0, true);
			} else if (evt.key === "ArrowRight") {
				evt.preventDefault();
				const next = card.nextElementSibling;
				if (next && next.classList.contains("nt-card") && next instanceof HTMLElement) {
					next.focus();
				}
			} else if (evt.key === "ArrowLeft") {
				evt.preventDefault();
				const prev = card.previousElementSibling;
				if (prev && prev.classList.contains("nt-card") && prev instanceof HTMLElement) {
					prev.focus();
				}
			}
		});

		card.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.showContextMenu(evt, file, meta);
		});

		if (this.observer) this.observer.observe(card);
	}

	private buildListRow(
		container: DocumentFragment,
		file: TFile,
		meta: MediaMetadata,
		index: number,
	): void {
		const isSelected = this.selected.has(file.path);
		const row = document.createElement("tr");
		row.className = `nt-list-row ${isSelected ? "is-selected" : ""}`;
		container.appendChild(row);

		row.dataset.path = file.path;
		row.dataset.index = String(index);

		const thumbCell = row.createEl("td", { cls: "nt-list-cell cell-thumb" });
		const miniThumb = thumbCell.createDiv({ cls: "nt-list-mini-thumb" });
		if (meta.type === "image") {
			miniThumb.createEl("img", {
				attr: { src: this.app.vault.getResourcePath(file), loading: "lazy", alt: file.name },
			});
		} else if (meta.type === "video") {
			setIcon(miniThumb, "video");
		} else if (meta.type === "audio") {
			setIcon(miniThumb, "music");
		} else {
			setIcon(miniThumb, "file-text");
		}

		const nameCell = row.createEl("td", { cls: "nt-list-cell" });
		const nameCol = nameCell.createDiv({ cls: "nt-list-name-col" });
		nameCol.createDiv({ cls: "nt-list-name", text: file.name });
		const pathEl = nameCol.createDiv({ cls: "nt-list-path", text: file.path });
		setTooltip(pathEl, "Click to filter to this folder");
		pathEl.addEventListener("click", (evt) => {
			evt.stopPropagation();
			const parentFolder = file.parent ? file.parent.path : "/ (All Vault)";
			this.selectedFolder = parentFolder;
			if (this.folderSelect) this.folderSelect.value = parentFolder;
			this.updateExtensionOptions();
			this.renderViewport(true);
		});

		row.createEl("td", { cls: "nt-list-cell", text: meta.ext });

		const detailCell = row.createEl("td", {
			cls: "nt-list-cell nt-detail-tag",
			text: meta.detail || "—",
		});
		const cached = this.service.cache.get(file.path);
		if (cached?.detail) detailCell.setText(cached.detail);

		row.createEl("td", { cls: "nt-list-cell", text: meta.size });

		const mdate = new Date(meta.mtime).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
		row.createEl("td", { cls: "nt-list-cell", text: mdate });

		const actionCell = row.createEl("td", { cls: "nt-list-cell cell-actions" });
		const actionWrap = actionCell.createDiv({ cls: "nt-list-row-actions" });

		const btnInsert = actionWrap.createEl("button", { cls: "nt-icon-btn" });
		setIcon(btnInsert, this.picker ? "check" : "paperclip");
		setTooltip(btnInsert, this.picker ? "Choose" : "Insert to active view");
		btnInsert.addEventListener("click", (evt) => {
			evt.stopPropagation();
			if (this.picker) this.resolvePicker([file]);
			else void this.insertTargetFile(file, 0, true);
		});

		const btnEye = actionWrap.createEl("button", { cls: "nt-icon-btn" });
		setIcon(btnEye, "eye");
		setTooltip(btnEye, "Quick Look");
		btnEye.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void this.openQuickLook(file);
		});

		const btnCopy = actionWrap.createEl("button", { cls: "nt-icon-btn" });
		setIcon(btnCopy, "copy");
		setTooltip(btnCopy, "Copy Markdown Link");
		btnCopy.addEventListener(
			"click",
			voidAsync(async (evt: MouseEvent) => {
				evt.stopPropagation();
				let link = this.app.fileManager.generateMarkdownLink(file, "");
				if (meta.type !== "document" && !link.startsWith("!")) link = `!${link}`;
				await navigator.clipboard.writeText(link);
				new Notice("Link copied to clipboard.");
			}),
		);

		const btnTrash = actionWrap.createEl("button", { cls: "nt-icon-btn mod-warning" });
		setIcon(btnTrash, "trash-2");
		setTooltip(btnTrash, "Move to trash");
		btnTrash.addEventListener("click", (evt) => {
			evt.stopPropagation();
			new ConfirmModal(this.app, {
				title: `Move "${file.name}" to Trash?`,
				message: "Are you sure you want to move this file to your vault trash?",
				confirmText: "Move to Trash",
				isDanger: true,
				onConfirm: async () => {
					await this.app.fileManager.trashFile(file);
					this.service.cache.delete(file.path);
					this.selected.delete(file.path);
					this.updateSelectionState();
					this.renderViewport(false);
					new Notice(`Moved "${file.name}" to trash.`);
				},
			}).open();
		});

		row.addEventListener("click", (evt) => {
			this.handleCardClick(evt, index, file, row);
		});

		row.addEventListener("dblclick", () => {
			if (this.picker) this.resolvePicker([file]);
			else void this.insertTargetFile(file, 0, true);
		});

		row.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			this.showContextMenu(evt, file, meta);
		});

		if (this.observer) this.observer.observe(row);
	}

	private handleCardClick(
		evt: MouseEvent,
		index: number,
		file: TFile,
		element: HTMLElement,
	): void {
		if (!this.multiple) {
			const already = this.selected.has(file.path);
			this.selected.clear();
			this.viewportContainer.querySelectorAll(".is-selected").forEach((el) => {
				el.removeClass("is-selected");
			});
			if (!already) {
				this.selected.add(file.path);
				element.addClass("is-selected");
			}
			this.lastClickedIndex = index;
			this.updateSelectionState();
			return;
		}

		if (evt.shiftKey && this.lastClickedIndex !== null && this.lastClickedIndex !== index) {
			const start = Math.min(this.lastClickedIndex, index);
			const end = Math.max(this.lastClickedIndex, index);
			const targetMode = !this.selected.has(file.path);

			for (let i = start; i <= end; i++) {
				const item = this.currentRenderedFiles[i];
				if (item) {
					if (targetMode) this.selected.add(item.path);
					else this.selected.delete(item.path);
				}
			}
			this.updateSelectionState();
			this.updateSelectionVisuals();
		} else {
			if (this.selected.has(file.path)) {
				this.selected.delete(file.path);
				element.removeClass("is-selected");
			} else {
				this.selected.add(file.path);
				element.addClass("is-selected");
			}
			this.lastClickedIndex = index;
			this.updateSelectionState();
		}
	}

	private showContextMenu(evt: MouseEvent, file: TFile, meta: MediaMetadata): void {
		const menu = new Menu();

		menu.addItem((item) => {
			item
				.setTitle(this.picker ? "Choose This File" : "Insert to Active View")
				.setIcon(this.picker ? "check" : "paperclip")
				.onClick(() => {
					if (this.picker) this.resolvePicker([file]);
					else void this.insertTargetFile(file, 0, true);
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("Quick Look Preview")
				.setIcon("eye")
				.onClick(() => void this.openQuickLook(file));
		});

		menu.addItem((item) => {
			item
				.setTitle("Copy Markdown Link")
				.setIcon("copy")
				.onClick(async () => {
					const activePath = this.app.workspace.getActiveFile()?.path ?? "";
					let link = this.app.fileManager.generateMarkdownLink(file, activePath);
					if (meta.type !== "document" && !link.startsWith("!")) link = `!${link}`;
					await navigator.clipboard.writeText(link);
					new Notice("Link copied to clipboard.");
				});
		});

		menu.addSeparator();

		if (file.parent && file.parent.path !== "/") {
			const parentPath = file.parent.path;
			menu.addItem((item) => {
				item
					.setTitle(`Exclude Folder "${file.parent?.name ?? parentPath}"`)
					.setIcon("folder-minus")
					.onClick(async () => {
						const ex = this.plugin.settings.excludedFolders || [];
						if (!ex.includes(parentPath)) {
							ex.push(parentPath);
							this.plugin.settings.excludedFolders = ex;
							await this.plugin.saveSettings();
							new Notice(`Excluded folder "${parentPath}".`);
							this.renderViewport(true);
						}
					});
			});

			menu.addItem((item) => {
				item
					.setTitle(`Focus Folder "${file.parent?.name ?? parentPath}" Only`)
					.setIcon("folder")
					.onClick(() => {
						this.selectedFolder = parentPath;
						if (this.folderSelect) this.folderSelect.value = parentPath;
						this.updateExtensionOptions();
						this.renderViewport(true);
					});
			});
		}

		menu.addItem((item) => {
			item
				.setTitle(`Exclude Extension (.${file.extension.toLowerCase()})`)
				.setIcon("file-minus")
				.onClick(async () => {
					const ext = file.extension.toLowerCase();
					const ex = this.plugin.settings.excludedExtensions || [];
					if (!ex.includes(ext)) {
						ex.push(ext);
						this.plugin.settings.excludedExtensions = ex;
						await this.plugin.saveSettings();
						new Notice(`Excluded .${ext} files.`);
						this.updateExtensionOptions();
						this.renderViewport(true);
					}
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("Browse & Select Excluded Folders...")
				.setIcon("folder-cog")
				.onClick(() => {
					new FolderSelectorModal(
						this.app,
						this.plugin.settings.excludedFolders || [],
						async (selected) => {
							this.plugin.settings.excludedFolders = selected;
							await this.plugin.saveSettings();
							this.updateExtensionOptions();
							this.renderViewport(true);
							new Notice(`Updated excluded folders (${selected.length} excluded).`);
						},
					).open();
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("Browse & Select Excluded Extensions...")
				.setIcon("file-cog")
				.onClick(() => {
					new ExtensionSelectorModal(
						this.app,
						this.plugin.settings.excludedExtensions || [],
						async (selected) => {
							this.plugin.settings.excludedExtensions = selected;
							await this.plugin.saveSettings();
							this.updateExtensionOptions();
							this.renderViewport(true);
							new Notice(`Updated excluded extensions (${selected.length} excluded).`);
						},
					).open();
				});
		});

		menu.addSeparator();

		const shellApp = this.app as unknown as {
			showInFolder?: (path: string) => void;
			openWithDefaultApp?: (path: string) => void;
		};

		if (typeof shellApp.showInFolder === "function") {
			menu.addItem((item) => {
				item
					.setTitle("Show in System Explorer")
					.setIcon("folder")
					.onClick(() => shellApp.showInFolder?.(file.path));
			});
		}

		if (typeof shellApp.openWithDefaultApp === "function") {
			menu.addItem((item) => {
				item
					.setTitle("Open with Default App")
					.setIcon("external-link")
					.onClick(() => shellApp.openWithDefaultApp?.(file.path));
			});
		}

		menu.addSeparator();

		menu.addItem((item) => {
			item
				.setTitle("Rename")
				.setIcon("pencil")
				.onClick(() => {
					this.selected.clear();
					this.selected.add(file.path);
					this.handleSingleRename();
				});
		});

		menu.addItem((item) => {
			item
				.setTitle("Move to Trash")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => {
					new ConfirmModal(this.app, {
						title: `Move "${file.name}" to Trash?`,
						message: "Are you sure you want to move this file to your vault trash?",
						confirmText: "Move to Trash",
						isDanger: true,
						onConfirm: async () => {
							await this.app.fileManager.trashFile(file);
							this.service.cache.delete(file.path);
							this.selected.delete(file.path);
							this.updateSelectionState();
							this.renderViewport(false);
							new Notice(`Moved "${file.name}" to trash.`);
						},
					}).open();
				});
		});

		menu.showAtMouseEvent(evt);
	}

	private async openQuickLook(file: TFile): Promise<void> {
		const fullMeta = await this.service.getFullMetadata(file);
		new QuickLookModal(
			this.app,
			file,
			fullMeta,
			(target) => {
				if (this.picker) this.resolvePicker([target]);
				else void this.insertTargetFile(target, 0, true);
			},
			this.picker ? "Choose" : "Insert / Attach",
		).open();
	}

	private resolvePicker(files: TFile[]): void {
		if (!this.picker || !files.length) return;
		const first = files[0];
		if (!first) return;

		this.resolved = true;
		const chosen: TFile | TFile[] = this.multiple ? files : first;
		const chosenPath: string | string[] = this.multiple ? files.map((f) => f.path) : first.path;
		const richPayload = Array.isArray(chosen)
			? this.plugin.createAssetPayload(chosen)
			: this.plugin.createAssetPayload(chosen);

		this.close();
		this.picker.onSelect(chosen, chosenPath, richPayload);
	}

	private async insertTargetFile(
		file: TFile,
		offsetIndex = 0,
		closeAfter = true,
	): Promise<string> {
		if (this.picker) {
			this.resolvePicker([file]);
			return "picker";
		}

		const targetView = this.targetLeaf?.view ?? this.app.workspace.getActiveViewOfType(MarkdownView);
		const viewType = targetView?.getViewType();

		if (viewType === "canvas" && targetView) {
			const canvas = (targetView as unknown as { canvas?: CanvasLike }).canvas;
			if (canvas && typeof canvas.createFileNode === "function") {
				const step = offsetIndex * 28;
				const x = (canvas.x ?? 0) + (canvas.zoom ? (80 + step) / canvas.zoom : 50 + step);
				const y = (canvas.y ?? 0) + (canvas.zoom ? (80 + step) / canvas.zoom : 50 + step);

				canvas.createFileNode({
					file,
					pos: { x, y },
					size: { width: 340, height: 280 },
					save: true,
				});
				canvas.requestSave?.();
				if (closeAfter) {
					new Notice(`Added "${file.name}" to Canvas.`);
					this.close();
				}
				return "canvas";
			}
		}

		if (viewType === "excalidraw" && targetView) {
			const plugins = (
				this.app as unknown as {
					plugins?: { plugins?: Record<string, { ea?: ExcalidrawApi } | undefined> };
				}
			).plugins;
			const excalPlugin = plugins?.plugins?.["obsidian-excalidraw-plugin"];
			const ea = excalPlugin?.ea;
			if (ea) {
				try {
					ea.reset();
					ea.setView(targetView);
					const pos = offsetIndex * 24;
					const isImg = getExtensions().images.has(file.extension.toLowerCase());
					if (isImg && typeof ea.addImage === "function") {
						await ea.addImage(pos, pos, file);
					} else if (typeof ea.addEmbeddable === "function") {
						await ea.addEmbeddable(pos, pos, 420, 320, null, file);
					}
					await ea.addElementsToView(true, true);
					if (closeAfter) {
						new Notice(`Inserted "${file.name}" into Excalidraw.`);
						this.close();
					}
					return "excalidraw";
				} catch (err) {
					console.error("Excalidraw insert failed", err);
				}
			}
		}

		if (targetView instanceof MarkdownView && targetView.editor) {
			const activePath = targetView.file?.path ?? "";
			let link = this.app.fileManager.generateMarkdownLink(file, activePath);
			const type = getCategory(file);
			if (type !== "document" && !link.startsWith("!")) link = `!${link}`;
			targetView.editor.replaceSelection(`${link}\n`);
			if (closeAfter) {
				new Notice(`Inserted: ${file.name}`);
				this.close();
			}
			return "markdown";
		}

		if (closeAfter) {
			let link = this.app.fileManager.generateMarkdownLink(file, "");
			if (getCategory(file) !== "document" && !link.startsWith("!")) link = `!${link}`;
			await navigator.clipboard.writeText(link);
			new Notice(`Copied "${link}" to clipboard.`);
			this.close();
		}
		return "clipboard";
	}

	private getSelectedFiles(): TFile[] {
		const files: TFile[] = [];
		for (const path of this.selected) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) files.push(file);
		}
		return files;
	}

	private async handleInsertSelected(): Promise<void> {
		const files = this.getSelectedFiles();
		if (!files.length) {
			new Notice(this.picker ? "Select a file first." : "Select files to insert.");
			return;
		}

		if (this.picker) {
			this.resolvePicker(files);
			return;
		}

		const targetView = this.targetLeaf?.view ?? this.app.workspace.getActiveViewOfType(MarkdownView);
		if (targetView instanceof MarkdownView && targetView.editor) {
			const activePath = targetView.file?.path ?? "";
			const textToInsert =
				files
					.map((f) => {
						let link = this.app.fileManager.generateMarkdownLink(f, activePath);
						if (getCategory(f) !== "document" && !link.startsWith("!")) link = `!${link}`;
						return link;
					})
					.join("\n") + "\n";

			targetView.editor.replaceSelection(textToInsert);
			new Notice(`Inserted ${files.length} asset(s).`);
			this.close();
			return;
		}

		let mode = "";
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (!file) continue;
			mode = await this.insertTargetFile(file, i, false);
		}

		if (mode === "clipboard") {
			const links = files
				.map((f) => {
					let link = this.app.fileManager.generateMarkdownLink(f, "");
					if (getCategory(f) !== "document" && !link.startsWith("!")) link = `!${link}`;
					return link;
				})
				.join("\n");
			await navigator.clipboard.writeText(links);
			new Notice(`Copied ${files.length} link(s) to clipboard.`);
		} else {
			new Notice(`Inserted ${files.length} asset(s).`);
		}
		this.close();
	}

	private handleMoveSelected(): void {
		const files = this.getSelectedFiles();
		if (!files.length) {
			new Notice("Select files to move.");
			return;
		}

		new SelectFolderModal(this.app, this.service.getAllFolders(), async (targetFolder) => {
			try {
				const moved = await this.service.moveFiles(files, targetFolder);
				this.selected.clear();
				this.updateSelectionState();
				new Notice(`Moved ${moved} file(s).`);
				this.renderViewport(false);
			} catch (err) {
				new Notice(`Move failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		}).open();
	}

	private handleSingleRename(): void {
		const files = this.getSelectedFiles();
		if (files.length !== 1) {
			new Notice("Select exactly 1 file to rename.");
			return;
		}

		const file = files[0];
		if (!file) return;
		new InputPromptModal(
			this.app,
			"Rename File",
			`Current: ${file.name}`,
			file.basename,
			async (newName) => {
				try {
					const oldPath = file.path;
					const sanitized = newName.replace(/[\\/:*?"<>|]/g, "_").trim();
					if (!sanitized) return;

					const parentPath = file.parent ? file.parent.path : "";
					const newPath = normalizePath(
						parentPath
							? `${parentPath}/${sanitized}.${file.extension}`
							: `${sanitized}.${file.extension}`,
					);

					if (newPath !== oldPath) {
						await this.app.fileManager.renameFile(file, newPath);
						this.service.cache.delete(oldPath);
						this.selected.clear();
						this.selected.add(newPath);
						this.updateSelectionState();
						new Notice("File renamed.");
						this.renderViewport(false);
					}
				} catch (err) {
					new Notice(`Rename failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			},
		).open();
	}

	private handleBatchRename(): void {
		const files = this.getSelectedFiles();
		if (!files.length) {
			new Notice("Select files to rename.");
			return;
		}

		new InputPromptModal(
			this.app,
			`Batch Rename (${files.length} files)`,
			"Tokens: {folder} = parent folder, {n} = index, {name} = original name",
			"{folder}_{n}",
			async (pattern) => {
				try {
					const renamed = await this.service.batchRename(files, pattern);
					this.selected.clear();
					this.updateSelectionState();
					new Notice(`Renamed ${renamed} file(s).`);
					this.renderViewport(false);
				} catch (err) {
					new Notice(
						`Batch rename failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			},
		).open();
	}

	private handleTrashSelected(): void {
		const files = this.getSelectedFiles();
		if (!files.length) {
			new Notice("Select files to trash.");
			return;
		}

		new ConfirmModal(this.app, {
			title: `Move ${files.length} file(s) to Trash?`,
			message: `Are you sure you want to move ${
				files.length === 1 ? `"${files[0]?.name ?? ""}"` : `${files.length} selected files`
			} to your vault trash?`,
			confirmText: "Move to Trash",
			isDanger: true,
			onConfirm: async () => {
				let count = 0;
				for (const file of files) {
					try {
						await this.app.fileManager.trashFile(file);
						this.service.cache.delete(file.path);
						count++;
					} catch (err) {
						console.error(`Failed to trash "${file.path}":`, err);
					}
				}
				this.selected.clear();
				this.updateSelectionState();
				new Notice(`Moved ${count} file(s) to trash.`);
				this.renderViewport(false);
			},
		}).open();
	}

	onClose(): void {
		if (this.observer) this.observer.disconnect();
		if (this.galleryResizeObserver) {
			this.galleryResizeObserver.disconnect();
			this.galleryResizeObserver = null;
		}
		if (this.rowsChangedListener) {
			window.removeEventListener("nt-gallery-rows-changed", this.rowsChangedListener);
			this.rowsChangedListener = null;
		}
		this.contentEl.empty();
		if (this.picker && !this.resolved && typeof this.picker.onCancel === "function") {
			this.picker.onCancel();
		}
	}
}
