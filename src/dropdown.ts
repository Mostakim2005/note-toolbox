import { MarkdownView, Notice, TFile, type MarkdownPostProcessorContext } from "obsidian";
import type NoteToolboxPlugin from "./main";

/**
 * Inline dropdown post-processor. Supports:
 *   ?[listname]            → stored in frontmatter as dropdown_<listname>
 *   ?[listname|value]      → value rewritten inline in the note text
 * Port of InlineDropdownProcessor (Nihon main.js L2845+).
 */
export class InlineDropdownProcessor {
	private readonly regex = /\?\[([^\]|]+)(?:\|([^\]]*))?\]/g;

	constructor(private readonly plugin: NoteToolboxPlugin) {}

	process(element: HTMLElement, context: MarkdownPostProcessorContext): void {
		if (!element.textContent || !element.textContent.includes("?[")) return;

		const sourceFile = this.plugin.app.vault.getAbstractFileByPath(context.sourcePath);
		if (!(sourceFile instanceof TFile)) return;

		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		let current: Node | null;
		while ((current = walker.nextNode())) {
			if (!(current instanceof Text)) continue;
			if (!current.parentElement?.closest("code, pre, textarea")) {
				textNodes.push(current);
			}
		}

		for (const node of textNodes) {
			const text = node.nodeValue || "";
			this.regex.lastIndex = 0;
			if (!this.regex.test(text)) continue;

			this.regex.lastIndex = 0;
			const parent = node.parentElement;
			if (!parent) continue;

			const span = document.createElement("span");
			span.className = "nt-dropdown-wrap";
			let lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = this.regex.exec(text)) !== null) {
				span.append(text.slice(lastIndex, match.index));
				const fullMatch = match[0];
				const listName = (match[1] ?? "").trim();
				const inlineVal = match[2] !== undefined ? match[2].trim() : null;
				const options = this.plugin.settings.dropdownLists[listName];

				if (options && options.length) {
					const select = span.createEl("select", { cls: "dropdown nt-inline-select" });

					const cache = this.plugin.app.metadataCache.getFileCache(sourceFile);
					const frontmatter: Record<string, unknown> | undefined = cache?.frontmatter;
					const rawValue = frontmatter?.[`dropdown_${listName}`];
					const fmVal = typeof rawValue === "string" ? rawValue : "";
					const activeVal = inlineVal !== null ? inlineVal : fmVal;

					const defaultOpt = select.createEl("option", { text: "Choose..." });
					defaultOpt.value = "";
					defaultOpt.disabled = true;
					defaultOpt.selected = !activeVal;

					options.forEach((opt) => {
						const el = select.createEl("option", { text: opt, value: opt });
						el.selected = opt === activeVal;
					});

					select.addEventListener("change", () => {
						void this.handleChange(
							sourceFile,
							listName,
							inlineVal,
							fullMatch,
							select.value,
						);
					});
				} else {
					span.append(fullMatch);
				}
				lastIndex = match.index + fullMatch.length;
			}

			span.append(text.slice(lastIndex));
			node.parentNode?.replaceChild(span, node);
		}
	}

	private async handleChange(
		sourceFile: TFile,
		listName: string,
		inlineVal: string | null,
		fullMatch: string,
		chosen: string,
	): Promise<void> {
		if (inlineVal !== null) {
			const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.file?.path === sourceFile.path && activeView.editor) {
				const editor = activeView.editor;
				const docText = editor.getValue();
				const idx = docText.indexOf(fullMatch);
				if (idx !== -1) {
					const fromPos = editor.offsetToPos(idx);
					const toPos = editor.offsetToPos(idx + fullMatch.length);
					editor.replaceRange(`?[${listName}|${chosen}]`, fromPos, toPos);
					new Notice(`${listName} set to "${chosen}"`);
					return;
				}
			}

			await this.plugin.app.vault.process(sourceFile, (data) => {
				const replacement = `?[${listName}|${chosen}]`;
				return data.replace(fullMatch, replacement);
			});
			new Notice(`${listName} set to "${chosen}"`);
		} else {
			await this.plugin.app.fileManager.processFrontMatter(
				sourceFile,
				(frontmatter: unknown) => {
					if (typeof frontmatter === "object" && frontmatter !== null) {
						(frontmatter as Record<string, unknown>)[`dropdown_${listName}`] = chosen;
					}
				},
			);
			new Notice(`${listName} set to "${chosen}"`);
		}
	}
}
