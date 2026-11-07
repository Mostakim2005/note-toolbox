import { PluginSettingTab, Setting, setIcon, setTooltip, type App, type TextAreaComponent } from "obsidian";
import type NoteToolboxPlugin from "./main";
import { DropdownManagerUI } from "./dropdown-manager";
import { ExtensionSelectorModal, FolderSelectorModal } from "./exclusions";
import { voidAsync } from "./async";

/** Full settings tab with visual exclusion chips and the dropdown builder. */
export class NoteToolboxSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: NoteToolboxPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default View Mode")
			.setDesc("Choose whether the media toolbox opens in Grid View or List View by default.")
			.addDropdown((dd) => {
				dd.addOption("grid", "Grid View (Thumbnails)")
					.addOption("list", "List View (Table)")
					.setValue(this.plugin.settings.defaultViewMode || "grid")
					.onChange(async (val) => {
						this.plugin.settings.defaultViewMode = val === "list" ? "list" : "grid";
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Gallery Rows")
			.setDesc(
				"Number of thumbnail rows visible in the Media Toolbox gallery view. Applies to open windows instantly.",
			)
			.addDropdown((dd) => {
				dd.addOption("2", "2 rows")
					.addOption("3", "3 rows")
					.addOption("4", "4 rows")
					.addOption("5", "5 rows")
					.addOption("6", "6 rows")
					.setValue(String(this.plugin.settings.galleryRows || 4))
					.onChange(async (val) => {
						this.plugin.settings.galleryRows = Number(val) || 4;
						await this.plugin.saveSettings();
						window.dispatchEvent(new CustomEvent("nt-gallery-rows-changed"));
					});
			});

		new Setting(containerEl)
			.setName("Gallery Columns")
			.setDesc(
				"Number of thumbnail columns in the Media Toolbox grid view. Fewer columns = larger previews.",
			)
			.addDropdown((dd) => {
				dd.addOption("2", "2 columns")
					.addOption("3", "3 columns")
					.addOption("4", "4 columns")
					.addOption("5", "5 columns")
					.addOption("6", "6 columns")
					.addOption("7", "7 columns")
					.addOption("8", "8 columns")
					.setValue(String(this.plugin.settings.galleryColumns || 5))
					.onChange(async (val) => {
						this.plugin.settings.galleryColumns = Number(val) || 5;
						await this.plugin.saveSettings();
						window.dispatchEvent(new CustomEvent("nt-gallery-rows-changed"));
					});
			});

		new Setting(containerEl)
			.setName("Frosted Glassmorphism Theme")
			.setDesc(
				"Enable translucent glass panels with frosted blur backdrops and subtle luminous borders across all Note Toolbox modals and cards.",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.glassmorphism ?? true).onChange(async (val) => {
					this.plugin.settings.glassmorphism = val;
					await this.plugin.saveSettings();
					this.plugin.applyThemePreferences();
				});
			});

		new Setting(containerEl)
			.setName("Custom Command Aliases")
			.setDesc("Comma-separated short keywords for the command palette and slash (/) menu.")
			.addText((text) => {
				text
					.setPlaceholder("e.g. attach, media, pick, gallery")
					.setValue(this.plugin.settings.customAliases || "")
					.onChange(async (val) => {
						this.plugin.settings.customAliases = val;
						await this.plugin.saveSettings();
						this.plugin.registerAliases();
					});
			});

		let rawFolderInput: TextAreaComponent | null = null;

		new Setting(containerEl)
			.setName("Excluded Folders")
			.setDesc(
				"Folders completely ignored by Note Toolbox. Browse & pick graphically, or edit manually.",
			)
			.addButton((btn) => {
				btn
					.setButtonText("Select Folders...")
					.setCta()
					.setIcon("folder-plus")
					.onClick(() => {
						new FolderSelectorModal(
							this.app,
							this.plugin.settings.excludedFolders || [],
							async (selected) => {
								this.plugin.settings.excludedFolders = selected;
								await this.plugin.saveSettings();
								rawFolderInput?.setValue(selected.join(", "));
								renderFolderChips();
							},
						).open();
					});
			});

		const chipsContainer = containerEl.createDiv({ cls: "nt-folder-chips-container" });

		const renderFolderChips = () => {
			chipsContainer.empty();
			const list = this.plugin.settings.excludedFolders || [];
			if (list.length === 0) {
				chipsContainer.createEl("span", {
					text: "No folders excluded. Click 'Select Folders...' above to pick folders visually.",
					cls: "nt-muted",
				});
				return;
			}

			list.forEach((folderPath, idx) => {
				const chip = chipsContainer.createDiv({ cls: "nt-folder-chip" });
				const icon = chip.createSpan();
				setIcon(icon, "folder");
				chip.createSpan({ text: folderPath });

				const delBtn = chip.createSpan({ cls: "nt-folder-chip-del" });
				setIcon(delBtn, "x");
				setTooltip(delBtn, `Remove exclusion for "${folderPath}"`);
				delBtn.addEventListener(
					"click",
					voidAsync(async () => {
						this.plugin.settings.excludedFolders.splice(idx, 1);
						await this.plugin.saveSettings();
						rawFolderInput?.setValue(
							this.plugin.settings.excludedFolders.join(", "),
						);
						renderFolderChips();
					}),
				);
			});
		};

		renderFolderChips();

		new Setting(containerEl)
			.setName("Manual Folder Path List")
			.setDesc("Raw comma-separated paths (synced with the visual selector above).")
			.addTextArea((text) => {
				rawFolderInput = text;
				text
					.setPlaceholder("e.g. Hardware Planner/data, templates, .trash")
					.setValue((this.plugin.settings.excludedFolders || []).join(", "))
					.onChange(async (val) => {
						this.plugin.settings.excludedFolders = val
							.split(",")
							.map((f) => f.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
						renderFolderChips();
					});
				text.inputEl.rows = 2;
				text.inputEl.addClass("nt-settings-textarea");
			});

		let rawExtInput: TextAreaComponent | null = null;

		new Setting(containerEl)
			.setName("Excluded File Extensions")
			.setDesc("Visual exclusion selector and quick-chip manager for file extensions.")
			.addButton((btn) => {
				btn
					.setButtonText("Select Extensions...")
					.setCta()
					.onClick(() => {
						new ExtensionSelectorModal(
							this.app,
							this.plugin.settings.excludedExtensions || [],
							async (selected) => {
								this.plugin.settings.excludedExtensions = selected;
								await this.plugin.saveSettings();
								rawExtInput?.setValue(selected.join(", "));
								renderExtChips();
							},
						).open();
					});
			});

		const extChipsContainer = containerEl.createDiv({ cls: "nt-folder-chips-container" });

		const renderExtChips = () => {
			extChipsContainer.empty();
			const list = this.plugin.settings.excludedExtensions || [];
			if (list.length === 0) {
				extChipsContainer.createEl("span", {
					text: "No extensions excluded. Click 'Select Extensions...' above to pick extensions visually.",
					cls: "nt-muted",
				});
				return;
			}

			list.forEach((ext, idx) => {
				const chip = extChipsContainer.createDiv({ cls: "nt-folder-chip" });
				const icon = chip.createSpan();
				setIcon(icon, "file");
				chip.createSpan({ text: `.${ext}` });

				const delBtn = chip.createSpan({ cls: "nt-folder-chip-del" });
				setIcon(delBtn, "x");
				setTooltip(delBtn, `Remove exclusion for ".${ext}"`);
				delBtn.addEventListener(
					"click",
					voidAsync(async () => {
						this.plugin.settings.excludedExtensions.splice(idx, 1);
						await this.plugin.saveSettings();
						rawExtInput?.setValue(this.plugin.settings.excludedExtensions.join(", "));
						renderExtChips();
					}),
				);
			});
		};

		renderExtChips();

		new Setting(containerEl)
			.setName("Manual Extension List")
			.setDesc("Raw comma-separated extensions (synced with the visual selector above).")
			.addTextArea((text) => {
				rawExtInput = text;
				text
					.setPlaceholder("e.g. csv, txt, json, bak")
					.setValue((this.plugin.settings.excludedExtensions || []).join(", "))
					.onChange(async (val) => {
						this.plugin.settings.excludedExtensions = val
							.split(",")
							.map((f) => f.trim().toLowerCase().replace(/^\./, ""))
							.filter(Boolean);
						await this.plugin.saveSettings();
						renderExtChips();
					});
				text.inputEl.rows = 2;
				text.inputEl.addClass("nt-settings-textarea");
			});

		new Setting(containerEl)
			.setName("Default Scanned Folders")
			.setDesc(
				"Comma-separated folder paths to limit scanning to. Leave empty to scan entire vault.",
			)
			.addText((text) => {
				text
					.setPlaceholder("e.g. Attachments, Assets")
					.setValue((this.plugin.settings.scannedFolders || []).join(", "))
					.onChange(async (val) => {
						this.plugin.settings.scannedFolders = val
							.split(",")
							.map((f) => f.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName("Interactive Inline Dropdown Manager").setHeading();
		containerEl.createEl("p", {
			text: "Manage your ?[listname] dropdowns visually. Use ?[listname] to bind to note properties, or ?[listname|CurrentValue] for multiple independent dropdowns in a note.",
			cls: "nt-muted",
		});

		const ddContainer = containerEl.createDiv({ cls: "nt-settings-dd-wrap" });
		new DropdownManagerUI(this.plugin, ddContainer).render();
	}
}
