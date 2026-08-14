import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, NoteToolboxSettings, NoteToolboxSettingTab, normalizeSettings } from "./settings";
import { InlineDropdownProcessor } from "./dropdown-processor";
import { FileCheckView, FILE_CHECK_VIEW_TYPE } from "./file-check-view";

export default class NoteToolboxPlugin extends Plugin {
    settings: NoteToolboxSettings = DEFAULT_SETTINGS;

    async onload(): Promise<void> {
        this.settings = await this.loadPluginSettings();

        this.addSettingTab(new NoteToolboxSettingTab(this.app, this));

        this.registerView(FILE_CHECK_VIEW_TYPE, (leaf) => new FileCheckView(leaf, this));

        this.addRibbonIcon("checkmark", "Open file multi-select", () => {
            void this.activateFileCheckView();
        });

        this.addCommand({
            id: "open-file-multi-select",
            name: "Open file multi-select",
            callback: () => void this.activateFileCheckView(),
        });

        const dropdownProcessor = new InlineDropdownProcessor(this);
        this.registerMarkdownPostProcessor((element, context) => {
            dropdownProcessor.process(element, context);
        });
    }

    async loadPluginSettings(): Promise<NoteToolboxSettings> {
        try {
            const saved = await this.loadData() as unknown;
            return normalizeSettings(saved);
        } catch (error) {
            console.error("Note Toolbox: failed to load settings", error);
            new Notice("Note toolbox settings were invalid. Defaults were restored.");
            return { ...DEFAULT_SETTINGS, dropdownLists: {} };
        }
    }

    async savePluginSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    async activateFileCheckView(): Promise<void> {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(FILE_CHECK_VIEW_TYPE)[0];

        if (!leaf) {
            leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("split");
            await leaf.setViewState({ type: FILE_CHECK_VIEW_TYPE, active: true });
        }

        await workspace.revealLeaf(leaf);
    }
}
