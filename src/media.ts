import type { App } from "obsidian";
import { TFolder, normalizePath } from "obsidian";
import { formatBytes, formatDuration, getCategory } from "./fuzzy";
import type { NoteToolboxSettings, FileCategory } from "./types";

const sharedNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const sharedExtCollator = new Intl.Collator(undefined, { sensitivity: "base" });

/**
 * Faithful port of MediaService (Nihon main.js L125+).
 */
export class MediaService {
  cache = new Map<string, unknown>();
  cachedLinkedPaths: Set<string> | null = null;
  cachedLinkedMtime = 0;

  constructor(
    public app: App,
    public settings: NoteToolboxSettings,
  ) {}

  clearLinkedCache(): void {
    this.cachedLinkedPaths = null;
    this.cachedLinkedMtime = 0;
  }

  getAllFolders(): string[] {
    const folders = ["/ (All Vault)"];
    const subFolders: string[] = [];
    const collect = (item: unknown): void => {
      if (item instanceof TFolder) {
        if (item.path !== "/") subFolders.push(item.path);
        if (item.children) item.children.forEach(collect);
      }
    };
    collect((this.app.vault as any).getRoot());
    subFolders.sort((a, b) => sharedNameCollator.compare(a, b));
    return folders.concat(subFolders);
  }

  getLinkedFilePaths(): Set<string> {
    const now = Date.now();
    if (this.cachedLinkedPaths && now - this.cachedLinkedMtime < 4000) return this.cachedLinkedPaths;
    const linked = new Set<string>();
    const resolved = (this.app.metadataCache as any).resolvedLinks || {};
    for (const source in resolved) {
      const targets = resolved[source];
      if (targets) for (const dest in targets) linked.add(dest);
    }
    this.cachedLinkedPaths = linked;
    this.cachedLinkedMtime = now;
    return linked;
  }

  getValidFiles(
    category = "all",
    selectedFolder = "/ (All Vault)",
    searchQuery = "",
    sortMode = "mtime-desc",
    usageFilter = "all",
    selectedExtension = "all",
    hideExcluded = true,
    ignoreScannedFolders = false,
    pickerAllowedExtensions: string[] | null = null,
    pickerExcludedExtensions: string[] | null = null,
    pickerExcludedFolders: string[] | null = null,
    skipSort = false,
  ): unknown[] {
    const query = searchQuery.trim().toLowerCase();
    const configFolders = ignoreScannedFolders ? [] : (this.settings.scannedFolders || []);
    const linkedPaths = usageFilter !== "all" ? this.getLinkedFilePaths() : null;
    const excludedExts = new Set<string>(
      (this.settings.excludedExtensions || []).map((e) => e.trim().toLowerCase().replace(/^\./, "")),
    );
    pickerExcludedExtensions?.forEach((e) => excludedExts.add(e.trim().toLowerCase().replace(/^\./, "")));
    const excludedDirs = (this.settings.excludedFolders || [])
      .concat(pickerExcludedFolders || [])
      .map((f) => f.trim().replace(/\/+$/, "").toLowerCase())
      .filter(Boolean);
    const allowedExts =
      pickerAllowedExtensions && pickerAllowedExtensions.length
        ? new Set(pickerAllowedExtensions.map((e) => e.trim().toLowerCase().replace(/^\./, "")))
        : null;

    const files = (this.app.vault.getFiles() as unknown as Array<{
      path: string;
      name: string;
      extension: string;
      parent?: { path: string };
      stat: { size: number; mtime: number };
    }>).filter((file) => {
      const type = getCategory(file);
      if (!type) return false;
      if (category !== "all" && type !== category) return false;
      const ext = (file.extension || "").toLowerCase();
      if (allowedExts && !allowedExts.has(ext)) return false;
      if (selectedExtension !== "all" && ext !== selectedExtension.toLowerCase()) return false;
      if (hideExcluded) {
        if (excludedExts.has(ext)) return false;
        const filePathLower = file.path.toLowerCase();
        for (const exDir of excludedDirs) if (filePathLower === exDir || filePathLower.startsWith(`${exDir}/`)) return false;
      }
      if (usageFilter === "orphan" && linkedPaths?.has(file.path)) return false;
      if (usageFilter === "linked" && linkedPaths && !linkedPaths.has(file.path)) return false;
      if (selectedFolder !== "/ (All Vault)") {
        const normSelected = selectedFolder.replace(/\/+$/, "");
        if (file.parent?.path !== normSelected && !file.path.startsWith(`${normSelected}/`)) return false;
      } else if (configFolders.length > 0) {
        const inAllowed = configFolders.some((f) => {
          const normF = f.replace(/\/+$/, "");
          return file.path === normF || file.path.startsWith(`${normF}/`);
        });
        if (!inAllowed) return false;
      }
      if (query && !file.name.toLowerCase().includes(query) && !file.path.toLowerCase().includes(query)) return false;
      return true;
    });

    if (skipSort) return files;
    files.sort((a, b) => {
      switch (sortMode) {
        case "name-asc": return sharedNameCollator.compare(a.name, b.name);
        case "name-desc": return sharedNameCollator.compare(b.name, a.name);
        case "size-asc": return a.stat.size - b.stat.size;
        case "size-desc": return b.stat.size - a.stat.size;
        case "ext-asc": return sharedExtCollator.compare(a.extension, b.extension);
        case "ext-desc": return sharedExtCollator.compare(b.extension, a.extension);
        case "mtime-asc": return a.stat.mtime - b.stat.mtime;
        default: return b.stat.mtime - a.stat.mtime;
      }
    });
    return files;
  }

  getBaseMetadata(file: { extension: string; stat: { size: number; mtime: number } }): Record<string, unknown> {
    const ext = (file.extension || "").toLowerCase();
    return { size: formatBytes(file.stat.size), rawSize: file.stat.size, ext: ext.toUpperCase(), mtime: file.stat.mtime, type: getCategory(file as never), detail: "" };
  }

  purgeFolder(folderPath: string): void {
    const prefix = `${folderPath.replace(/\/+$/, "")}/`;
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key);
  }

  async batchRename(files: Array<{ path: string; basename: string; extension: string; parent?: { path: string; name: string } }>, pattern: string): Promise<number> {
    let renamedCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const oldPath = file.path;
      const folderPath = file.parent?.path ?? "";
      const folderName = file.parent?.name ?? "root";
      const indexStr = String(i + 1).padStart(2, "0");
      let baseName = pattern.replace(/{folder}/g, folderName).replace(/{n}/g, indexStr).replace(/{name}/g, file.basename).replace(/[\\/:*?"<>|]/g, "_").trim();
      if (!baseName) baseName = `file_${indexStr}`;
      let targetPath = normalizePath(folderPath ? `${folderPath}/${baseName}.${file.extension}` : `${baseName}.${file.extension}`);
      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(targetPath) && targetPath !== oldPath) {
        targetPath = normalizePath(folderPath ? `${folderPath}/${baseName}_(${counter}).${file.extension}` : `${baseName}_(${counter}).${file.extension}`);
        counter++;
      }
      if (targetPath !== oldPath) {
        try {
          await (this.app.fileManager as any).renameFile(file, targetPath);
          this.cache.delete(oldPath);
          renamedCount++;
        } catch (err) {
          console.error(`Failed to rename ${oldPath}:`, err);
        }
      }
    }
    return renamedCount;
  }

  async moveFiles(files: Array<{ path: string; name: string; basename: string; extension: string }>, targetFolder: string): Promise<number> {
    const dest = targetFolder === "/ (All Vault)" || targetFolder === "/" ? "" : targetFolder.replace(/\/+$/, "");
    let movedCount = 0;
    for (const file of files) {
      const oldPath = file.path;
      let targetPath = normalizePath(dest ? `${dest}/${file.name}` : file.name);
      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(targetPath) && targetPath !== oldPath) {
        targetPath = normalizePath(dest ? `${dest}/${file.basename}_(${counter}).${file.extension}` : `${file.basename}_(${counter}).${file.extension}`);
        counter++;
      }
      if (targetPath !== oldPath) {
        try {
          await (this.app.fileManager as any).renameFile(file, targetPath);
          this.cache.delete(oldPath);
          movedCount++;
        } catch (err) {
          console.error(`Failed to move ${oldPath}:`, err);
        }
      }
    }
    return movedCount;
  }
}
