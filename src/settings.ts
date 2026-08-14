import { App, PluginSettingTab, Setting } from "obsidian";
import type NoteToolboxPlugin from "./main";

export interface NoteToolboxSettings {
    dropdownLists: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: NoteToolboxSettings = {
    dropdownLists: {},
};

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function normalizeSettings(value: unknown): NoteToolboxSettings {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_SETTINGS, dropdownLists: {} };
    }

    const raw = value as Record<string, unknown>;
    const rawLists = raw.dropdownLists;

    if (!rawLists || typeof rawLists !== "object" || Array.isArray(rawLists)) {
        return { ...DEFAULT_SETTINGS, dropdownLists: {} };
    }

    const dropdownLists: Record<string, string[]> = {};

    for (const [name, options] of Object.entries(rawLists)) {
        const cleanName = name.trim();
        if (!cleanName || !isStringArray(options)) continue;

        const cleanOptions = options
            .map((option) => option.trim())
            .filter(Boolean);

        if (cleanOptions.length > 0) {
            dropdownLists[cleanName] = [...new Set(cleanOptions)];
        }
    }

    return { dropdownLists };
}

export class NoteToolboxSettingTab extends PluginSettingTab {
    constructor(app: App, private readonly plugin: NoteToolboxPlugin) {
        super(app, plugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("note-toolbox-settings");

        containerEl.createEl("h2", { text: "Note Toolbox" });
        containerEl.createEl("p", {
            text: "Manage the dropdown lists used by ?[listName] inline dropdowns.",
            cls: "setting-item-description",
        });

        new Setting(containerEl)
            .setName("Import / export JSON")
            .setDesc("Advanced users can edit all dropdown lists as JSON.")
            .addTextArea((text) => {
                text.setValue(JSON.stringify(this.plugin.settings.dropdownLists, null, 2));
                text.inputEl.rows = 10;
                text.inputEl.addClass("note-toolbox-settings-json");
                text.onChange(async (value) => {
                    try {
                        const parsed: unknown = JSON.parse(value);
                        const normalized = normalizeSettings({ dropdownLists: parsed });

                        if (Object.keys(normalized.dropdownLists).length === 0 && value.trim() !== "{}") {
                            throw new Error("No valid dropdown lists were found.");
                        }

                        this.plugin.settings.dropdownLists = normalized.dropdownLists;
                        await this.plugin.savePluginSettings();
                    } catch (error) {
                        console.error("Note Toolbox: invalid dropdown JSON", error);
                    }
                });
            });

        containerEl.createEl("h3", { text: "Dropdown lists" });

        const listNames = Object.keys(this.plugin.settings.dropdownLists).sort((a, b) =>
            a.localeCompare(b),
        );

        if (listNames.length === 0) {
            containerEl.createEl("p", {
                text: "No dropdown lists yet. Add one below.",
                cls: "setting-item-description",
            });
        }

        for (const name of listNames) {
            this.renderList(containerEl, name);
        }

        new Setting(containerEl)
            .setName("Add dropdown list")
            .setDesc("Create a named list such as status, priority, or bookStatus.")
            .addText((text) => text.setPlaceholder("List name"))
            .addButton((button) => {
                button.setButtonText("Add");
                button.setCta();
                button.onClick(async () => {
                    const setting = button.buttonEl.parentElement?.querySelector("input") as HTMLInputElement | null;
                    const name = setting?.value.trim() ?? "";
                    if (!name) return;

                    if (this.plugin.settings.dropdownLists[name]) {
                        containerEl.createEl("p", { text: `A list named “${name}” already exists.` });
                        return;
                    }

                    this.plugin.settings.dropdownLists[name] = ["Option 1", "Option 2"];
                    await this.plugin.savePluginSettings();
                    this.display();
                });
            });
    }

    private renderList(containerEl: HTMLElement, name: string): void {
        const options = this.plugin.settings.dropdownLists[name] ?? [];
        const section = containerEl.createDiv({ cls: "note-toolbox-settings-list" });

        section.createEl("h4", { text: name });

        new Setting(section)
            .setName("Options")
            .setDesc("One option per line.")
            .addTextArea((text) => {
                text.setValue(options.join("\n"));
                text.inputEl.rows = Math.max(3, Math.min(8, options.length + 1));
                text.onChange(async (value) => {
                    const next = [...new Set(
                        value.split("\n").map((option) => option.trim()).filter(Boolean),
                    )];

                    if (next.length === 0) return;
                    this.plugin.settings.dropdownLists[name] = next;
                    await this.plugin.savePluginSettings();
                });
            });

        new Setting(section)
            .addButton((button) => {
                button.setButtonText("Delete list");
                button.setWarning();
                button.onClick(async () => {
                    delete this.plugin.settings.dropdownLists[name];
                    await this.plugin.savePluginSettings();
                    this.display();
                });
            });
    }
}
