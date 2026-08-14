import { MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import type NoteToolboxPlugin from "./main";

const DROPDOWN_PATTERN = /\?\[([^\]]+)\]/g;

export class InlineDropdownProcessor {
    constructor(private readonly plugin: NoteToolboxPlugin) {}

    process(element: HTMLElement, context: MarkdownPostProcessorContext): void {
        const file = this.getSourceFile(context.sourcePath);
        if (!file) return;

        const metadata = this.plugin.app.metadataCache.getFileCache(file);
        const frontmatter = metadata?.frontmatter ?? {};
        const textNodes = this.collectTextNodes(element);

        for (const textNode of textNodes) {
            const text = textNode.nodeValue ?? "";
            DROPDOWN_PATTERN.lastIndex = 0;

            if (!DROPDOWN_PATTERN.test(text)) continue;
            DROPDOWN_PATTERN.lastIndex = 0;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match: RegExpExecArray | null;

            while ((match = DROPDOWN_PATTERN.exec(text)) !== null) {
                fragment.append(text.slice(lastIndex, match.index));

                const rawListName = match[1];
                if (rawListName === undefined) {
                    fragment.append(match[0]);
                    lastIndex = match.index + match[0].length;
                    continue;
                }

                const listName = rawListName.trim();
                const options = this.plugin.settings.dropdownLists[listName];

                if (!options?.length) {
                    fragment.append(match[0]);
                } else {
                    fragment.append(this.createDropdown(file, listName, options, frontmatter));
                }

                lastIndex = match.index + match[0].length;
            }

            fragment.append(text.slice(lastIndex));
            textNode.parentNode?.replaceChild(fragment, textNode);
        }
    }

    private getSourceFile(sourcePath: string): TFile | null {
        const abstractFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
        return abstractFile instanceof TFile ? abstractFile : null;
    }

    private collectTextNodes(root: HTMLElement): Text[] {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        let node: Node | null;

        while ((node = walker.nextNode())) {
            const textNode = node as Text;
            const parent = textNode.parentElement;
            if (!parent || parent.closest("code, pre, textarea, script, style")) continue;
            nodes.push(textNode);
        }

        return nodes;
    }

    private createDropdown(
        file: TFile,
        listName: string,
        options: string[],
        frontmatter: Record<string, unknown>,
    ): HTMLSelectElement {
        const select = document.createElement("select");
        select.className = "note-toolbox-dropdown";
        select.setAttribute("aria-label", `${listName} dropdown`);

        const fieldName = `dropdown_${listName}`;
        const currentValue = typeof frontmatter[fieldName] === "string"
            ? frontmatter[fieldName]
            : "";

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Choose…";
        placeholder.disabled = true;
        placeholder.selected = !currentValue;
        select.appendChild(placeholder);

        for (const option of options) {
            const optionEl = document.createElement("option");
            optionEl.value = option;
            optionEl.textContent = option;
            optionEl.selected = option === currentValue;
            select.appendChild(optionEl);
        }

        select.addEventListener("change", () => {
            void this.updateDropdown(file, fieldName, listName, select.value);
        });

        return select;
    }

    private async updateDropdown(
        file: TFile,
        fieldName: string,
        listName: string,
        value: string,
    ): Promise<void> {
        try {
            await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter[fieldName] = value;
            });

            new Notice(`${listName} set to “${value}”`);
        } catch (error) {
            console.error("Note Toolbox: failed to update frontmatter", error);
            new Notice("Could not update the dropdown value.");
        }
    }
}
