import { Plugin, Notice, TFile, TFolder } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings";
import type { NoteToolboxSettings } from "./types";
import { MediaService } from "./media";
import { InlineDropdownProcessor } from "./dropdown";
import { debounce } from "./fuzzy";

/**
 * NoteToolboxPlugin — faithful entry port (Nihon main.js L3216+).
 */
export default class NoteToolboxPlugin extends Plugin {
  settings!: NoteToolboxSettings;
  service!: MediaService;

  applyThemePreferences() {
    if (typeof document !== "undefined") {
      document.body.toggleClass("nt-glassmorphic", Boolean(this.settings.glassmorphism ?? true));
    }
  }

  async onload() {
    await this.loadSettings();
    this.applyThemePreferences();
    this.service = new MediaService(this.app, this.settings);

    this.addCommand({
      id: "open-media-toolbox",
      name: "Open Media Toolbox",
      callback: () => new Notice("Media Toolbox — full modal is the next split step."),
    });

    this.addCommand({
      id: "open-dropdown-manager",
      name: "Manage Inline Dropdowns",
      callback: () => new Notice("Dropdown manager — full modal is the next split step."),
    });

    this.registerAliases();

    this.addRibbonIcon("layout-grid", "Open Media Toolbox", () => new Notice("Note Toolbox — pilot build."));

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
        if (file instanceof TFile) (this.service.cache as Map<string, unknown>).delete(file.path);
        else if (file instanceof TFolder) this.service.purgeFolder(file.path);
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.service.clearLinkedCache();
        if (file instanceof TFolder) this.service.purgeFolder(oldPath);
        else (this.service.cache as Map<string, unknown>).delete(oldPath);
      }),
    );

    const processor = new InlineDropdownProcessor(this);
    this.registerMarkdownPostProcessor((el, ctx) => processor.process(el, ctx));

    this.addSettingTab(new NoteToolboxSettingPlaceholder(this.app, this));
  }

  registerAliases(): void {
    const raw = this.settings.customAliases || "attach, media, pick";
    const aliases = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    aliases.forEach((alias) => {
      this.addCommand({
        id: `cmd-alias-${alias}`,
        name: alias,
        callback: () => new Notice("Media Toolbox — full modal is the next split step."),
      });
    });
  }

  injectOverlayButtons(): void {
    const leaves = (this.app.workspace.getLeavesOfType("canvas") as unknown[])
      .concat(this.app.workspace.getLeavesOfType("excalidraw") as unknown[]) as Array<{
      view?: { containerEl?: HTMLElement; getViewType?: () => string };
    }>;
    leaves.forEach((leaf) => {
      const container = leaf.view?.containerEl;
      if (!container || container.querySelector(".nt-canvas-overlay-btn")) return;
      const overlayBtn = container.createDiv({ cls: "nt-canvas-overlay-btn" });
      overlayBtn.createSpan({ cls: "nt-canvas-overlay-icon", text: "▦" });
      overlayBtn.title = `Insert Asset to ${leaf.view?.getViewType?.() === "canvas" ? "Canvas" : "Excalidraw"}`;
      overlayBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        new Notice("Insert asset — picker is the next split step.");
      });
    });
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

import { PluginSettingTab, App, Setting } from "obsidian";
class NoteToolboxSettingPlaceholder extends PluginSettingTab {
  constructor(app: App, public plugin: NoteToolboxPlugin) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Note Toolbox — pilot" });
    new Setting(containerEl)
      .setName("Glassmorphism")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.glassmorphism).onChange(async (val) => {
        this.plugin.settings.glassmorphism = val;
        await this.plugin.saveSettings();
        this.plugin.applyThemePreferences();
      }));
    new Setting(containerEl)
      .setName("Custom aliases")
      .setDesc("Comma-separated shortcuts (e.g. attach, media, pick).")
      .addText((text) => text.setValue(this.plugin.settings.customAliases).onChange(async (val) => {
        this.plugin.settings.customAliases = val;
        await this.plugin.saveSettings();
      }));
  }
}
