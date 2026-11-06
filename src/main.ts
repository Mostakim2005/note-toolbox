import { Plugin, Notice, normalizePath, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings";
import type { NoteToolboxSettings } from "./types";
// Pilot entry ported from Nihon 1.1.0 bundle (3424 lines).
// Full split (MediaService, MediaToolboxModal, DropdownManager, InlineDropdownProcessor) is incremental — see README parity checklist.
export default class NoteToolboxPlugin extends Plugin {
	settings!: NoteToolboxSettings;
	service: any = null;

	applyThemePreferences() {
		if (typeof document !== "undefined") {
			document.body.toggleClass("nt-glassmorphic", Boolean(this.settings.glassmorphism ?? true));
		}
	}

	async onload() {
		await this.loadSettings();
		this.applyThemePreferences();
		console.warn("[note-toolbox] MediaService/UI split pending — entry lifecycle only in pilot.");

		this.addCommand({
			id: "open-media-toolbox",
			name: "Open Media Toolbox",
			callback: () => new Notice("Media Toolbox port in progress — see README parity section."),
		});

		this.addCommand({
			id: "open-dropdown-manager",
			name: "Manage Inline Dropdowns",
			callback: () => new Notice("Dropdown manager port in progress — see README parity section."),
		});

		this.addRibbonIcon("layout-grid", "Open Media Toolbox", () => {
			new Notice("Note Toolbox — pilot build.");
		});

		this.addSettingTab(new NoteToolboxSettingPlaceholder(this.app, this));
	}

	onunload() {
		if (typeof document !== "undefined") document.body.removeClass("nt-glassmorphic");
		document.querySelectorAll(".nt-canvas-overlay-btn").forEach((el) => el.remove());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!Array.isArray(this.settings.excludedFolders)) this.settings.excludedFolders = [];
		if (!Array.isArray(this.settings.excludedExtensions)) this.settings.excludedExtensions = [];
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

import { PluginSettingTab, App } from "obsidian";
class NoteToolboxSettingPlaceholder extends PluginSettingTab {
	constructor(app: App, private plugin: NoteToolboxPlugin) {
		super(app, plugin);
	}
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Note Toolbox — pilot" });
		containerEl.createEl("p", { text: "Full settings UI port is next split step. Defaults match Nihon 1.1.0." });
	}
}
