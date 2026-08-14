import { App, normalizePath, Notice, TFile } from "obsidian";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif"]);

export interface FileInfo {
    size: number;
    width?: number;
    height?: number;
}

export function isImageFile(file: TFile): boolean {
    return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export class FileService {
    constructor(private readonly app: App) {}

    getFiles(): TFile[] {
        return this.app.vault.getFiles();
    }

    async delete(files: TFile[]): Promise<void> {
        for (const file of files) {
            await this.app.fileManager.trashFile(file);
        }
    }

    async rename(file: TFile, baseName: string): Promise<void> {
        const cleanBaseName = baseName.trim();
        if (!cleanBaseName) throw new Error("File name cannot be empty.");

        const extension = file.extension;
        const finalName = cleanBaseName.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
            ? cleanBaseName
            : `${cleanBaseName}.${extension}`;

        const parentPath = file.parent.path;
        const newPath = normalizePath(parentPath ? `${parentPath}/${finalName}` : finalName);

        await this.ensurePathAvailable(newPath, file.path);
        await this.app.vault.rename(file, newPath);
    }

    async batchRename(files: TFile[], baseName: string): Promise<void> {
        const cleanBaseName = baseName.trim();
        if (!cleanBaseName) throw new Error("Base name cannot be empty.");

        const plannedPaths = new Set<string>();

        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            const newName = `${cleanBaseName} ${index + 1}.${file.extension}`;
            const newPath = normalizePath(file.parent.path ? `${file.parent.path}/${newName}` : newName);

            if (plannedPaths.has(newPath) || (newPath !== file.path && this.app.vault.getAbstractFileByPath(newPath))) {
                throw new Error(`A file already exists at ${newPath}.`);
            }

            plannedPaths.add(newPath);
        }

        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            const newName = `${cleanBaseName} ${index + 1}.${file.extension}`;
            const newPath = normalizePath(file.parent.path ? `${file.parent.path}/${newName}` : newName);
            await this.app.vault.rename(file, newPath);
        }
    }

    async move(files: TFile[], folderInput: string): Promise<void> {
        const folderPath = normalizePath(folderInput);
        if (!folderPath) throw new Error("Folder path cannot be empty.");

        const existing = this.app.vault.getAbstractFileByPath(folderPath);
        if (!existing) {
            await this.app.vault.createFolder(folderPath);
        } else if (!("children" in existing)) {
            throw new Error("The destination path is a file, not a folder.");
        }

        const destinations = files.map((file) => normalizePath(`${folderPath}/${file.name}`));

        for (let index = 0; index < files.length; index++) {
            const destination = destinations[index];
            if (destination !== files[index].path && this.app.vault.getAbstractFileByPath(destination)) {
                throw new Error(`A file already exists at ${destination}.`);
            }
        }

        for (let index = 0; index < files.length; index++) {
            await this.app.vault.rename(files[index], destinations[index]);
        }
    }

    async mergeNotes(files: TFile[], destinationName: string): Promise<TFile> {
        const markdownFiles = files.filter((file) => file.extension.toLowerCase() === "md");
        if (markdownFiles.length < 2) {
            throw new Error("Select at least two Markdown notes.");
        }

        const name = destinationName.toLowerCase().endsWith(".md")
            ? destinationName
            : `${destinationName}.md`;

        const destinationPath = normalizePath(
            markdownFiles[0].parent.path ? `${markdownFiles[0].parent.path}/${name}` : name,
        );

        if (this.app.vault.getAbstractFileByPath(destinationPath)) {
            throw new Error(`A file already exists at ${destinationPath}.`);
        }

        const sections: string[] = [];
        for (const file of markdownFiles) {
            const content = await this.app.vault.read(file);
            sections.push(`## ${file.basename}\n\n${content.trim()}`);
        }

        return this.app.vault.create(destinationPath, `${sections.join("\n\n")}\n`);
    }

    async getFileInfo(file: TFile): Promise<FileInfo> {
        const info: FileInfo = { size: file.stat.size };

        if (!isImageFile(file)) return info;

        const resourcePath = this.app.vault.getResourcePath(file);
        const image = new Image();

        await new Promise<void>((resolve) => {
            image.onload = () => resolve();
            image.onerror = () => resolve();
            image.src = resourcePath;
        });

        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            info.width = image.naturalWidth;
            info.height = image.naturalHeight;
        }

        return info;
    }

    private async ensurePathAvailable(newPath: string, oldPath: string): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath(newPath);
        if (existing && newPath !== oldPath) {
            throw new Error(`A file already exists at ${newPath}.`);
        }
    }
}

export function showFileOperationError(action: string, error: unknown): void {
    console.error(`Note Toolbox: ${action} failed`, error);
    const message = error instanceof Error ? error.message : "Unknown error.";
    new Notice(`${action} failed: ${message}`);
}
