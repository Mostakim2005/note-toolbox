import { Notice, Plugin, TFile, TFolder, setIcon, setTooltip } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings";
import type {
	AssetPayload,
	ChooserOptions,
	NoteToolboxSettings,
	PickerSelectHandler,
} from "./types";
import { MediaService } from "./media";
import { InlineDropdownProcessor } from "./dropdown";
import { debounce, getCategory } from "./fuzzy";
import { MediaToolboxModal } from "./media-toolbox";
import { DropdownManagerModal } from "./dropdown-manager-modal";
import { NoteToolboxSettingTab } from "./settings-tab";

/**
 * NoteToolboxPlugin — lifecycle, commands, overlays, and the inter-plugin
 * chooser API. Faithful entry port of Nihon main.js L3216+.
 */
export default class NoteToolboxPlugin extends Plugin {
	settings!: NoteToolboxSettings;
	service!: MediaService;

	applyThemePreferences(): void {
		if (typeof document !== "undefined") {
			document.body.toggleClass(
				"nt-glassmorphic",
				Boolean(this.settings.glassmorphism ?? true),
			);
		}
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyThemePreferences();
		this.service = new MediaService(this.app, this.settings);

		this.addCommand({
			id: "open-media-toolbox",
			name: "Open Media Toolbox",
			callback: () => {
				new MediaToolboxModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: "open-dropdown-manager",
			name: "Manage Inline Dropdowns",
			callback: () => {
				new DropdownManagerModal(this.app, this).open();
			},
		});

		this.registerAliases();

		this.addRibbonIcon("layout-grid", "Open Media Toolbox", () => {
			new MediaToolboxModal(this.app, this).open();
		});

		const debouncedInject = debounce(() => this.injectOverlayButtons(), 150);
		this.registerEvent(this.app.workspace.on("layout-change", debouncedInject));
		this.registerEvent(this.app.workspace.on("active-leaf-change", debouncedInject));
		this.injectOverlayButtons();

		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.service.clearLinkedCache();
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.service.clearLinkedCache();
				if (file instanceof TFile) {
					this.service.cache.delete(file.path);
				} else if (file instanceof TFolder) {
					this.service.purgeFolder(file.path);
				}
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.service.clearLinkedCache();
				if (file instanceof TFolder) {
					this.service.purgeFolder(oldPath);
				} else {
					this.service.cache.delete(oldPath);
				}
			}),
		);

		const processor = new InlineDropdownProcessor(this);
		this.registerMarkdownPostProcessor((el, ctx) => processor.process(el, ctx));

		this.addSettingTab(new NoteToolboxSettingTab(this.app, this));
	}

	createAssetPayload(target: TFile): AssetPayload;
	createAssetPayload(target: TFile[]): AssetPayload[];
	createAssetPayload(target: TFile | TFile[]): AssetPayload | AssetPayload[] {
		const createOne = (file: TFile): AssetPayload => {
			const metadata = this.service.getBaseMetadata(file);
			return {
				file,
				path: file.path,
				name: file.name,
				basename: file.basename,
				extension: file.extension,
				size: file.stat.size,
				formattedSize: metadata.size,
				category: getCategory(file),
				resourceUrl: this.app.vault.getResourcePath(file),
				markdownLink: this.app.fileManager.generateMarkdownLink(file, ""),
				metadata,
			};
		};

		return Array.isArray(target) ? target.map(createOne) : createOne(target);
	}

	openPicker(options: ChooserOptions = {}): MediaToolboxModal {
		const modal = new MediaToolboxModal(this.app, this, null, {
			category: options.category || "all",
			lockCategory:
				options.lockCategory ?? Boolean(options.category && options.category !== "all"),
			multiple: Boolean(options.multiple),
			title: options.title || "",
			initialFolder: options.initialFolder || "/ (All Vault)",
			allowedExtensions: options.allowedExtensions ?? undefined,
			excludeExtensions: options.excludeExtensions ?? undefined,
			excludeFolders: options.excludeFolders ?? undefined,
			onSelect: options.onSelect,
			onCancel: options.onCancel,
		});
		modal.open();
		return modal;
	}

	openImagePicker(onSelect: PickerSelectHandler, options: ChooserOptions = {}): MediaToolboxModal {
		return this.openPicker({
			...options,
			category: "image",
			lockCategory: options.lockCategory ?? true,
			onSelect,
		});
	}

	openVideoPicker(onSelect: PickerSelectHandler, options: ChooserOptions = {}): MediaToolboxModal {
		return this.openPicker({
			...options,
			category: "video",
			lockCategory: options.lockCategory ?? true,
			onSelect,
		});
	}

	openAudioPicker(onSelect: PickerSelectHandler, options: ChooserOptions = {}): MediaToolboxModal {
		return this.openPicker({
			...options,
			category: "audio",
			lockCategory: options.lockCategory ?? true,
			onSelect,
		});
	}

	openDocumentPicker(
		onSelect: PickerSelectHandler,
		options: ChooserOptions = {},
	): MediaToolboxModal {
		return this.openPicker({
			...options,
			category: "document",
			lockCategory: options.lockCategory ?? true,
			onSelect,
		});
	}

	pickFile(
		options: ChooserOptions = {},
	): Promise<TFile | TFile[] | AssetPayload | AssetPayload[] | null> {
		return new Promise((resolve) => {
			this.openPicker({
				...options,
				onSelect: (result, _path, payload) => {
					resolve(options.returnPayload ? payload : result);
				},
				onCancel: () => resolve(null),
			});
		});
	}

	pickAsset(options: ChooserOptions = {}): Promise<AssetPayload | AssetPayload[] | null> {
		return this.pickFile({ ...options, returnPayload: true }) as Promise<
			AssetPayload | AssetPayload[] | null
		>;
	}

	registerAliases(): void {
		const raw = this.settings.customAliases || "attach, media, pick";
		const aliases = raw
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);

		aliases.forEach((alias) => {
			this.addCommand({
				id: `cmd-alias-${alias}`,
				name: alias,
				callback: () => {
					new MediaToolboxModal(this.app, this).open();
				},
			});
		});
	}

	injectOverlayButtons(): void {
		const leaves = this.app.workspace
			.getLeavesOfType("canvas")
			.concat(this.app.workspace.getLeavesOfType("excalidraw"));

		leaves.forEach((leaf) => {
			const container = leaf.view?.containerEl;
			if (!container || container.querySelector(".nt-canvas-overlay-btn")) return;

			const overlayBtn = container.createDiv({ cls: "nt-canvas-overlay-btn" });
			setIcon(overlayBtn, "layout-grid");
			const viewName = leaf.view.getViewType() === "canvas" ? "Canvas" : "Excalidraw";
			setTooltip(overlayBtn, `Insert Asset to ${viewName}`);

			overlayBtn.addEventListener("click", (evt) => {
				evt.stopPropagation();
				new MediaToolboxModal(this.app, this, leaf).open();
			});
		});
	}

	onunload(): void {
		if (typeof document !== "undefined") {
			document.body.removeClass("nt-glassmorphic");
		}
		document.querySelectorAll(".nt-canvas-overlay-btn").forEach((el) => el.remove());
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<NoteToolboxSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (!Array.isArray(this.settings.excludedFolders)) this.settings.excludedFolders = [];
		if (!Array.isArray(this.settings.excludedExtensions)) this.settings.excludedExtensions = [];
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

// Re-exported for consumers that import the plugin type from main.
export { Notice };
