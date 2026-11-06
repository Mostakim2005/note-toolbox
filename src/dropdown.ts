import { MarkdownView, Notice, TFile } from "obsidian";
import type { App } from "obsidian";
import type NoteToolboxPlugin from "./main";

/**
 * Faithful port of InlineDropdownProcessor (Nihon main.js L2845+).
 * Supports ?[listname] and ?[listname|currentValue], skips code/pre/textarea.
 */
export class InlineDropdownProcessor {
  private regex = /\?\[([^\]|]+)(?:\|([^\]]*))?\]/g;

  constructor(public plugin: NoteToolboxPlugin) {}

  process(element: HTMLElement, context: { sourcePath: string }): void {
    if (!element.textContent || !element.textContent.includes("?[")) return;
    const sourceFile = this.plugin.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(sourceFile instanceof TFile)) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let current: Text | null = null;
    while ((current = walker.nextNode() as unknown as Text)) {
      if (!(current.parentElement?.closest("code, pre, textarea"))) textNodes.push(current);
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
        const listName = match[1]!.trim();
        const inlineVal = match[2] !== undefined ? match[2].trim() : null;
        const options = this.plugin.settings.dropdownLists[listName];
        if (options && options.length) {
          const select = span.createEl("select", { cls: "dropdown nt-inline-select" });
          const cache = this.plugin.app.metadataCache.getFileCache(sourceFile);
          const fmVal = (cache?.frontmatter as Record<string, unknown> | undefined)?.[`dropdown_${listName}`] as string || "";
          const activeVal = inlineVal !== null ? inlineVal : String(fmVal ?? "");
          const defaultOpt = select.createEl("option", { text: "Choose..." });
          defaultOpt.value = "";
          defaultOpt.disabled = true;
          defaultOpt.selected = !activeVal;
          options.forEach((opt) => {
            const el = select.createEl("option", { text: opt, value: opt });
            el.selected = opt === activeVal;
          });
          select.addEventListener("change", async () => {
            const chosen = select.value;
            if (inlineVal !== null) {
              const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
              if (activeView?.file?.path === sourceFile.path && activeView.editor) {
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
              await this.plugin.app.vault.process(sourceFile, (data) => data.replace(fullMatch, `?[${listName}|${chosen}]`));
              new Notice(`${listName} set to "${chosen}"`);
            } else {
              await (this.plugin.app.fileManager as any).processFrontMatter(sourceFile, (fm: Record<string, unknown>) => {
                fm[`dropdown_${listName}`] = chosen;
              });
              new Notice(`${listName} set to "${chosen}"`);
            }
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
}












