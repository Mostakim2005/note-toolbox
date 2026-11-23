import { PluginSettingTab, Setting, setIcon, setTooltip, type App, type TextAreaComponent } from "obsidian";
import type NoteToolboxPlugin from "./main";
import { DropdownManagerUI } from "./dropdown-manager";
import {
	ExtensionSelectorModal,
	FolderSelectorModal,
	normalizeExcludedExtensions,
	normalizeExcludedFolders,
} from "./exclusions";
import { voidAsync } from "./async";
import { debounce } from "./fuzzy";

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

		const debouncedRegisterAliases = debounce(() => {
			void this.plugin.saveSettings().then(() => this.plugin.registerAliases());
		}, 350);

		new Setting(containerEl)
			.setName("Custom Command Aliases")
			.setDesc("Comma-separated short keywords for the command palette and slash (/) menu.")
			.addText((text) => {
				text
					.setPlaceholder("e.g. attach, media, pick, gallery")
					.setValue(this.plugin.settings.customAliases || "")
					.onChange((val) => {
						this.plugin.settings.customAliases = val;
						debouncedRegisterAliases();
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
								const normalized = normalizeExcludedFolders(selected);
								this.plugin.settings.excludedFolders = normalized;
								await this.plugin.saveSettings();
								rawFolderInput?.setValue(normalized.join(", "));
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
				const chip = chipsContainer.createDiv({ cls: "nt-folder-chip nt-exclude-chip" });
				const icon = chip.createSpan();
				setIcon(icon, "folder-x");
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
						this.plugin.settings.excludedFolders = normalizeExcludedFolders(val.split(","));
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
								const normalized = normalizeExcludedExtensions(selected);
								this.plugin.settings.excludedExtensions = normalized;
								await this.plugin.saveSettings();
								rawExtInput?.setValue(normalized.join(", "));
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
				const chip = extChipsContainer.createDiv({ cls: "nt-folder-chip nt-exclude-chip" });
				const icon = chip.createSpan();
				setIcon(icon, "file-x");
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
						this.plugin.settings.excludedExtensions = normalizeExcludedExtensions(
							val.split(","),
						);
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

		new Setting(containerEl).setName("Visual Note Navigator & Grid").setHeading();

		new Setting(containerEl)
			.setName("Default navigator layout")
			.setDesc("Choose dual-pane (tree + previews side by side) or single-pane (compact sidebar).")
			.addDropdown((dd) => {
				dd.addOption("dual", "Dual-pane (Folder/Tag tree + Notes)")
					.addOption("single", "Single-pane (Toggle between Tree and Notes)")
					.setValue(this.plugin.settings.navLayoutMode || "dual")
					.onChange(async (val) => {
						this.plugin.settings.navLayoutMode = val === "single" ? "single" : "dual";
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Default note display style")
			.setDesc("Browse notes as a visual Gallery Grid, Apple Notes-style Preview List, or Compact List.")
			.addDropdown((dd) => {
				dd.addOption("grid", "Gallery Grid (Title, excerpt & up to 3 images)")
					.addOption("preview", "Visual Preview List (Excerpt + thumbnail)")
					.addOption("compact", "Compact List (Dense titles & dates)")
					.setValue(this.plugin.settings.navDisplayMode || "preview")
					.onChange(async (val) => {
						this.plugin.settings.navDisplayMode =
							val === "grid" || val === "compact" ? val : "preview";
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Note preview excerpt lines")
			.setDesc("How many lines of text excerpt to display per note card or preview row (1–5).")
			.addDropdown((dd) => {
				for (const n of ["1", "2", "3", "4", "5"]) dd.addOption(n, `${n} line${n === "1" ? "" : "s"}`);
				dd.setValue(String(this.plugin.settings.navPreviewLines || 3)).onChange(
					async (val) => {
						this.plugin.settings.navPreviewLines = Number(val) || 3;
						await this.plugin.saveSettings();
					},
				);
			});

		new Setting(containerEl)
			.setName("Note grid columns")
			.setDesc("Choose Auto-fit responsive cards or pin a fixed number of grid columns (2–5).")
			.addDropdown((dd) => {
				dd.addOption("0", "Auto-fit (Responsive)")
					.addOption("2", "2 columns")
					.addOption("3", "3 columns")
					.addOption("4", "4 columns")
					.addOption("5", "5 columns")
					.setValue(String(this.plugin.settings.navGridColumns || 0))
					.onChange(async (val) => {
						this.plugin.settings.navGridColumns = Number(val) || 0;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Show note image thumbnails")
			.setDesc("Display embedded vault images and frontmatter cover thumbnails without opening notes.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.navShowThumbnails !== false).onChange(
					async (val) => {
						this.plugin.settings.navShowThumbnails = val;
						await this.plugin.saveSettings();
					},
				);
			});

		new Setting(containerEl)
			.setName("Show tag pills on note cards")
			.setDesc("Display clickable tag pills inside Visual Preview and Gallery Grid cards.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.navShowTags !== false).onChange(
					async (val) => {
						this.plugin.settings.navShowTags = val;
						await this.plugin.saveSettings();
					},
				);
			});

		new Setting(containerEl)
			.setName("Auto-reveal active note")
			.setDesc("Automatically highlight and scroll to the active note when switching tabs.")
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.navAutoReveal !== false).onChange(
					async (val) => {
						this.plugin.settings.navAutoReveal = val;
						await this.plugin.saveSettings();
					},
				);
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
