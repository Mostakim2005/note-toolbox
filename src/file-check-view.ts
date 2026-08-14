import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import type NoteToolboxPlugin from "./main";
import { ConfirmModal, FolderSelectModal, InputModal } from "./modals";
import { FileService, formatFileSize, isImageFile, showFileOperationError } from "./file-service";

export const FILE_CHECK_VIEW_TYPE = "file-check-view";

type ViewMode = "list" | "grid";

export class FileCheckView extends ItemView {
    private readonly fileService: FileService;
    private selected = new Set<string>();
    private folderFilter = new Set<string>([""]);
    private viewMode: ViewMode = "list";
    private gridColumns = 3;
    private searchQuery = "";
    private fileInfoCache = new Map<string, { mtime: number; size: number; text: string }>();
    private listContainer?: HTMLElement;
    private selectionSummary?: HTMLElement;

    constructor(leaf: WorkspaceLeaf, private readonly plugin: NoteToolboxPlugin) {
        super(leaf);
        this.fileService = new FileService(plugin.app);
    }

    getViewType(): string {
        return FILE_CHECK_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "File Multi-Select";
    }

    getIcon(): string {
        return "check-square";
    }

    async onOpen(): Promise<void> {
        this.rebuildFolderList();
        this.render();
    }

    async onClose(): Promise<void> {
        this.selected.clear();
        this.fileInfoCache.clear();
        this.contentEl.empty();
    }

    private render(): void {
        this.contentEl.empty();
        this.contentEl.addClass("note-toolbox-view");

        const header = this.contentEl.createDiv({ cls: "note-toolbox-header" });
        const title = header.createDiv({ cls: "note-toolbox-header-title" });
        title.createEl("h2", { text: "File Toolbox" });
        title.createEl("p", { text: "Select and manage files in your vault." });

        this.renderToolbar(header);

        this.listContainer = this.contentEl.createDiv({ cls: "note-toolbox-file-container" });
        this.renderFiles();

        this.renderActions();
    }

    private renderToolbar(parent: HTMLElement): void {
        const toolbar = parent.createDiv({ cls: "note-toolbox-toolbar" });

        const search = toolbar.createEl("input", {
            type: "search",
            placeholder: "Search files…",
            cls: "note-toolbox-search",
        });
        search.value = this.searchQuery;
        search.addEventListener("input", () => {
            this.searchQuery = search.value;
            this.renderFiles();
        });

        const folderButton = toolbar.createEl("button", { text: "Folders" });
        folderButton.addEventListener("click", () => {
            new FolderSelectModal(this.app, this.getAllFolders(), [...this.folderFilter], (folders) => {
                this.folderFilter = new Set(folders.length ? folders : this.getAllFolders());
                this.renderFiles();
            }).open();
        });

        const viewButton = toolbar.createEl("button", {
            text: this.viewMode === "list" ? "Grid" : "List",
        });
        viewButton.addEventListener("click", () => {
            this.viewMode = this.viewMode === "list" ? "grid" : "list";
            this.renderFiles();
        });

        if (this.viewMode === "grid") {
            const columns = toolbar.createEl("select", { cls: "note-toolbox-select" });
            for (const value of [2, 3, 4]) {
                columns.createEl("option", { text: `${value} columns`, value: String(value) });
            }
            columns.value = String(this.gridColumns);
            columns.addEventListener("change", () => {
                this.gridColumns = Number(columns.value);
                this.renderFiles();
            });
        }

        const selectAll = toolbar.createEl("button", { text: "All" });
        selectAll.addEventListener("click", () => {
            for (const file of this.getFilteredFiles()) this.selected.add(file.path);
            this.renderFiles();
        });

        const selectNone = toolbar.createEl("button", { text: "None" });
        selectNone.addEventListener("click", () => {
            this.selected.clear();
            this.renderFiles();
        });

        const invert = toolbar.createEl("button", { text: "Invert" });
        invert.addEventListener("click", () => {
            const filtered = this.getFilteredFiles();
            for (const file of filtered) {
                if (this.selected.has(file.path)) this.selected.delete(file.path);
                else this.selected.add(file.path);
            }
            this.renderFiles();
        });
    }

    private renderFiles(): void {
        if (!this.listContainer) return;
        this.listContainer.empty();

        const files = this.getFilteredFiles();
        this.listContainer.toggleClass("is-grid", this.viewMode === "grid");
        this.listContainer.toggleClass("is-list", this.viewMode === "list");
        this.listContainer.style.setProperty("--note-toolbox-grid-columns", String(this.gridColumns));

        if (files.length === 0) {
            const empty = this.listContainer.createDiv({ cls: "note-toolbox-empty" });
            empty.createEl("strong", { text: "No files found" });
            empty.createEl("span", { text: "Try changing the search or folder filter." });
            this.updateSelectionSummary();
            return;
        }

        for (const file of files) {
            this.renderFile(file);
        }

        this.updateSelectionSummary();
    }

    private renderFile(file: TFile): void {
        if (!this.listContainer) return;

        const item = this.listContainer.createDiv({
            cls: this.viewMode === "grid" ? "note-toolbox-file-card" : "note-toolbox-file-row",
        });

        const checkbox = item.createEl("input", { type: "checkbox" });
        checkbox.checked = this.selected.has(file.path);
        checkbox.setAttribute("aria-label", `Select ${file.name}`);
        checkbox.addEventListener("click", (event) => event.stopPropagation());
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) this.selected.add(file.path);
            else this.selected.delete(file.path);
            this.updateSelectionSummary();
        });

        const preview = item.createDiv({ cls: "note-toolbox-preview" });
        if (isImageFile(file)) {
            const image = preview.createEl("img", { alt: file.name });
            image.src = this.app.vault.getResourcePath(file);
        } else {
            preview.createSpan({ text: file.extension === "md" ? "MD" : file.extension.toUpperCase() || "FILE" });
        }

        const details = item.createDiv({ cls: "note-toolbox-file-details" });
        details.createEl("strong", { text: file.name });
        details.createEl("span", { text: file.path, cls: "note-toolbox-file-path" });

        const info = details.createEl("span", { cls: "note-toolbox-file-info" });
        void this.loadFileInfo(file, info);

        item.addEventListener("dblclick", () => {
            void this.app.workspace.openLinkText(file.path, "", false);
        });
    }

    private renderActions(): void {
        const footer = this.contentEl.createDiv({ cls: "note-toolbox-footer" });
        this.selectionSummary = footer.createDiv({ cls: "note-toolbox-selection-summary" });
        this.updateSelectionSummary();

        const actions = footer.createDiv({ cls: "note-toolbox-actions" });
        const deleteButton = actions.createEl("button", { text: "Delete", cls: "mod-warning" });
        deleteButton.addEventListener("click", () => void this.deleteSelected());

        const renameButton = actions.createEl("button", { text: "Rename" });
        renameButton.addEventListener("click", () => void this.renameFirst());

        const batchRenameButton = actions.createEl("button", { text: "Batch rename" });
        batchRenameButton.addEventListener("click", () => void this.batchRename());

        const moveButton = actions.createEl("button", { text: "Move" });
        moveButton.addEventListener("click", () => void this.moveSelected());

        const mergeButton = actions.createEl("button", { text: "Merge notes" });
        mergeButton.addEventListener("click", () => void this.mergeNotes());
    }

    private updateSelectionSummary(): void {
        if (!this.selectionSummary) return;
        const total = this.getFilteredFiles().length;
        const selected = this.getSelectedFiles().length;
        this.selectionSummary.setText(`${selected} selected · ${total} shown`);
    }

    private getFilteredFiles(): TFile[] {
        const query = this.searchQuery.trim().toLowerCase();
        const folders = this.folderFilter;

        return this.fileService.getFiles().filter((file) => {
            const inFolder = [...folders].some((folder) => {
                if (folder === "") return file.parent.path === "";
                return file.parent.path === folder || file.parent.path.startsWith(`${folder}/`);
            });

            if (!inFolder) return false;
            if (!query) return true;

            return file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query);
        });
    }

    private getSelectedFiles(): TFile[] {
        return this.fileService.getFiles().filter((file) => this.selected.has(file.path));
    }

    private getAllFolders(): string[] {
        const folders = new Set<string>([""]);
        for (const file of this.fileService.getFiles()) folders.add(file.parent.path);
        return [...folders].sort((a, b) => a.localeCompare(b));
    }

    private rebuildFolderList(): void {
        const folders = this.getAllFolders();
        if (this.folderFilter.size === 0) this.folderFilter = new Set(folders);
    }

    private async loadFileInfo(file: TFile, element: HTMLElement): Promise<void> {
        const cached = this.fileInfoCache.get(file.path);
        if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
            element.setText(cached.text);
            return;
        }

        try {
            const info = await this.fileService.getFileInfo(file);
            const resolution = info.width && info.height ? ` · ${info.width}×${info.height}` : "";
            const text = `${formatFileSize(info.size)}${resolution}`;
            this.fileInfoCache.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, text });
            element.setText(text);
        } catch {
            element.setText(formatFileSize(file.stat.size));
        }
    }

    private async deleteSelected(): Promise<void> {
        const files = this.getSelectedFiles();
        if (!files.length) {
            new Notice("Nothing selected.");
            return;
        }

        new ConfirmModal(
            this.app,
            "Move files to trash?",
            `This will move ${files.length} selected file${files.length === 1 ? "" : "s"} to Obsidian's trash.`,
            "Move to trash",
            async () => {
                try {
                    await this.fileService.delete(files);
                    this.selected.clear();
                    new Notice(`Moved ${files.length} file(s) to trash.`);
                    this.renderFiles();
                } catch (error) {
                    showFileOperationError("Delete", error);
                }
            },
        ).open();
    }

    private async renameFirst(): Promise<void> {
        const files = this.getSelectedFiles();
        if (!files.length) {
            new Notice("Select a file first.");
            return;
        }

        const file = files[0];
        const base = file.basename;
        new InputModal(this.app, "Rename file", "New name", base, async (newName) => {
            try {
                await this.fileService.rename(file, newName);
                this.selected.delete(file.path);
                new Notice("File renamed.");
                this.renderFiles();
            } catch (error) {
                showFileOperationError("Rename", error);
            }
        }).open();
    }

    private async batchRename(): Promise<void> {
        const files = this.getSelectedFiles();
        if (!files.length) {
            new Notice("Select files to rename.");
            return;
        }

        new InputModal(this.app, "Batch rename", "Base name", "renamed", async (base) => {
            try {
                await this.fileService.batchRename(files, base);
                this.selected.clear();
                new Notice(`Renamed ${files.length} file(s).`);
                this.renderFiles();
            } catch (error) {
                showFileOperationError("Batch rename", error);
            }
        }).open();
    }

    private async moveSelected(): Promise<void> {
        const files = this.getSelectedFiles();
        if (!files.length) {
            new Notice("Select files to move.");
            return;
        }

        new InputModal(this.app, "Move files", "Folder path", "Attachments", async (folder) => {
            try {
                await this.fileService.move(files, folder);
                this.selected.clear();
                new Notice(`Moved ${files.length} file(s).`);
                this.renderFiles();
            } catch (error) {
                showFileOperationError("Move", error);
            }
        }).open();
    }

    private async mergeNotes(): Promise<void> {
        const files = this.getSelectedFiles().filter((file) => file.extension.toLowerCase() === "md");
        if (files.length < 2) {
            new Notice("Select at least two Markdown notes to merge.");
            return;
        }

        new InputModal(this.app, "Merge notes", "New note name", "Merged Note", async (name) => {
            try {
                const result = await this.fileService.mergeNotes(files, name);
                this.selected.clear();
                new Notice(`Merged notes into ${result.path}.`);
                this.renderFiles();
            } catch (error) {
                showFileOperationError("Merge", error);
            }
        }).open();
    }
}
