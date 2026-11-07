"use strict";

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  normalizePath,
  MarkdownView,
  TFile,
  TFolder,
  Menu,
  setIcon,
  setTooltip
} = require("obsidian");

const EXTENSIONS = {
  images: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]),
  video: new Set(["mp4", "webm", "ogv", "mov", "mkv", "avi", "m4v", "3gp"]),
  audio: new Set(["mp3", "wav", "m4a", "ogg", "flac", "aac", "opus"]),
  docs: new Set(["pdf", "epub", "html", "htm", "txt", "rtf", "doc", "docx", "csv"])
};

const DEFAULT_SETTINGS = {
  dropdownLists: {
    status: ["To Do", "In Progress", "Completed"],
    priority: ["Low", "Medium", "High"],
    urgency: ["Urgent", "Not Urgent"]
  },
  scannedFolders: [],
  excludedFolders: [],
  excludedExtensions: [],
  customAliases: "attach, media, pick, gallery",
  defaultViewMode: "grid",
  galleryRows: 4,
  galleryColumns: 5,
  glassmorphism: true
};

function debounce(fn, delay = 160) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

const sharedNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const sharedExtCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function formatBytes(bytes) {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "";
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getCategory(file) {
  if (!file || !file.extension) return null;
  const ext = file.extension.toLowerCase();
  if (EXTENSIONS.images.has(ext)) return "image";
  if (EXTENSIONS.video.has(ext)) return "video";
  if (EXTENSIONS.audio.has(ext)) return "audio";
  if (EXTENSIONS.docs.has(ext)) return "document";
  return null;
}

// Reusable Confirmation Modal
class ConfirmModal extends Modal {
  constructor(app, { title, message, confirmText = "Confirm", isDanger = false, onConfirm }) {
    super(app);
    this.titleText = title;
    this.messageText = message;
    this.confirmText = confirmText;
    this.isDanger = isDanger;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    this.modalEl.addClass("nt-prompt-modal");
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: this.titleText });
    if (this.messageText) {
      contentEl.createEl("p", { text: this.messageText, cls: "nt-muted" });
    }

    const actions = contentEl.createDiv({ cls: "nt-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    const okBtn = actions.createEl("button", {
      text: this.confirmText,
      cls: this.isDanger ? "mod-warning" : "mod-cta"
    });
    okBtn.addEventListener("click", () => {
      this.close();
      if (typeof this.onConfirm === "function") this.onConfirm();
    });

    window.setTimeout(() => okBtn.focus(), 40);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class MediaService {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    this.cache = new Map();
    this.cachedLinkedPaths = null;
    this.cachedLinkedMtime = 0;
  }

  clearLinkedCache() {
    this.cachedLinkedPaths = null;
    this.cachedLinkedMtime = 0;
  }

  getAllFolders() {
    const folders = ["/ (All Vault)"];
    const subFolders = [];
    const collect = (item) => {
      if (item instanceof TFolder) {
        if (item.path !== "/") subFolders.push(item.path);
        if (item.children) item.children.forEach(collect);
      }
    };
    collect(this.app.vault.getRoot());
    subFolders.sort((a, b) => sharedNameCollator.compare(a, b));
    return folders.concat(subFolders);
  }

  getLinkedFilePaths() {
    const now = Date.now();
    if (this.cachedLinkedPaths && now - this.cachedLinkedMtime < 4000) {
      return this.cachedLinkedPaths;
    }
    const linked = new Set();
    const resolved = this.app.metadataCache.resolvedLinks || {};
    for (const source in resolved) {
      const targets = resolved[source];
      if (targets) {
        for (const dest in targets) {
          linked.add(dest);
        }
      }
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
    pickerAllowedExtensions = null,
    pickerExcludedExtensions = null,
    pickerExcludedFolders = null,
    skipSort = false
  ) {
    const query = searchQuery.trim().toLowerCase();
    const configFolders = ignoreScannedFolders ? [] : (this.settings.scannedFolders || []);
    const linkedPaths = usageFilter !== "all" ? this.getLinkedFilePaths() : null;

    // Build Exclusions Set
    const excludedExts = new Set(
      (this.settings.excludedExtensions || []).map((e) => e.trim().toLowerCase().replace(/^\./, ""))
    );
    if (pickerExcludedExtensions && pickerExcludedExtensions.length) {
      pickerExcludedExtensions.forEach((e) => excludedExts.add(e.trim().toLowerCase().replace(/^\./, "")));
    }

    const excludedDirs = (this.settings.excludedFolders || [])
      .concat(pickerExcludedFolders || [])
      .map((f) => f.trim().replace(/\/+$/, "").toLowerCase())
      .filter(Boolean);

    const allowedExts = pickerAllowedExtensions && pickerAllowedExtensions.length
      ? new Set(pickerAllowedExtensions.map((e) => e.trim().toLowerCase().replace(/^\./, "")))
      : null;

    const files = this.app.vault.getFiles().filter((file) => {
      const type = getCategory(file);
      if (!type) return false;
      if (category !== "all" && type !== category) return false;

      const ext = file.extension ? file.extension.toLowerCase() : "";

      // Caller-specified allowed extensions
      if (allowedExts && !allowedExts.has(ext)) return false;

      // Extension filter dropdown
      if (selectedExtension !== "all" && ext !== selectedExtension.toLowerCase()) return false;

      // Exclusion rules
      if (hideExcluded) {
        if (excludedExts.has(ext)) return false;

        const filePathLower = file.path.toLowerCase();
        for (const exDir of excludedDirs) {
          if (filePathLower === exDir || filePathLower.startsWith(`${exDir}/`)) {
            return false;
          }
        }
      }

      // Usage / Orphan Filter
      if (usageFilter === "orphan") {
        if (linkedPaths && linkedPaths.has(file.path)) return false;
      } else if (usageFilter === "linked") {
        if (linkedPaths && !linkedPaths.has(file.path)) return false;
      }

      // Folder filtering
      if (selectedFolder !== "/ (All Vault)") {
        const normSelected = selectedFolder.replace(/\/+$/, "");
        if (file.parent?.path !== normSelected && !file.path.startsWith(`${normSelected}/`)) {
          return false;
        }
      } else if (configFolders.length > 0) {
        const inAllowed = configFolders.some((f) => {
          const normF = f.replace(/\/+$/, "");
          return file.path === normF || file.path.startsWith(`${normF}/`);
        });
        if (!inAllowed) return false;
      }

      // Search Query
      if (query) {
        const matchName = file.name.toLowerCase().includes(query);
        const matchPath = file.path.toLowerCase().includes(query);
        if (!matchName && !matchPath) return false;
      }

      return true;
    });

    if (skipSort) return files;

    files.sort((a, b) => {
      switch (sortMode) {
        case "name-asc":
          return sharedNameCollator.compare(a.name, b.name);
        case "name-desc":
          return sharedNameCollator.compare(b.name, a.name);
        case "size-asc":
          return a.stat.size - b.stat.size;
        case "size-desc":
          return b.stat.size - a.stat.size;
        case "ext-asc":
          return sharedExtCollator.compare(a.extension, b.extension);
        case "ext-desc":
          return sharedExtCollator.compare(b.extension, a.extension);
        case "mtime-asc":
          return a.stat.mtime - b.stat.mtime;
        case "mtime-desc":
        default:
          return b.stat.mtime - a.stat.mtime;
      }
    });

    return files;
  }

  getBaseMetadata(file) {
    const ext = file.extension.toLowerCase();
    return {
      size: formatBytes(file.stat.size),
      rawSize: file.stat.size,
      ext: ext.toUpperCase(),
      mtime: file.stat.mtime,
      type: getCategory(file),
      detail: ""
    };
  }

  async getFullMetadata(file) {
    const cached = this.cache.get(file.path);
    if (cached && cached.mtime === file.stat.mtime && cached.rawSize === file.stat.size) {
      return cached;
    }

    const data = this.getBaseMetadata(file);
    const resourceUrl = this.app.vault.getResourcePath(file);

    if (data.type === "image") {
      await new Promise((resolve) => {
        let done = false;
        const img = new Image();
        const finish = (dims = "") => {
          if (done) return;
          done = true;
          if (dims) data.detail = dims;
          img.src = "";
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, 1500);
        img.onload = () => finish(`${img.naturalWidth}×${img.naturalHeight}`);
        img.onerror = () => finish();
        img.src = resourceUrl;
      });
    } else if (data.type === "video") {
      await new Promise((resolve) => {
        let done = false;
        const video = document.createElement("video");
        video.preload = "metadata";
        const finish = () => {
          if (done) return;
          done = true;
          const dur = formatDuration(video.duration);
          const dims = video.videoWidth && video.videoHeight ? `${video.videoWidth}×${video.videoHeight}` : "";
          data.detail = dims && dur ? `${dims} • ${dur}` : dims || dur;
          video.src = "";
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          video.src = "";
          resolve();
        }, 1500);
        video.onloadedmetadata = finish;
        video.onerror = finish;
        video.src = resourceUrl;
      });
    } else if (data.type === "audio") {
      await new Promise((resolve) => {
        let done = false;
        const audio = new Audio();
        audio.preload = "metadata";
        const finish = () => {
          if (done) return;
          done = true;
          data.detail = formatDuration(audio.duration);
          audio.src = "";
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          audio.src = "";
          resolve();
        }, 1500);
        audio.onloadedmetadata = finish;
        audio.onerror = finish;
        audio.src = resourceUrl;
      });
    }

    this.cache.set(file.path, data);
    return data;
  }

  purgeFolder(folderPath) {
    const prefix = `${folderPath.replace(/\/+$/, "")}/`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  async batchRename(files, pattern) {
    let renamedCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const oldPath = file.path;
      const folderPath = file.parent ? file.parent.path : "";
      const folderName = file.parent ? file.parent.name : "root";
      const indexStr = String(i + 1).padStart(2, "0");

      let baseName = pattern
        .replace(/{folder}/g, folderName)
        .replace(/{n}/g, indexStr)
        .replace(/{name}/g, file.basename)
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim();

      if (!baseName) baseName = `file_${indexStr}`;

      let targetPath = normalizePath(
        folderPath ? `${folderPath}/${baseName}.${file.extension}` : `${baseName}.${file.extension}`
      );

      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(targetPath) && targetPath !== oldPath) {
        targetPath = normalizePath(
          folderPath
            ? `${folderPath}/${baseName}_(${counter}).${file.extension}`
            : `${baseName}_(${counter}).${file.extension}`
        );
        counter++;
      }

      if (targetPath !== oldPath) {
        try {
          await this.app.fileManager.renameFile(file, targetPath);
          this.cache.delete(oldPath);
          renamedCount++;
        } catch (err) {
          console.error(`Failed to rename ${oldPath}:`, err);
        }
      }
    }
    return renamedCount;
  }

  async moveFiles(files, targetFolder) {
    const dest = targetFolder === "/ (All Vault)" || targetFolder === "/" ? "" : targetFolder.replace(/\/+$/, "");
    let movedCount = 0;

    for (const file of files) {
      const oldPath = file.path;
      let targetPath = normalizePath(dest ? `${dest}/${file.name}` : file.name);

      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(targetPath) && targetPath !== oldPath) {
        targetPath = normalizePath(
          dest ? `${dest}/${file.basename}_(${counter}).${file.extension}` : `${file.basename}_(${counter}).${file.extension}`
        );
        counter++;
      }

      if (targetPath !== oldPath) {
        try {
          await this.app.fileManager.renameFile(file, targetPath);
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

/**
 * Interactive Minimalist UI Builder for Dropdown Lists
 */
class DropdownManagerUI {
  constructor(plugin, containerEl, onUpdate = null) {
    this.plugin = plugin;
    this.containerEl = containerEl;
    this.onUpdate = onUpdate;
    const keys = Object.keys(this.plugin.settings.dropdownLists || {});
    this.activeList = keys.length > 0 ? keys[0] : null;
    this.selectedOptions = new Set();
    this.lastClickedOptionIdx = null;
  }

  async saveAndRefresh(rerender = true) {
    await this.plugin.saveSettings();
    if (this.onUpdate) this.onUpdate();
    if (rerender) this.render();
  }

  render() {
    this.containerEl.empty();
    const wrap = this.containerEl.createDiv({ cls: "nt-dd-manager" });

    const listsObj = this.plugin.settings.dropdownLists || {};
    const listNames = Object.keys(listsObj);

    if (this.activeList && !listsObj[this.activeList]) {
      this.activeList = listNames[0] || null;
      this.selectedOptions.clear();
    } else if (!this.activeList && listNames.length > 0) {
      this.activeList = listNames[0];
    }

    // 1. Top Bar: Dropdown List Selector Chips + Add List Input
    const listBar = wrap.createDiv({ cls: "nt-dd-list-bar" });
    const chipWrap = listBar.createDiv({ cls: "nt-chip-group" });

    listNames.forEach((name) => {
      const isActive = name === this.activeList;
      const chip = chipWrap.createEl("button", {
        cls: `nt-chip ${isActive ? "is-active" : ""}`
      });
      const iconSpan = chip.createSpan({ cls: "nt-chip-icon" });
      setIcon(iconSpan, "list-filter");
      chip.createSpan({ text: name });
      chip.createSpan({
        cls: "nt-dd-chip-count",
        text: `${(listsObj[name] || []).length}`
      });

      chip.addEventListener("click", () => {
        if (this.activeList === name) return;
        this.activeList = name;
        this.selectedOptions.clear();
        this.lastClickedOptionIdx = null;
        this.render();
      });
    });

    const addListForm = listBar.createDiv({ cls: "nt-dd-inline-add" });
    const newListInput = addListForm.createEl("input", {
      type: "text",
      placeholder: "New list name (e.g. category)...",
      cls: "nt-dd-input"
    });
    const addListBtn = addListForm.createEl("button", { cls: "nt-btn-mint nt-btn-sm" });
    setIcon(addListBtn.createSpan({ cls: "nt-btn-icon" }), "plus");
    addListBtn.createSpan({ text: "New Dropdown" });

    const handleCreateList = async () => {
      const raw = newListInput.value.trim().replace(/\s+/g, "_").replace(/[^\w-]/g, "");
      if (!raw) return new Notice("Enter a valid list name.");
      if (listsObj[raw]) return new Notice(`Dropdown "${raw}" already exists.`);

      this.plugin.settings.dropdownLists[raw] = [];
      this.activeList = raw;
      this.selectedOptions.clear();
      await this.saveAndRefresh(true);
      new Notice(`Created dropdown ?[${raw}]`);
    };

    addListBtn.addEventListener("click", handleCreateList);
    newListInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleCreateList();
      }
    });

    if (!this.activeList) {
      const empty = wrap.createDiv({ cls: "nt-dd-empty" });
      empty.setText("No dropdown lists configured. Create one above to get started.");
      return;
    }

    const options = listsObj[this.activeList] || [];

    // 2. Active List Header Card
    const activeHeader = wrap.createDiv({ cls: "nt-dd-active-header" });
    const leftMeta = activeHeader.createDiv({ cls: "nt-dd-active-meta" });

    const nameInput = leftMeta.createEl("input", {
      type: "text",
      value: this.activeList,
      cls: "nt-dd-title-input"
    });
    setTooltip(nameInput, "Click to rename this dropdown list");

    const commitListRename = async () => {
      const nextName = nameInput.value.trim().replace(/\s+/g, "_").replace(/[^\w-]/g, "");
      if (!nextName || nextName === this.activeList) {
        nameInput.value = this.activeList;
        return;
      }
      if (listsObj[nextName]) {
        new Notice(`Dropdown "${nextName}" already exists.`);
        nameInput.value = this.activeList;
        return;
      }

      const updated = {};
      for (const k of Object.keys(listsObj)) {
        if (k === this.activeList) updated[nextName] = listsObj[k];
        else updated[k] = listsObj[k];
      }
      this.plugin.settings.dropdownLists = updated;
      this.activeList = nextName;
      await this.saveAndRefresh(true);
      new Notice(`Renamed dropdown to ?[${nextName}]`);
    };

    nameInput.addEventListener("blur", commitListRename);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        nameInput.blur();
      }
    });

    const tokenBadge = leftMeta.createEl("button", {
      cls: "nt-dd-token-badge",
      text: `?[${this.activeList}]`
    });
    setTooltip(tokenBadge, "Click to copy token for your note");
    tokenBadge.addEventListener("click", () => {
      navigator.clipboard.writeText(`?[${this.activeList}]`);
      new Notice(`Copied ?[${this.activeList}] to clipboard.`);
    });

    const rightHeaderOps = activeHeader.createDiv({ cls: "nt-btn-group" });
    const deleteListBtn = rightHeaderOps.createEl("button", { cls: "nt-btn-sm mod-warning" });
    setIcon(deleteListBtn.createSpan({ cls: "nt-btn-icon" }), "trash-2");
    deleteListBtn.createSpan({ text: "Delete List" });

    deleteListBtn.addEventListener("click", () => {
      const deletedName = this.activeList;
      new ConfirmModal(this.plugin.app, {
        title: `Delete Dropdown "${deletedName}"?`,
        message: `Are you sure you want to delete ?[${deletedName}] and all its options? Existing notes using this tag will not be changed.`,
        confirmText: "Delete Dropdown",
        isDanger: true,
        onConfirm: async () => {
          delete this.plugin.settings.dropdownLists[deletedName];
          this.activeList = Object.keys(this.plugin.settings.dropdownLists)[0] || null;
          this.selectedOptions.clear();
          await this.saveAndRefresh(true);
          new Notice(`Deleted dropdown "${deletedName}".`);
        }
      }).open();
    });

    // 3. Option Bulk Selection & Add Option Toolbar
    const toolbar = wrap.createDiv({ cls: "nt-actions-toolbar nt-dd-toolbar" });

    const selectGroup = toolbar.createDiv({ cls: "nt-btn-group" });
    selectGroup.createEl("button", { text: "All", cls: "nt-btn-sm" }).addEventListener("click", () => {
      options.forEach((_, idx) => this.selectedOptions.add(idx));
      this.render();
    });
    selectGroup.createEl("button", { text: "None", cls: "nt-btn-sm" }).addEventListener("click", () => {
      this.selectedOptions.clear();
      this.render();
    });
    selectGroup.createEl("button", { text: "Invert", cls: "nt-btn-sm" }).addEventListener("click", () => {
      options.forEach((_, idx) => {
        if (this.selectedOptions.has(idx)) this.selectedOptions.delete(idx);
        else this.selectedOptions.add(idx);
      });
      this.render();
    });

    const delSelectedBtn = selectGroup.createEl("button", {
      cls: "nt-btn-sm mod-warning",
      attr: { disabled: this.selectedOptions.size === 0 ? "true" : null }
    });
    setIcon(delSelectedBtn.createSpan({ cls: "nt-btn-icon" }), "trash");
    delSelectedBtn.createSpan({ text: `Delete Selected (${this.selectedOptions.size})` });

    delSelectedBtn.addEventListener("click", () => {
      if (this.selectedOptions.size === 0) return;
      const count = this.selectedOptions.size;
      new ConfirmModal(this.plugin.app, {
        title: `Delete ${count} Option(s)?`,
        message: `Are you sure you want to remove the ${count} selected options from "${this.activeList}"?`,
        confirmText: "Delete",
        isDanger: true,
        onConfirm: async () => {
          this.plugin.settings.dropdownLists[this.activeList] = options.filter(
            (_, idx) => !this.selectedOptions.has(idx)
          );
          this.selectedOptions.clear();
          await this.saveAndRefresh(true);
          new Notice(`Deleted ${count} option(s).`);
        }
      }).open();
    });

    const addOptGroup = toolbar.createDiv({ cls: "nt-dd-inline-add" });
    const addOptInput = addOptGroup.createEl("input", {
      type: "text",
      placeholder: "Add option (or comma-separated options)...",
      cls: "nt-dd-input"
    });
    const addOptBtn = addOptGroup.createEl("button", { cls: "nt-btn-mint nt-btn-sm" });
    setIcon(addOptBtn.createSpan({ cls: "nt-btn-icon" }), "plus");
    addOptBtn.createSpan({ text: "Add Option" });

    const handleAddOption = async () => {
      const raw = addOptInput.value.trim();
      if (!raw) return;
      const newItems = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const currentList = this.plugin.settings.dropdownLists[this.activeList] || [];
      let addedCount = 0;
      newItems.forEach((item) => {
        if (!currentList.includes(item)) {
          currentList.push(item);
          addedCount++;
        }
      });

      if (addedCount > 0) {
        this.plugin.settings.dropdownLists[this.activeList] = currentList;
        await this.saveAndRefresh(true);
      } else {
        new Notice("Option already exists in this list.");
      }
    };

    addOptBtn.addEventListener("click", handleAddOption);
    addOptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleAddOption();
      }
    });

    // 4. Interactive Options List
    const optionsListEl = wrap.createDiv({ cls: "nt-dd-options-list" });
    if (options.length === 0) {
      optionsListEl.createDiv({
        cls: "nt-dd-empty",
        text: "No options in this dropdown yet. Add options above."
      });
      return;
    }

    options.forEach((optValue, idx) => {
      const isSelected = this.selectedOptions.has(idx);
      const row = optionsListEl.createDiv({
        cls: `nt-dd-option-row ${isSelected ? "is-selected" : ""}`
      });

      const checkBtn = row.createDiv({ cls: "nt-dd-checkbox" });
      if (isSelected) setIcon(checkBtn, "check");
      checkBtn.addEventListener("click", (evt) => {
        if (evt.shiftKey && this.lastClickedOptionIdx !== null) {
          const start = Math.min(this.lastClickedOptionIdx, idx);
          const end = Math.max(this.lastClickedOptionIdx, idx);
          const shouldSelect = !this.selectedOptions.has(idx);
          for (let i = start; i <= end; i++) {
            if (shouldSelect) this.selectedOptions.add(i);
            else this.selectedOptions.delete(i);
          }
        } else {
          if (this.selectedOptions.has(idx)) this.selectedOptions.delete(idx);
          else this.selectedOptions.add(idx);
          this.lastClickedOptionIdx = idx;
        }
        this.render();
      });

      const optInput = row.createEl("input", {
        type: "text",
        value: optValue,
        cls: "nt-dd-opt-input"
      });

      const commitOptEdit = async () => {
        const nextVal = optInput.value.trim();
        if (!nextVal) {
          optInput.value = optValue;
          return;
        }
        if (nextVal !== optValue) {
          this.plugin.settings.dropdownLists[this.activeList][idx] = nextVal;
          await this.saveAndRefresh(false);
        }
      };

      optInput.addEventListener("blur", commitOptEdit);
      optInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          optInput.blur();
        }
      });

      const rowOps = row.createDiv({ cls: "nt-dd-row-ops" });

      const upBtn = rowOps.createEl("button", {
        cls: "nt-icon-btn",
        attr: { disabled: idx === 0 ? "true" : null }
      });
      setIcon(upBtn, "chevron-up");
      setTooltip(upBtn, "Move up");
      upBtn.addEventListener("click", async () => {
        if (idx === 0) return;
        const arr = this.plugin.settings.dropdownLists[this.activeList];
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        this.selectedOptions.clear();
        await this.saveAndRefresh(true);
      });

      const downBtn = rowOps.createEl("button", {
        cls: "nt-icon-btn",
        attr: { disabled: idx === options.length - 1 ? "true" : null }
      });
      setIcon(downBtn, "chevron-down");
      setTooltip(downBtn, "Move down");
      downBtn.addEventListener("click", async () => {
        const arr = this.plugin.settings.dropdownLists[this.activeList];
        if (idx >= arr.length - 1) return;
        [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
        this.selectedOptions.clear();
        await this.saveAndRefresh(true);
      });

      const delBtn = rowOps.createEl("button", { cls: "nt-icon-btn nt-dd-del-btn" });
      setIcon(delBtn, "x");
      setTooltip(delBtn, "Remove option");
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.dropdownLists[this.activeList].splice(idx, 1);
        this.selectedOptions.clear();
        await this.saveAndRefresh(true);
      });
    });
  }
}

// Standalone Modal for Managing Dropdowns Anytime
class DropdownManagerModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.modalEl.addClass("nt-dropdown-modal");
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "nt-topbar" });
    const titleGroup = header.createDiv({ cls: "nt-title-group" });
    titleGroup.createEl("h2", { text: "Inline Dropdown Manager" });

    const closeBtn = header.createEl("button", { cls: "nt-icon-btn" });
    setIcon(closeBtn, "x");
    setTooltip(closeBtn, "Close (Esc)");
    closeBtn.addEventListener("click", () => this.close());

    contentEl.createEl("p", {
      cls: "nt-muted",
      text: "Create and manage ?[listname] inline dropdowns and their options interactively."
    });

    const body = contentEl.createDiv({ cls: "nt-dd-modal-body" });
    new DropdownManagerUI(this.plugin, body).render();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Quick Look Lightbox Modal
class QuickLookModal extends Modal {
  constructor(app, file, meta, onAttach, actionLabel = "Insert / Attach") {
    super(app);
    this.file = file;
    this.meta = meta;
    this.onAttach = onAttach;
    this.actionLabel = actionLabel;
  }

  onOpen() {
    this.modalEl.addClass("nt-quicklook-modal");
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "nt-ql-header" });
    const title = header.createEl("h3", { text: this.file.name });
    title.title = this.file.path;

    const closeBtn = header.createEl("button", { cls: "nt-icon-btn" });
    setIcon(closeBtn, "x");
    setTooltip(closeBtn, "Close (Esc)");
    closeBtn.addEventListener("click", () => this.close());

    const previewArea = contentEl.createDiv({ cls: "nt-ql-preview" });
    const resourceUrl = this.app.vault.getResourcePath(this.file);

    if (this.meta.type === "image") {
      previewArea.createEl("img", {
        attr: { src: resourceUrl, alt: this.file.name }
      });
    } else if (this.meta.type === "video") {
      const videoEl = previewArea.createEl("video", {
        attr: { controls: "", autoplay: "", src: resourceUrl }
      });
      videoEl.style.maxWidth = "100%";
      videoEl.style.maxHeight = "52vh";
    } else if (this.meta.type === "audio") {
      const playerBox = previewArea.createDiv({ cls: "nt-ql-audio-box" });
      const audioIcon = playerBox.createDiv({ cls: "nt-ql-audio-icon" });
      setIcon(audioIcon, "music");
      playerBox.createEl("audio", {
        attr: { controls: "", autoplay: "", src: resourceUrl }
      });
    } else {
      const docBox = previewArea.createDiv({ cls: "nt-ql-doc-box" });
      const docIcon = docBox.createDiv({ cls: "nt-ql-doc-icon" });
      setIcon(docIcon, "file-text");
      docBox.createEl("div", { text: `${this.meta.ext} Document`, cls: "nt-ql-doc-desc" });
    }

    const footer = contentEl.createDiv({ cls: "nt-ql-footer" });
    const metaStats = footer.createDiv({ cls: "nt-ql-stats" });
    metaStats.createSpan({ text: this.meta.ext });
    if (this.meta.detail) metaStats.createSpan({ text: ` • ${this.meta.detail}` });
    metaStats.createSpan({ text: ` • ${this.meta.size}` });

    const btnAttach = footer.createEl("button", { text: this.actionLabel, cls: "nt-btn-mint" });
    btnAttach.addEventListener("click", () => {
      this.close();
      if (this.onAttach) this.onAttach(this.file);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Input Prompt Modal
class InputPromptModal extends Modal {
  constructor(app, title, desc, defaultValue, onConfirm) {
    super(app);
    this.titleText = title;
    this.desc = desc;
    this.defaultValue = defaultValue;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nt-prompt-modal");

    contentEl.createEl("h3", { text: this.titleText });
    if (this.desc) contentEl.createEl("p", { text: this.desc, cls: "nt-muted" });

    const input = contentEl.createEl("input", {
      type: "text",
      value: this.defaultValue,
      cls: "nt-input"
    });
    input.style.width = "100%";
    input.style.marginBottom = "14px";

    const actions = contentEl.createDiv({ cls: "nt-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const ok = actions.createEl("button", { text: "Confirm", cls: "mod-cta" });

    const handleConfirm = () => {
      const val = input.value.trim();
      if (val) {
        this.close();
        this.onConfirm(val);
      }
    };

    ok.addEventListener("click", handleConfirm);
    input.addEventListener("keydown", (e) => e.key === "Enter" && handleConfirm());
    window.setTimeout(() => input.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Folder Selection Modal
class SelectFolderModal extends Modal {
  constructor(app, folders, onSelect) {
    super(app);
    this.folders = folders;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nt-prompt-modal");
    contentEl.createEl("h3", { text: "Move Selected to Folder" });

    const select = contentEl.createEl("select", { cls: "nt-select nt-folder-picker" });
    select.style.width = "100%";
    select.style.marginBottom = "14px";

    this.folders.forEach((f) => {
      const opt = select.createEl("option", { text: f, value: f });
      if (f === "/ (All Vault)") opt.value = "";
    });

    const actions = contentEl.createDiv({ cls: "nt-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const ok = actions.createEl("button", { text: "Move", cls: "mod-cta" });
    ok.addEventListener("click", () => {
      this.close();
      this.onSelect(select.value);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Interactive Visual Folder Selector Modal (Multi-select with search and checkboxes)
class FolderSelectorModal extends Modal {
  constructor(app, currentExcludedFolders, onSave) {
    super(app);
    this.currentExcludedFolders = currentExcludedFolders || [];
    this.onSave = onSave;
    this.selectedFolders = new Set(this.currentExcludedFolders);
    this.searchQuery = "";
  }

  onOpen() {
    this.modalEl.addClass("nt-folder-picker-modal");
    const { contentEl } = this;
    contentEl.empty();

    // 1. Top Header Bar
    const topBar = contentEl.createDiv({ cls: "nt-topbar" });
    const titleGroup = topBar.createDiv({ cls: "nt-title-group" });
    titleGroup.createEl("h2", { text: "Select Folders to Exclude" });
    this.badgeEl = titleGroup.createSpan({
      cls: "nt-badge-count",
      text: `${this.selectedFolders.size} selected`
    });

    const closeBtn = topBar.createEl("button", { cls: "nt-icon-btn" });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.close());

    contentEl.createEl("p", {
      cls: "nt-muted",
      text: "Navigate or search through vault folders. Checked folders will be completely excluded from Note Toolbox."
    });

    // 2. Search & Batch Actions Row
    const searchRow = contentEl.createDiv({ cls: "nt-filter-row" });
    const searchInput = searchRow.createEl("input", {
      type: "search",
      placeholder: "Filter folders by name or path...",
      cls: "nt-search-input"
    });

    const quickGroup = searchRow.createDiv({ cls: "nt-btn-group" });
    quickGroup.createEl("button", { text: "Select All", cls: "nt-btn-sm" }).addEventListener("click", () => {
      const list = this.getFilteredFolders();
      list.forEach((f) => this.selectedFolders.add(f));
      this.updateBadge();
      this.renderList();
    });
    quickGroup.createEl("button", { text: "Clear All", cls: "nt-btn-sm" }).addEventListener("click", () => {
      const list = this.getFilteredFolders();
      list.forEach((f) => this.selectedFolders.delete(f));
      this.updateBadge();
      this.renderList();
    });
    quickGroup.createEl("button", { text: "Invert", cls: "nt-btn-sm" }).addEventListener("click", () => {
      const list = this.getFilteredFolders();
      list.forEach((f) => {
        if (this.selectedFolders.has(f)) this.selectedFolders.delete(f);
        else this.selectedFolders.add(f);
      });
      this.updateBadge();
      this.renderList();
    });

    // 3. Collect all folders from vault
    this.allFolders = [];
    const collect = (item) => {
      if (item instanceof TFolder) {
        if (item.path && item.path !== "/") this.allFolders.push(item.path);
        if (item.children) item.children.forEach(collect);
      }
    };
    collect(this.app.vault.getRoot());
    this.allFolders.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    // 4. Scrollable Folder List
    this.listContainer = contentEl.createDiv({ cls: "nt-folder-list-container" });
    this.renderList();

    searchInput.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.renderList();
    });

    // 5. Actions Footer
    const footer = contentEl.createDiv({ cls: "nt-modal-actions" });
    footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    this.confirmBtn = footer.createEl("button", {
      text: `Apply Exclusions (${this.selectedFolders.size})`,
      cls: "mod-cta"
    });
    this.confirmBtn.addEventListener("click", () => {
      this.close();
      if (typeof this.onSave === "function") {
        this.onSave(Array.from(this.selectedFolders));
      }
    });
  }

  getFilteredFolders() {
    if (!this.searchQuery) return this.allFolders;
    return this.allFolders.filter((folderPath) =>
      folderPath.toLowerCase().includes(this.searchQuery)
    );
  }

  updateBadge() {
    if (this.badgeEl) {
      this.badgeEl.setText(`${this.selectedFolders.size} selected`);
    }
    if (this.confirmBtn) {
      this.confirmBtn.setText(`Apply Exclusions (${this.selectedFolders.size})`);
    }
  }

  renderList() {
    this.listContainer.empty();

    const filtered = this.getFilteredFolders();

    if (filtered.length === 0) {
      const empty = this.listContainer.createDiv({ cls: "nt-empty" });
      empty.createSpan({ text: "No matching folders found." });
      return;
    }

    filtered.forEach((folderPath) => {
      const isSelected = this.selectedFolders.has(folderPath);
      const row = this.listContainer.createDiv({
        cls: `nt-folder-row ${isSelected ? "is-selected" : ""}`
      });

      const check = row.createDiv({ cls: "nt-folder-row-checkbox" });
      if (isSelected) setIcon(check, "check");

      const icon = row.createDiv({ cls: "nt-folder-icon" });
      setIcon(icon, isSelected ? "folder-x" : "folder");

      row.createDiv({ cls: "nt-folder-name", text: folderPath });

      row.addEventListener("click", () => {
        if (this.selectedFolders.has(folderPath)) {
          this.selectedFolders.delete(folderPath);
          row.removeClass("is-selected");
          check.empty();
          setIcon(icon, "folder");
        } else {
          this.selectedFolders.add(folderPath);
          row.addClass("is-selected");
          setIcon(check, "check");
          setIcon(icon, "folder-x");
        }
        this.updateBadge();
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Interactive Visual Extension Selector Modal (Multi-select, Select All, None, Invert, Category Tabs)
class ExtensionSelectorModal extends Modal {
  constructor(app, currentExcludedExtensions, onSave) {
    super(app);
    this.currentExcludedExtensions = (currentExcludedExtensions || []).map((e) =>
      e.trim().toLowerCase().replace(/^\./, "")
    );
    this.onSave = onSave;
    this.selectedExtensions = new Set(this.currentExcludedExtensions);
    this.searchQuery = "";
    this.activeCategory = "all";
  }

  onOpen() {
    this.modalEl.addClass("nt-ext-picker-modal");
    const { contentEl } = this;
    contentEl.empty();

    // 1. Top Header Bar
    const topBar = contentEl.createDiv({ cls: "nt-topbar" });
    const titleGroup = topBar.createDiv({ cls: "nt-title-group" });
    titleGroup.createEl("h2", { text: "Manage Excluded Extensions" });
    this.badgeEl = titleGroup.createSpan({
      cls: "nt-badge-count",
      text: `${this.selectedExtensions.size} excluded`
    });

    const closeBtn = topBar.createEl("button", { cls: "nt-icon-btn" });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.close());

    contentEl.createEl("p", {
      cls: "nt-muted",
      text: "Select file extensions you want to hide. Use Select All, Clear All, or Invert for fast batch configuration."
    });

    // 2. Search & Batch Actions Row
    const searchRow = contentEl.createDiv({ cls: "nt-filter-row" });
    const searchInput = searchRow.createEl("input", {
      type: "search",
      placeholder: "Filter extensions (e.g. csv, png, mp4)...",
      cls: "nt-search-input"
    });

    const quickGroup = searchRow.createDiv({ cls: "nt-btn-group" });
    quickGroup.createEl("button", { text: "Select All", cls: "nt-btn-sm" }).addEventListener("click", () => {
      const currentList = this.getFilteredExtensions();
      currentList.forEach((item) => this.selectedExtensions.add(item.ext));
      this.updateBadge();
      this.renderList();
    });
    quickGroup.createEl("button", { text: "Clear All", cls: "nt-btn-sm" }).addEventListener("click", () => {
      const currentList = this.getFilteredExtensions();
      currentList.forEach((item) => this.selectedExtensions.delete(item.ext));
      this.updateBadge();
      this.renderList();
    });
    quickGroup.createEl("button", { text: "Invert", cls: "nt-btn-sm" }).addEventListener("click", () => {
      const currentList = this.getFilteredExtensions();
      currentList.forEach((item) => {
        if (this.selectedExtensions.has(item.ext)) this.selectedExtensions.delete(item.ext);
        else this.selectedExtensions.add(item.ext);
      });
      this.updateBadge();
      this.renderList();
    });

    // 3. Category Filter Chips inside modal
    const catRow = contentEl.createDiv({ cls: "nt-chip-group" });
    const cats = [
      { id: "all", label: "All Types" },
      { id: "image", label: "Images" },
      { id: "video", label: "Videos" },
      { id: "audio", label: "Audio" },
      { id: "document", label: "Documents" }
    ];
    this.catBtns = new Map();
    cats.forEach((cat) => {
      const chip = catRow.createEl("button", {
        cls: `nt-chip mod-pill-filter ${this.activeCategory === cat.id ? "is-active" : ""}`,
        text: cat.label
      });
      chip.addEventListener("click", () => {
        if (this.activeCategory === cat.id) return;
        this.activeCategory = cat.id;
        this.catBtns.forEach((btn, id) => btn.toggleClass("is-active", id === this.activeCategory));
        this.renderList();
      });
      this.catBtns.set(cat.id, chip);
    });

    // 4. Gather all extensions from vault + known extensions
    const extMap = new Map();

    EXTENSIONS.images.forEach((e) => extMap.set(e, { ext: e, cat: "image", count: 0 }));
    EXTENSIONS.video.forEach((e) => extMap.set(e, { ext: e, cat: "video", count: 0 }));
    EXTENSIONS.audio.forEach((e) => extMap.set(e, { ext: e, cat: "audio", count: 0 }));
    EXTENSIONS.docs.forEach((e) => extMap.set(e, { ext: e, cat: "document", count: 0 }));

    const files = this.app.vault.getFiles();
    files.forEach((file) => {
      if (!file.extension) return;
      const ext = file.extension.toLowerCase();
      if (extMap.has(ext)) {
        extMap.get(ext).count++;
      } else {
        const cat = getCategory(file) || "other";
        extMap.set(ext, { ext, cat, count: 1 });
      }
    });

    this.allExtensions = Array.from(extMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.ext.localeCompare(b.ext);
    });

    // 5. Scrollable Extension List Container
    this.listContainer = contentEl.createDiv({ cls: "nt-ext-list-container" });
    this.renderList();

    searchInput.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase().replace(/^\./, "");
      this.renderList();
    });

    // 6. Action Footer
    const footer = contentEl.createDiv({ cls: "nt-modal-actions" });
    footer.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

    this.confirmBtn = footer.createEl("button", {
      text: `Apply Exclusions (${this.selectedExtensions.size})`,
      cls: "mod-cta"
    });
    this.confirmBtn.addEventListener("click", () => {
      this.close();
      if (typeof this.onSave === "function") {
        this.onSave(Array.from(this.selectedExtensions));
      }
    });
  }

  updateBadge() {
    if (this.badgeEl) {
      this.badgeEl.setText(`${this.selectedExtensions.size} excluded`);
    }
    if (this.confirmBtn) {
      this.confirmBtn.setText(`Apply Exclusions (${this.selectedExtensions.size})`);
    }
  }

  getFilteredExtensions() {
    return this.allExtensions.filter((item) => {
      if (this.activeCategory !== "all" && item.cat !== this.activeCategory) return false;
      if (this.searchQuery && !item.ext.includes(this.searchQuery)) return false;
      return true;
    });
  }

  renderList() {
    this.listContainer.empty();
    const filtered = this.getFilteredExtensions();

    if (filtered.length === 0) {
      const empty = this.listContainer.createDiv({ cls: "nt-empty" });
      empty.createSpan({ text: "No matching extensions found." });
      return;
    }

    filtered.forEach((item) => {
      const isSelected = this.selectedExtensions.has(item.ext);
      const row = this.listContainer.createDiv({
        cls: `nt-ext-row ${isSelected ? "is-selected" : ""}`
      });

      const check = row.createDiv({ cls: "nt-folder-row-checkbox" });
      if (isSelected) setIcon(check, "check");

      row.createDiv({ cls: "nt-ext-badge", text: `.${item.ext.toUpperCase()}` });
      row.createDiv({ cls: "nt-ext-cat", text: item.cat });
      row.createDiv({
        cls: "nt-ext-count",
        text: item.count > 0 ? `${item.count} in vault` : "none"
      });

      row.addEventListener("click", () => {
        if (this.selectedExtensions.has(item.ext)) {
          this.selectedExtensions.delete(item.ext);
          row.removeClass("is-selected");
          check.empty();
        } else {
          this.selectedExtensions.add(item.ext);
          row.addClass("is-selected");
          setIcon(check, "check");
        }
        this.updateBadge();
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}


/**
 * Main Media Toolbox Modal & Visual Browser
 */
class MediaToolboxModal extends Modal {
  constructor(app, plugin, targetLeaf = null, pickerOptions = null) {
    super(app);
    this.plugin = plugin;
    this.service = plugin.service;
    this.targetLeaf = targetLeaf || this.app.workspace.getMostRecentLeaf();
    this.picker = pickerOptions && typeof pickerOptions.onSelect === "function" ? pickerOptions : null;
    this.resolved = false;

    this.selected = new Set();
    this.category = this.picker?.category || "all";
    this.lockCategory = Boolean(this.picker?.lockCategory);
    this.multiple = this.picker ? Boolean(this.picker.multiple) : true;
    this.selectedFolder = this.picker?.initialFolder || "/ (All Vault)";
    this.searchQuery = "";
    this.sortMode = "mtime-desc";
    this.usageFilter = "all";
    this.selectedExtension = "all";
    this.hideExcluded = true;
    this.viewMode = this.plugin.settings.defaultViewMode || "grid";

    // Picker specific exclusion overrides
    this.pickerAllowedExtensions = this.picker?.allowedExtensions || null;
    this.pickerExcludedExtensions = this.picker?.excludeExtensions || null;
    this.pickerExcludedFolders = this.picker?.excludeFolders || null;

    this.lastClickedIndex = null;
    this.currentRenderedFiles = [];
    this.pageSize = 50;
    this.renderedCount = 50;
    this.observer = null;
    this.galleryResizeObserver = null;
    this.rowsChangedListener = null;
    this.chipButtons = new Map();
  }

  onOpen() {
    this.modalEl.addClass("nt-media-modal", "nt-media-window");
    this.setupIntersectionObserver();
    this.render();
  }

  setupIntersectionObserver() {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(async (entry) => {
          if (!entry.isIntersecting) return;
          const element = entry.target;
          this.observer.unobserve(element);

          const filePath = element.dataset.path;
          if (!filePath) return;
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (!(file instanceof TFile)) return;

          const meta = await this.service.getFullMetadata(file);
          const detailTag = element.classList.contains("nt-detail-tag")
            ? element
            : element.querySelector(".nt-detail-tag");
          if (detailTag && meta.detail) {
            detailTag.setText(meta.detail);
            detailTag.removeClass("nt-hidden");
          }
        });
      },
      { rootMargin: "250px 0px" }
    );
  }

  getModalTitle() {
    if (this.picker?.title) return this.picker.title;
    if (this.picker) {
      const labels = {
        image: "Choose Image",
        video: "Choose Video",
        audio: "Choose Audio",
        document: "Choose Document",
        all: "Choose Asset"
      };
      return labels[this.category] || "Choose Asset";
    }
    return "Media & Asset Toolbox";
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();

    // 1. Top Header
    const topBar = contentEl.createDiv({ cls: "nt-topbar" });
    const titleGroup = topBar.createDiv({ cls: "nt-title-group" });
    titleGroup.createEl("h2", { text: this.getModalTitle() });
    this.badgeEl = titleGroup.createSpan({
      cls: "nt-badge-count",
      text: `0 assets`
    });

    const topRightGroup = topBar.createDiv({ cls: "nt-btn-group" });

    // View Mode Toggle (Grid vs List) — labeled so it's easy to find, and the
    // choice is remembered as the default view for next time.
    const viewToggleBtn = topRightGroup.createEl("button", { cls: "nt-btn-sm" });
    const viewIconEl = viewToggleBtn.createSpan({ cls: "nt-btn-icon" });
    const viewLabelEl = viewToggleBtn.createSpan();
    const syncViewToggle = () => {
      if (this.viewMode === "grid") {
        setIcon(viewIconEl, "list");
        viewLabelEl.setText("List");
        setTooltip(viewToggleBtn, "Switch to List View");
      } else {
        setIcon(viewIconEl, "layout-grid");
        viewLabelEl.setText("Grid");
        setTooltip(viewToggleBtn, "Switch to Grid View");
      }
    };
    syncViewToggle();
    viewToggleBtn.addEventListener("click", () => {
      this.viewMode = this.viewMode === "grid" ? "list" : "grid";
      syncViewToggle();
      if (!this.picker) {
        this.plugin.settings.defaultViewMode = this.viewMode;
        void this.plugin.saveSettings();
      }
      this.renderViewport(true);
    });

    // Inline grid size controls (rows / columns) with live preview
    const layoutGroup = topRightGroup.createDiv({ cls: "nt-layout-group" });
    const layoutIcon = layoutGroup.createSpan({ cls: "nt-btn-icon" });
    setIcon(layoutIcon, "layout-grid");

    const rowsSelect = layoutGroup.createEl("select", { cls: "nt-layout-select" });
    for (let r = 2; r <= 6; r++) rowsSelect.createEl("option", { text: `${r} rows`, value: String(r) });
    rowsSelect.value = String(this.plugin.settings.galleryRows || 4);
    setTooltip(rowsSelect, "Visible gallery rows");

    const colsSelect = layoutGroup.createEl("select", { cls: "nt-layout-select" });
    for (let c = 2; c <= 8; c++) colsSelect.createEl("option", { text: `${c} cols`, value: String(c) });
    colsSelect.value = String(this.plugin.settings.galleryColumns || 5);
    setTooltip(colsSelect, "Gallery columns (fewer = larger previews)");

    const applyLayoutChange = () => {
      this.plugin.settings.galleryRows = Number(rowsSelect.value) || 4;
      this.plugin.settings.galleryColumns = Number(colsSelect.value) || 5;
      void this.plugin.saveSettings();
      if (this.viewMode !== "grid") {
        this.viewMode = "grid";
        syncViewToggle();
        this.renderViewport(true);
      } else {
        this.applyGalleryLayout();
      }
    };
    rowsSelect.addEventListener("change", applyLayoutChange);
    colsSelect.addEventListener("change", applyLayoutChange);

    if (!this.picker) {
      const ddBtn = topRightGroup.createEl("button", { cls: "nt-btn-sm" });
      setIcon(ddBtn.createSpan({ cls: "nt-btn-icon" }), "list-checks");
      ddBtn.createSpan({ text: "Dropdowns" });
      setTooltip(ddBtn, "Open Inline Dropdown Manager");
      ddBtn.addEventListener("click", () => {
        new DropdownManagerModal(this.app, this.plugin).open();
      });
    }

    const closeBtn = topRightGroup.createEl("button", { cls: "nt-icon-btn" });
    setIcon(closeBtn, "x");
    setTooltip(closeBtn, "Close (Esc)");
    closeBtn.addEventListener("click", () => this.close());

    // 2. Navigation Row (Category Chips on Left, Search + Reset on Right)
    const navRow = contentEl.createDiv({ cls: "nt-nav-row" });
    const navLeft = navRow.createDiv({ cls: "nt-nav-left" });
    const navRight = navRow.createDiv({ cls: "nt-nav-right" });

    // Category Filter Chips
    const categoryBar = navLeft.createDiv({ cls: "nt-chip-group" });
    this.chipButtons.clear();
    const categories = [
      { id: "all", label: "All Assets", icon: "layers" },
      { id: "image", label: "Images", icon: "image" },
      { id: "video", label: "Videos", icon: "video" },
      { id: "audio", label: "Audio", icon: "music" },
      { id: "document", label: "Documents", icon: "file-text" }
    ];

    categories.forEach((cat) => {
      if (this.lockCategory && this.category !== "all" && cat.id !== this.category) {
        return;
      }
      const chip = categoryBar.createEl("button", {
        cls: `nt-chip ${this.category === cat.id ? "is-active" : ""}`
      });
      const iconSpan = chip.createSpan({ cls: "nt-chip-icon" });
      setIcon(iconSpan, cat.icon);
      chip.createSpan({ text: cat.label });
      chip.addEventListener("click", () => {
        if (this.category === cat.id) return;
        this.category = cat.id;
        this.chipButtons.forEach((btn, id) => btn.toggleClass("is-active", id === this.category));
        this.selectedExtension = "all";
        this.updateExtensionOptions();
        this.renderViewport(true);
      });
      this.chipButtons.set(cat.id, chip);
    });

    // Search input
    const search = navRight.createEl("input", {
      type: "search",
      placeholder: "Search name or path...",
      cls: "nt-search-input"
    });
    search.value = this.searchQuery;

    const debouncedFilter = debounce(() => {
      this.renderViewport(true);
    }, 160);

    search.addEventListener("input", (e) => {
      this.searchQuery = e.target.value;
      debouncedFilter();
    });

    // Reset Filters Button
    const resetBtn = navRight.createEl("button", { cls: "nt-icon-btn" });
    setIcon(resetBtn, "rotate-ccw");
    setTooltip(resetBtn, "Reset all search & filter rules");

    // 3. Filter Row (Context Dropdowns on Left, Exclusions & Tools on Right)
    const filterRow = contentEl.createDiv({ cls: "nt-filter-row" });
    const filterLeft = filterRow.createDiv({ cls: "nt-filter-left" });
    const filterRight = filterRow.createDiv({ cls: "nt-filter-right" });

    // Folder select
    this.folderSelect = filterLeft.createEl("select", { cls: "nt-select" });
    this.service.getAllFolders().forEach((f) => {
      const opt = this.folderSelect.createEl("option", { text: f, value: f });
      opt.selected = f === this.selectedFolder;
    });
    this.folderSelect.addEventListener("change", () => {
      this.selectedFolder = this.folderSelect.value;
      this.updateExtensionOptions();
      this.renderViewport(true);
    });

    // Extension Filter Select
    this.extSelect = filterLeft.createEl("select", { cls: "nt-select" });
    this.updateExtensionOptions();
    this.extSelect.addEventListener("change", () => {
      this.selectedExtension = this.extSelect.value;
      this.renderViewport(true);
    });

    // Usage filter (All vs Orphan vs In Use)
    const usageSelect = filterLeft.createEl("select", { cls: "nt-select" });
    [
      { id: "all", label: "All Assets" },
      { id: "orphan", label: "Unused / Orphans" },
      { id: "linked", label: "In Use (Linked)" }
    ].forEach((u) => {
      const opt = usageSelect.createEl("option", { text: u.label, value: u.id });
      opt.selected = u.id === this.usageFilter;
    });
    usageSelect.addEventListener("change", () => {
      this.usageFilter = usageSelect.value;
      this.renderViewport(true);
    });

    // Sort select
    this.sortSelect = filterLeft.createEl("select", { cls: "nt-select" });
    [
      { id: "mtime-desc", label: "Date (Newest)" },
      { id: "mtime-asc", label: "Date (Oldest)" },
      { id: "name-asc", label: "Name (A–Z)" },
      { id: "name-desc", label: "Name (Z–A)" },
      { id: "size-desc", label: "Size (Largest)" },
      { id: "size-asc", label: "Size (Smallest)" }
    ].forEach((s) => {
      const opt = this.sortSelect.createEl("option", { text: s.label, value: s.id });
      opt.selected = s.id === this.sortMode;
    });
    this.sortSelect.addEventListener("change", () => {
      this.sortMode = this.sortSelect.value;
      this.renderViewport(true);
    });

    // Toggle Exclusions Button
    const excludeToggleBtn = filterRight.createEl("button", {
      cls: `nt-btn-sm ${this.hideExcluded ? "is-active" : ""}`
    });
    setIcon(excludeToggleBtn.createSpan({ cls: "nt-btn-icon" }), "filter");
    const excludeText = excludeToggleBtn.createSpan({
      text: this.hideExcluded ? "Exclusions On" : "Show All"
    });
    setTooltip(
      excludeToggleBtn,
      this.hideExcluded
        ? "Excluded folders/extensions are hidden. Click to show all."
        : "Showing all files. Click to hide excluded."
    );
    excludeToggleBtn.addEventListener("click", () => {
      this.hideExcluded = !this.hideExcluded;
      excludeToggleBtn.toggleClass("is-active", this.hideExcluded);
      excludeText.setText(this.hideExcluded ? "Exclusions On" : "Show All");
      setTooltip(
        excludeToggleBtn,
        this.hideExcluded
          ? "Excluded folders/extensions are hidden. Click to show all."
          : "Showing all files. Click to hide excluded."
      );
      this.updateExtensionOptions();
      this.renderViewport(true);
    });

    // Configure Excluded Folders Button (Graphical Folder Picker)
    const manageExclusionsBtn = filterRight.createEl("button", { cls: "nt-icon-btn" });
    setIcon(manageExclusionsBtn, "folder-cog");
    setTooltip(manageExclusionsBtn, "Browse & select excluded folders graphically");
    manageExclusionsBtn.addEventListener("click", () => {
      new FolderSelectorModal(
        this.app,
        this.plugin.settings.excludedFolders || [],
        async (selected) => {
          this.plugin.settings.excludedFolders = selected;
          await this.plugin.saveSettings();
          this.updateExtensionOptions();
          this.renderViewport(true);
          new Notice(`Updated excluded folders (${selected.length} excluded).`);
        }
      ).open();
    });

    // Configure Excluded Extensions Button (Graphical Extension Picker)
    const manageExtBtn = filterRight.createEl("button", { cls: "nt-icon-btn" });
    setIcon(manageExtBtn, "file-cog");
    setTooltip(manageExtBtn, "Browse & select excluded file extensions graphically");
    manageExtBtn.addEventListener("click", () => {
      new ExtensionSelectorModal(
        this.app,
        this.plugin.settings.excludedExtensions || [],
        async (selected) => {
          this.plugin.settings.excludedExtensions = selected;
          await this.plugin.saveSettings();
          this.updateExtensionOptions();
          this.renderViewport(true);
          new Notice(`Updated excluded extensions (${selected.length} excluded).`);
        }
      ).open();
    });

    // Reset button action handler
    resetBtn.addEventListener("click", () => {
      search.value = "";
      this.searchQuery = "";
      this.selectedFolder = "/ (All Vault)";
      this.folderSelect.value = "/ (All Vault)";
      this.usageFilter = "all";
      usageSelect.value = "all";
      this.selectedExtension = "all";
      this.sortMode = "mtime-desc";
      this.sortSelect.value = "mtime-desc";
      this.hideExcluded = true;
      excludeToggleBtn.addClass("is-active");
      excludeText.setText("Exclusions On");
      this.updateExtensionOptions();
      this.renderViewport(true);
    });

    // 4. Action Toolbar
    const actionToolbar = contentEl.createDiv({ cls: "nt-actions-toolbar" });

    const selectGroup = actionToolbar.createDiv({ cls: "nt-btn-group" });
    if (this.multiple) {
      selectGroup.createEl("button", { text: "All", cls: "nt-btn-sm" }).addEventListener("click", () => {
        this.currentRenderedFiles.forEach((f) => this.selected.add(f.path));
        this.updateSelectionState();
        this.updateSelectionVisuals();
      });
      selectGroup.createEl("button", { text: "None", cls: "nt-btn-sm" }).addEventListener("click", () => {
        this.selected.clear();
        this.updateSelectionState();
        this.updateSelectionVisuals();
      });
      selectGroup.createEl("button", { text: "Invert", cls: "nt-btn-sm" }).addEventListener("click", () => {
        this.currentRenderedFiles.forEach((f) => {
          if (this.selected.has(f.path)) this.selected.delete(f.path);
          else this.selected.add(f.path);
        });
        this.updateSelectionState();
        this.updateSelectionVisuals();
      });
    } else {
      selectGroup.createSpan({
        cls: "nt-picker-hint",
        text: "Click to select • Double-click or press Enter to choose • Space for Quick Look"
      });
    }

    const opsGroup = actionToolbar.createDiv({ cls: "nt-btn-group" });

    const btnInsert = opsGroup.createEl("button", { cls: "nt-btn-mint" });
    setIcon(btnInsert.createSpan({ cls: "nt-btn-icon" }), this.picker ? "check" : "paperclip");
    btnInsert.createSpan({ text: this.picker ? "Choose" : "Insert" });
    setTooltip(
      btnInsert,
      this.picker
        ? "Use selected file"
        : "Insert selected assets into active View, Canvas, or Excalidraw"
    );
    btnInsert.addEventListener("click", () => this.handleInsertSelected());

    const btnMove = opsGroup.createEl("button", { cls: "nt-btn-sm" });
    setIcon(btnMove.createSpan({ cls: "nt-btn-icon" }), "folder-input");
    btnMove.createSpan({ text: "Move" });
    btnMove.addEventListener("click", () => this.handleMoveSelected());

    if (!this.picker) {
      const btnBatch = opsGroup.createEl("button", { cls: "nt-btn-sm" });
      setIcon(btnBatch.createSpan({ cls: "nt-btn-icon" }), "file-edit");
      btnBatch.createSpan({ text: "Sequence" });
      setTooltip(btnBatch, "Batch sequence rename");
      btnBatch.addEventListener("click", () => this.handleBatchRename());
    }

    const btnRename = opsGroup.createEl("button", { cls: "nt-btn-sm" });
    setIcon(btnRename.createSpan({ cls: "nt-btn-icon" }), "pencil");
    btnRename.createSpan({ text: "Rename" });
    btnRename.addEventListener("click", () => this.handleSingleRename());

    const btnTrash = opsGroup.createEl("button", { cls: "nt-btn-sm mod-warning" });
    setIcon(btnTrash.createSpan({ cls: "nt-btn-icon" }), "trash-2");
    btnTrash.createSpan({ text: "Trash" });
    btnTrash.addEventListener("click", () => this.handleTrashSelected());

    // 5. Scrollable Viewport Wrapper
    this.viewportWrapper = contentEl.createDiv({ cls: "nt-viewport-wrapper" });
    this.viewportContainer = this.viewportWrapper.createDiv();

    // Responsive gallery engine: keeps thumbnail boxes ~16:9 while honoring the
    // configurable row count. Re-runs on window resize & settings change.
    this.galleryResizeObserver = new ResizeObserver(debounce(() => this.applyGalleryLayout(), 100));
    this.galleryResizeObserver.observe(this.viewportWrapper);
    this.rowsChangedListener = () => this.applyGalleryLayout();
    window.addEventListener("nt-gallery-rows-changed", this.rowsChangedListener);

    // Floating Scroll-To-Top Button
    this.scrollTopBtn = this.viewportWrapper.createEl("button", { cls: "nt-scroll-top-btn" });
    setIcon(this.scrollTopBtn.createSpan({ cls: "nt-btn-icon" }), "arrow-up");
    this.scrollTopBtn.createSpan({ text: "Top" });
    this.scrollTopBtn.addEventListener("click", () => {
      this.viewportContainer.scrollTo({ top: 0, behavior: "smooth" });
    });

    this.renderViewport(true);
  }

  updateExtensionOptions() {
    if (!this.extSelect) return;
    this.extSelect.empty();

    const currentExt = this.selectedExtension;
    this.extSelect.createEl("option", { text: "All Extensions", value: "all" });

    // Find all matching extensions present in current category (skip sorting for speed)
    const files = this.service.getValidFiles(
      this.category,
      this.selectedFolder,
      this.searchQuery,
      this.sortMode,
      this.usageFilter,
      "all",
      this.hideExcluded,
      false,
      this.pickerAllowedExtensions,
      this.pickerExcludedExtensions,
      this.pickerExcludedFolders,
      true
    );

    const extCounts = new Map();
    files.forEach((f) => {
      const ext = f.extension.toLowerCase();
      extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
    });

    const sortedExts = Array.from(extCounts.keys()).sort();
    sortedExts.forEach((ext) => {
      const opt = this.extSelect.createEl("option", {
        text: `.${ext.toUpperCase()} (${extCounts.get(ext)})`,
        value: ext
      });
      if (ext === currentExt) opt.selected = true;
    });
  }

  updateSelectionState() {
    if (this.badgeEl) {
      const total = this.currentRenderedFiles.length;
      if (this.selected.size > 0) {
        this.badgeEl.setText(`${total} asset${total === 1 ? "" : "s"} • ${this.selected.size} selected`);
      } else {
        this.badgeEl.setText(`${total} asset${total === 1 ? "" : "s"}`);
      }
    }
  }

  updateSelectionVisuals() {
    if (!this.viewportContainer) return;
    const cards = this.viewportContainer.querySelectorAll(".nt-card, .nt-list-row");
    cards.forEach((el) => {
      const path = el.dataset.path;
      if (path) {
        el.toggleClass("is-selected", this.selected.has(path));
      }
    });
  }

  renderViewport(resetScroll = true) {
    if (this.observer) this.observer.disconnect();
    this.viewportContainer.empty();
    if (resetScroll) {
      this.renderedCount = this.pageSize;
    }

    this.currentRenderedFiles = this.service.getValidFiles(
      this.category,
      this.selectedFolder,
      this.searchQuery,
      this.sortMode,
      this.usageFilter,
      this.selectedExtension,
      this.hideExcluded,
      false,
      this.pickerAllowedExtensions,
      this.pickerExcludedExtensions,
      this.pickerExcludedFolders
    );

    this.updateSelectionState();

    if (this.currentRenderedFiles.length === 0) {
      this.viewportContainer.className = "nt-empty-wrap";
      const empty = this.viewportContainer.createDiv({ cls: "nt-empty" });
      const emptyIcon = empty.createDiv({ cls: "nt-empty-icon" });
      setIcon(emptyIcon, "search-x");
      empty.createEl("strong", { text: "No matching assets found" });
      empty.createSpan({ text: "Try adjusting search query, filters, or extension exclusion rules." });
      return;
    }

    if (this.viewMode === "grid") {
      this.renderGridView(resetScroll);
    } else {
      this.renderListView(resetScroll);
    }

    // Attach scroll listeners for lazy loading & Scroll to Top button with requestAnimationFrame
    let scrollTicking = false;
    this.viewportContainer.onscroll = () => {
      if (!scrollTicking) {
        scrollTicking = true;
        requestAnimationFrame(() => {
          scrollTicking = false;
          if (!this.viewportContainer) return;
          const { scrollTop, clientHeight, scrollHeight } = this.viewportContainer;

          if (this.scrollTopBtn) {
            this.scrollTopBtn.toggleClass("is-visible", scrollTop > 140);
          }

          if (scrollTop + clientHeight >= scrollHeight - 300) {
            if (this.renderedCount < this.currentRenderedFiles.length) {
              const nextBatch = this.currentRenderedFiles.slice(
                this.renderedCount,
                this.renderedCount + this.pageSize
              );
              const startIndex = this.renderedCount;
              this.renderedCount += nextBatch.length;

              const fragment = document.createDocumentFragment();
              if (this.viewMode === "grid") {
                nextBatch.forEach((file, idx) => {
                  const meta = this.service.getBaseMetadata(file);
                  this.buildCard(fragment, file, meta, startIndex + idx);
                });
                this.viewportContainer.appendChild(fragment);
              } else {
                const tbody = this.viewportContainer.querySelector("tbody");
                if (tbody) {
                  nextBatch.forEach((file, idx) => {
                    const meta = this.service.getBaseMetadata(file);
                    this.buildListRow(fragment, file, meta, startIndex + idx);
                  });
                  tbody.appendChild(fragment);
                }
              }
            }
          }
        });
      }
    };
  }

  renderGridView(resetScroll = true) {
    this.viewportContainer.className = "nt-grid-viewport";
    if (resetScroll) this.viewportContainer.scrollTop = 0;

    const filesToRender = this.currentRenderedFiles.slice(0, this.renderedCount);
    const fragment = document.createDocumentFragment();
    filesToRender.forEach((file, index) => {
      const meta = this.service.getBaseMetadata(file);
      this.buildCard(fragment, file, meta, index);
    });
    this.viewportContainer.appendChild(fragment);
    this.applyGalleryLayout();
  }

  /**
   * Applies the configured grid geometry: exactly `galleryRows` rows are
   * visible per screen and `galleryColumns` columns are used, so tile size
   * (and therefore preview size) is fully user-controlled. Thumbnail images
   * fill their tile with a symmetric center crop (`object-fit: cover`).
   */
  applyGalleryLayout() {
    const vp = this.viewportContainer;
    if (!vp || !vp.classList.contains("nt-grid-viewport")) return;
    const rows = Math.max(2, Math.min(6, Number(this.plugin.settings.galleryRows) || 4));
    const GAP = 12; // must match --nt-gallery gap in styles.css
    const PAD = 12; // viewport padding (12px top + bottom)

    const contentH = vp.clientHeight - PAD * 2;
    if (contentH < 140 || vp.clientWidth < 140) return;

    const rowH = Math.floor((contentH - (rows - 1) * GAP) / rows);
    const cols = Math.max(1, Math.min(12, Number(this.plugin.settings.galleryColumns) || 5));

    vp.style.setProperty("--nt-gallery-rows", String(rows));
    vp.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    vp.style.gridAutoRows = `${rowH}px`;
  }

  renderListView(resetScroll = true) {
    this.viewportContainer.className = "nt-list-viewport";
    if (resetScroll) this.viewportContainer.scrollTop = 0;

    const table = this.viewportContainer.createEl("table", { cls: "nt-list-table" });
    const thead = table.createEl("thead");
    const hrow = thead.createEl("tr");

    hrow.createEl("th", { text: "", cls: "cell-thumb" });

    // Clickable interactive sort headers
    const thName = hrow.createEl("th", { cls: "nt-sortable-th", text: "Name & Path" });
    if (this.sortMode === "name-asc" || this.sortMode === "name-desc") {
      thName.createSpan({ cls: "nt-sort-arrow", text: this.sortMode === "name-asc" ? " ▲" : " ▼" });
    }
    thName.addEventListener("click", () => {
      this.sortMode = this.sortMode === "name-asc" ? "name-desc" : "name-asc";
      if (this.sortSelect) this.sortSelect.value = this.sortMode;
      this.renderViewport(true);
    });

    const thType = hrow.createEl("th", { cls: "nt-sortable-th", text: "Type" });
    if (this.sortMode === "ext-asc" || this.sortMode === "ext-desc") {
      thType.createSpan({ cls: "nt-sort-arrow", text: this.sortMode === "ext-asc" ? " ▲" : " ▼" });
    }
    thType.addEventListener("click", () => {
      this.sortMode = this.sortMode === "ext-asc" ? "ext-desc" : "ext-asc";
      if (this.sortSelect) this.sortSelect.value = this.sortMode;
      this.renderViewport(true);
    });

    hrow.createEl("th", { text: "Details" });

    const thSize = hrow.createEl("th", { cls: "nt-sortable-th", text: "Size" });
    if (this.sortMode === "size-desc" || this.sortMode === "size-asc") {
      thSize.createSpan({ cls: "nt-sort-arrow", text: this.sortMode === "size-desc" ? " ▼" : " ▲" });
    }
    thSize.addEventListener("click", () => {
      this.sortMode = this.sortMode === "size-desc" ? "size-asc" : "size-desc";
      if (this.sortSelect) this.sortSelect.value = this.sortMode;
      this.renderViewport(true);
    });

    const thDate = hrow.createEl("th", { cls: "nt-sortable-th", text: "Date Modified" });
    if (this.sortMode === "mtime-desc" || this.sortMode === "mtime-asc") {
      thDate.createSpan({ cls: "nt-sort-arrow", text: this.sortMode === "mtime-desc" ? " ▼" : " ▲" });
    }
    thDate.addEventListener("click", () => {
      this.sortMode = this.sortMode === "mtime-desc" ? "mtime-asc" : "mtime-desc";
      if (this.sortSelect) this.sortSelect.value = this.sortMode;
      this.renderViewport(true);
    });

    hrow.createEl("th", { text: "Actions", cls: "cell-actions" });

    const tbody = table.createEl("tbody");
    const filesToRender = this.currentRenderedFiles.slice(0, this.renderedCount);
    const fragment = document.createDocumentFragment();

    filesToRender.forEach((file, index) => {
      const meta = this.service.getBaseMetadata(file);
      this.buildListRow(fragment, file, meta, index);
    });
    tbody.appendChild(fragment);
  }

  buildCard(container, file, meta, index) {
    const isSelected = this.selected.has(file.path);
    const card = document.createElement("div");
    card.className = `nt-card ${isSelected ? "is-selected" : ""}`;
    container.appendChild(card);

    card.dataset.path = file.path;
    card.dataset.index = String(index);
    card.tabIndex = 0;
    card.setAttribute("draggable", "true");

    card.addEventListener("dragstart", (evt) => {
      const draggedFiles = this.selected.has(file.path) ? this.getSelectedFiles() : [file];
      const activeFilePath = this.app.workspace.getActiveFile()?.path || "";
      const links = draggedFiles
        .map((f) => {
          const link = this.app.fileManager.generateMarkdownLink(f, activeFilePath);
          return link.startsWith("!") ? link : `!${link}`;
        })
        .join("\n");

      evt.dataTransfer.setData("text/plain", links);
      evt.dataTransfer.setData("text/uri-list", this.app.vault.getResourcePath(file));
    });

    const checkBadge = card.createDiv({ cls: "nt-card-check" });
    setIcon(checkBadge, "check");

    const thumb = card.createDiv({ cls: "nt-card-thumb" });
    if (meta.type === "image") {
      thumb.createEl("img", {
        attr: { src: this.app.vault.getResourcePath(file), loading: "lazy", alt: file.name }
      });
    } else if (meta.type === "video") {
      const badge = thumb.createDiv({ cls: "nt-badge-media mod-video" });
      setIcon(badge.createDiv({ cls: "nt-badge-icon" }), "video");
      badge.createSpan({ text: "VIDEO" });
    } else if (meta.type === "audio") {
      const badge = thumb.createDiv({ cls: "nt-badge-media mod-audio" });
      setIcon(badge.createDiv({ cls: "nt-badge-icon" }), "music");
      badge.createSpan({ text: "AUDIO" });
    } else {
      const badge = thumb.createDiv({ cls: "nt-badge-media mod-doc" });
      setIcon(badge.createDiv({ cls: "nt-badge-icon" }), "file-text");
      badge.createSpan({ text: meta.ext });
    }

    const metaWrap = card.createDiv({ cls: "nt-card-details" });
    const title = metaWrap.createDiv({ cls: "nt-card-title", text: file.name });
    setTooltip(title, file.path);

    const chips = metaWrap.createDiv({ cls: "nt-card-meta-chips" });
    chips.createSpan({ cls: "nt-tag-chip", text: meta.ext });

    const cached = this.service.cache.get(file.path);
    const detailText = cached?.detail || meta.detail;
    const detailTag = chips.createSpan({
      cls: `nt-tag-chip nt-detail-tag ${detailText ? "" : "nt-hidden"}`
    });
    if (detailText) detailTag.setText(detailText);

    chips.createSpan({ cls: "nt-tag-chip", text: meta.size });

    card.addEventListener("click", (evt) => {
      this.handleCardClick(evt, index, file, card);
    });

    card.addEventListener("dblclick", () => {
      if (this.picker) {
        this.resolvePicker([file]);
      } else {
        void this.insertTargetFile(file, 0, true);
      }
    });

    card.addEventListener("keydown", (evt) => {
      if (evt.key === " ") {
        evt.preventDefault();
        void this.openQuickLook(file);
      } else if (evt.key === "Enter") {
        evt.preventDefault();
        if (this.picker) {
          this.resolvePicker([file]);
        } else {
          void this.insertTargetFile(file, 0, true);
        }
      } else if (evt.key === "ArrowRight") {
        evt.preventDefault();
        const next = card.nextElementSibling;
        if (next && next.classList.contains("nt-card")) next.focus();
      } else if (evt.key === "ArrowLeft") {
        evt.preventDefault();
        const prev = card.previousElementSibling;
        if (prev && prev.classList.contains("nt-card")) prev.focus();
      }
    });

    card.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      this.showContextMenu(evt, file, meta);
    });

    if (this.observer) this.observer.observe(card);
  }

  buildListRow(container, file, meta, index) {
    const isSelected = this.selected.has(file.path);
    const row = document.createElement("tr");
    row.className = `nt-list-row ${isSelected ? "is-selected" : ""}`;
    container.appendChild(row);

    row.dataset.path = file.path;
    row.dataset.index = String(index);

    // 1. Mini Thumb / Icon
    const thumbCell = row.createEl("td", { cls: "nt-list-cell cell-thumb" });
    const miniThumb = thumbCell.createDiv({ cls: "nt-list-mini-thumb" });
    if (meta.type === "image") {
      miniThumb.createEl("img", {
        attr: { src: this.app.vault.getResourcePath(file), loading: "lazy", alt: file.name }
      });
    } else if (meta.type === "video") {
      setIcon(miniThumb, "video");
    } else if (meta.type === "audio") {
      setIcon(miniThumb, "music");
    } else {
      setIcon(miniThumb, "file-text");
    }

    // 2. Name & Clickable Path
    const nameCell = row.createEl("td", { cls: "nt-list-cell" });
    const nameCol = nameCell.createDiv({ cls: "nt-list-name-col" });
    nameCol.createDiv({ cls: "nt-list-name", text: file.name });
    const pathEl = nameCol.createDiv({ cls: "nt-list-path", text: file.path });
    setTooltip(pathEl, "Click to filter to this folder");
    pathEl.addEventListener("click", (evt) => {
      evt.stopPropagation();
      const parentFolder = file.parent ? file.parent.path : "/ (All Vault)";
      this.selectedFolder = parentFolder;
      if (this.folderSelect) this.folderSelect.value = parentFolder;
      this.updateExtensionOptions();
      this.renderViewport(true);
    });

    // 3. Type
    row.createEl("td", { cls: "nt-list-cell", text: meta.ext });

    // 4. Details
    const detailCell = row.createEl("td", { cls: "nt-list-cell nt-detail-tag", text: meta.detail || "—" });
    const cached = this.service.cache.get(file.path);
    if (cached?.detail) detailCell.setText(cached.detail);

    // 5. Size
    row.createEl("td", { cls: "nt-list-cell", text: meta.size });

    // 6. Modified Date
    const mdate = new Date(meta.mtime).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
    row.createEl("td", { cls: "nt-list-cell", text: mdate });

    // 7. Inline Hover Quick Actions
    const actionCell = row.createEl("td", { cls: "nt-list-cell cell-actions" });
    const actionWrap = actionCell.createDiv({ cls: "nt-list-row-actions" });

    const btnInsert = actionWrap.createEl("button", { cls: "nt-icon-btn" });
    setIcon(btnInsert, this.picker ? "check" : "paperclip");
    setTooltip(btnInsert, this.picker ? "Choose" : "Insert to active view");
    btnInsert.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (this.picker) this.resolvePicker([file]);
      else void this.insertTargetFile(file, 0, true);
    });

    const btnEye = actionWrap.createEl("button", { cls: "nt-icon-btn" });
    setIcon(btnEye, "eye");
    setTooltip(btnEye, "Quick Look");
    btnEye.addEventListener("click", (evt) => {
      evt.stopPropagation();
      void this.openQuickLook(file);
    });

    const btnCopy = actionWrap.createEl("button", { cls: "nt-icon-btn" });
    setIcon(btnCopy, "copy");
    setTooltip(btnCopy, "Copy Markdown Link");
    btnCopy.addEventListener("click", async (evt) => {
      evt.stopPropagation();
      let link = this.app.fileManager.generateMarkdownLink(file, "");
      if (meta.type !== "document" && !link.startsWith("!")) link = `!${link}`;
      await navigator.clipboard.writeText(link);
      new Notice("Link copied to clipboard.");
    });

    const btnTrash = actionWrap.createEl("button", { cls: "nt-icon-btn mod-warning" });
    setIcon(btnTrash, "trash-2");
    setTooltip(btnTrash, "Move to trash");
    btnTrash.addEventListener("click", (evt) => {
      evt.stopPropagation();
      new ConfirmModal(this.app, {
        title: `Move "${file.name}" to Trash?`,
        message: "Are you sure you want to move this file to your vault trash?",
        confirmText: "Move to Trash",
        isDanger: true,
        onConfirm: async () => {
          await this.app.fileManager.trashFile(file);
          this.service.cache.delete(file.path);
          this.selected.delete(file.path);
          this.updateSelectionState();
          this.renderViewport(false);
          new Notice(`Moved "${file.name}" to trash.`);
        }
      }).open();
    });

    row.addEventListener("click", (evt) => {
      this.handleCardClick(evt, index, file, row);
    });

    row.addEventListener("dblclick", () => {
      if (this.picker) {
        this.resolvePicker([file]);
      } else {
        void this.insertTargetFile(file, 0, true);
      }
    });

    row.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      this.showContextMenu(evt, file, meta);
    });

    if (this.observer) this.observer.observe(row);
  }

  handleCardClick(evt, index, file, element) {
    if (!this.multiple) {
      const already = this.selected.has(file.path);
      this.selected.clear();
      this.viewportContainer.querySelectorAll(".is-selected").forEach((el) => {
        el.removeClass("is-selected");
      });
      if (!already) {
        this.selected.add(file.path);
        element.addClass("is-selected");
      }
      this.lastClickedIndex = index;
      this.updateSelectionState();
      return;
    }

    if (evt.shiftKey && this.lastClickedIndex !== null && this.lastClickedIndex !== index) {
      const start = Math.min(this.lastClickedIndex, index);
      const end = Math.max(this.lastClickedIndex, index);
      const targetMode = !this.selected.has(file.path);

      for (let i = start; i <= end; i++) {
        const item = this.currentRenderedFiles[i];
        if (item) {
          if (targetMode) this.selected.add(item.path);
          else this.selected.delete(item.path);
        }
      }
      this.updateSelectionState();
      this.updateSelectionVisuals();
    } else {
      if (this.selected.has(file.path)) {
        this.selected.delete(file.path);
        element.removeClass("is-selected");
      } else {
        this.selected.add(file.path);
        element.addClass("is-selected");
      }
      this.lastClickedIndex = index;
      this.updateSelectionState();
    }
  }

  showContextMenu(evt, file, meta) {
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle(this.picker ? "Choose This File" : "Insert to Active View")
        .setIcon(this.picker ? "check" : "paperclip")
        .onClick(() => {
          if (this.picker) this.resolvePicker([file]);
          else void this.insertTargetFile(file, 0, true);
        });
    });

    menu.addItem((item) => {
      item.setTitle("Quick Look Preview")
        .setIcon("eye")
        .onClick(() => void this.openQuickLook(file));
    });

    menu.addItem((item) => {
      item.setTitle("Copy Markdown Link")
        .setIcon("copy")
        .onClick(async () => {
          const activePath = this.app.workspace.getActiveFile()?.path || "";
          let link = this.app.fileManager.generateMarkdownLink(file, activePath);
          if (meta.type !== "document" && !link.startsWith("!")) link = `!${link}`;
          await navigator.clipboard.writeText(link);
          new Notice("Link copied to clipboard.");
        });
    });

    menu.addSeparator();

    // Contextual Folder and Extension Exclusion shortcuts
    if (file.parent && file.parent.path !== "/") {
      menu.addItem((item) => {
        item.setTitle(`Exclude Folder "${file.parent.name}"`)
          .setIcon("folder-minus")
          .onClick(async () => {
            const path = file.parent.path;
            const ex = this.plugin.settings.excludedFolders || [];
            if (!ex.includes(path)) {
              ex.push(path);
              this.plugin.settings.excludedFolders = ex;
              await this.plugin.saveSettings();
              new Notice(`Excluded folder "${path}".`);
              this.renderViewport(true);
            }
          });
      });

      menu.addItem((item) => {
        item.setTitle(`Focus Folder "${file.parent.name}" Only`)
          .setIcon("folder")
          .onClick(() => {
            this.selectedFolder = file.parent.path;
            if (this.folderSelect) this.folderSelect.value = file.parent.path;
            this.updateExtensionOptions();
            this.renderViewport(true);
          });
      });
    }

    menu.addItem((item) => {
      item.setTitle(`Exclude Extension (.${file.extension.toLowerCase()})`)
        .setIcon("file-minus")
        .onClick(async () => {
          const ext = file.extension.toLowerCase();
          const ex = this.plugin.settings.excludedExtensions || [];
          if (!ex.includes(ext)) {
            ex.push(ext);
            this.plugin.settings.excludedExtensions = ex;
            await this.plugin.saveSettings();
            new Notice(`Excluded .${ext} files.`);
            this.updateExtensionOptions();
            this.renderViewport(true);
          }
        });
    });

    menu.addItem((item) => {
      item.setTitle("Browse & Select Excluded Folders...")
        .setIcon("folder-cog")
        .onClick(() => {
          new FolderSelectorModal(
            this.app,
            this.plugin.settings.excludedFolders || [],
            async (selected) => {
              this.plugin.settings.excludedFolders = selected;
              await this.plugin.saveSettings();
              this.updateExtensionOptions();
              this.renderViewport(true);
              new Notice(`Updated excluded folders (${selected.length} excluded).`);
            }
          ).open();
        });
    });

    menu.addItem((item) => {
      item.setTitle("Browse & Select Excluded Extensions...")
        .setIcon("file-cog")
        .onClick(() => {
          new ExtensionSelectorModal(
            this.app,
            this.plugin.settings.excludedExtensions || [],
            async (selected) => {
              this.plugin.settings.excludedExtensions = selected;
              await this.plugin.saveSettings();
              this.updateExtensionOptions();
              this.renderViewport(true);
              new Notice(`Updated excluded extensions (${selected.length} excluded).`);
            }
          ).open();
        });
    });

    menu.addSeparator();

    if (typeof this.app.showInFolder === "function") {
      menu.addItem((item) => {
        item.setTitle("Show in System Explorer")
          .setIcon("folder")
          .onClick(() => this.app.showInFolder(file.path));
      });
    }

    if (typeof this.app.openWithDefaultApp === "function") {
      menu.addItem((item) => {
        item.setTitle("Open with Default App")
          .setIcon("external-link")
          .onClick(() => this.app.openWithDefaultApp(file.path));
      });
    }

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle("Rename")
        .setIcon("pencil")
        .onClick(() => {
          this.selected.clear();
          this.selected.add(file.path);
          this.handleSingleRename();
        });
    });

    menu.addItem((item) => {
      item.setTitle("Move to Trash")
        .setIcon("trash-2")
        .setWarning(true)
        .onClick(() => {
          new ConfirmModal(this.app, {
            title: `Move "${file.name}" to Trash?`,
            message: `Are you sure you want to move this file to your vault trash?`,
            confirmText: "Move to Trash",
            isDanger: true,
            onConfirm: async () => {
              await this.app.fileManager.trashFile(file);
              this.service.cache.delete(file.path);
              this.selected.delete(file.path);
              this.updateSelectionState();
              this.renderViewport(false);
              new Notice(`Moved "${file.name}" to trash.`);
            }
          }).open();
        });
    });

    menu.showAtMouseEvent(evt);
  }

  async openQuickLook(file) {
    const fullMeta = await this.service.getFullMetadata(file);
    new QuickLookModal(
      this.app,
      file,
      fullMeta,
      (target) => {
        if (this.picker) this.resolvePicker([target]);
        else void this.insertTargetFile(target, 0, true);
      },
      this.picker ? "Choose" : "Insert / Attach"
    ).open();
  }

  resolvePicker(files) {
    if (!this.picker || !files.length) return;
    this.resolved = true;
    const chosen = this.multiple ? files : files[0];
    const chosenPath = this.multiple ? files.map((f) => f.path) : files[0].path;
    const richPayload = this.plugin.createAssetPayload(chosen);

    this.close();
    this.picker.onSelect(chosen, chosenPath, richPayload);
  }

  async insertTargetFile(file, offsetIndex = 0, closeAfter = true) {
    if (this.picker) {
      this.resolvePicker([file]);
      return "picker";
    }

    const targetView = this.targetLeaf?.view || this.app.workspace.getActiveViewOfType(MarkdownView);
    const viewType = targetView?.getViewType();

    // 1. Obsidian Canvas Direct Insertion
    if (viewType === "canvas" && targetView.canvas) {
      const canvas = targetView.canvas;
      const step = offsetIndex * 28;
      const x = (canvas.x || 0) + (canvas.zoom ? (80 + step) / canvas.zoom : 50 + step);
      const y = (canvas.y || 0) + (canvas.zoom ? (80 + step) / canvas.zoom : 50 + step);

      if (typeof canvas.createFileNode === "function") {
        canvas.createFileNode({
          file: file,
          pos: { x, y },
          size: { width: 340, height: 280 },
          save: true
        });
        if (typeof canvas.requestSave === "function") canvas.requestSave();
        if (closeAfter) {
          new Notice(`Added "${file.name}" to Canvas.`);
          this.close();
        }
        return "canvas";
      }
    }

    // 2. Excalidraw Direct Insertion
    if (viewType === "excalidraw") {
      const excalPlugin = this.app.plugins?.plugins?.["obsidian-excalidraw-plugin"];
      if (excalPlugin && excalPlugin.ea) {
        try {
          const ea = excalPlugin.ea;
          ea.reset();
          ea.setView(targetView);
          const pos = offsetIndex * 24;
          const isImg = EXTENSIONS.images.has(file.extension.toLowerCase());
          if (isImg && typeof ea.addImage === "function") {
            await ea.addImage(pos, pos, file);
          } else if (typeof ea.addEmbeddable === "function") {
            await ea.addEmbeddable(pos, pos, 420, 320, null, file);
          }
          await ea.addElementsToView(true, true);
          if (closeAfter) {
            new Notice(`Inserted "${file.name}" into Excalidraw.`);
            this.close();
          }
          return "excalidraw";
        } catch (err) {
          console.error("Excalidraw insert failed", err);
        }
      }
    }

    // 3. Markdown Note Direct Insertion
    if (targetView instanceof MarkdownView && targetView.editor) {
      const activePath = targetView.file?.path || "";
      let link = this.app.fileManager.generateMarkdownLink(file, activePath);
      const type = getCategory(file);
      if (type !== "document" && !link.startsWith("!")) {
        link = `!${link}`;
      }
      targetView.editor.replaceSelection(`${link}\n`);
      if (closeAfter) {
        new Notice(`Inserted: ${file.name}`);
        this.close();
      }
      return "markdown";
    }

    // 4. Fallback (Copy Link)
    if (closeAfter) {
      let link = this.app.fileManager.generateMarkdownLink(file, "");
      if (getCategory(file) !== "document" && !link.startsWith("!")) {
        link = `!${link}`;
      }
      await navigator.clipboard.writeText(link);
      new Notice(`Copied "${link}" to clipboard.`);
      this.close();
    }
    return "clipboard";
  }

  getSelectedFiles() {
    const files = [];
    for (const path of this.selected) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) files.push(file);
    }
    return files;
  }

  async handleInsertSelected() {
    const files = this.getSelectedFiles();
    if (!files.length) {
      return new Notice(this.picker ? "Select a file first." : "Select files to insert.");
    }

    if (this.picker) {
      this.resolvePicker(files);
      return;
    }

    const targetView = this.targetLeaf?.view || this.app.workspace.getActiveViewOfType(MarkdownView);
    if (targetView instanceof MarkdownView && targetView.editor) {
      const activePath = targetView.file?.path || "";
      const textToInsert = files
        .map((f) => {
          let link = this.app.fileManager.generateMarkdownLink(f, activePath);
          if (getCategory(f) !== "document" && !link.startsWith("!")) link = `!${link}`;
          return link;
        })
        .join("\n") + "\n";

      targetView.editor.replaceSelection(textToInsert);
      new Notice(`Inserted ${files.length} asset(s).`);
      this.close();
      return;
    }

    let mode = "";
    for (let i = 0; i < files.length; i++) {
      mode = await this.insertTargetFile(files[i], i, false);
    }

    if (mode === "clipboard") {
      const links = files
        .map((f) => {
          let link = this.app.fileManager.generateMarkdownLink(f, "");
          if (getCategory(f) !== "document" && !link.startsWith("!")) link = `!${link}`;
          return link;
        })
        .join("\n");
      await navigator.clipboard.writeText(links);
      new Notice(`Copied ${files.length} link(s) to clipboard.`);
    } else {
      new Notice(`Inserted ${files.length} asset(s).`);
    }
    this.close();
  }

  handleMoveSelected() {
    const files = this.getSelectedFiles();
    if (!files.length) return new Notice("Select files to move.");

    new SelectFolderModal(this.app, this.service.getAllFolders(), async (targetFolder) => {
      try {
        const moved = await this.service.moveFiles(files, targetFolder);
        this.selected.clear();
        this.updateSelectionState();
        new Notice(`Moved ${moved} file(s).`);
        this.renderViewport(false);
      } catch (err) {
        new Notice(`Move failed: ${err.message}`);
      }
    }).open();
  }

  handleSingleRename() {
    const files = this.getSelectedFiles();
    if (files.length !== 1) return new Notice("Select exactly 1 file to rename.");

    const file = files[0];
    new InputPromptModal(
      this.app,
      "Rename File",
      `Current: ${file.name}`,
      file.basename,
      async (newName) => {
        try {
          const oldPath = file.path;
          const sanitized = newName.replace(/[\\/:*?"<>|]/g, "_").trim();
          if (!sanitized) return;

          const parentPath = file.parent ? file.parent.path : "";
          const newPath = normalizePath(
            parentPath ? `${parentPath}/${sanitized}.${file.extension}` : `${sanitized}.${file.extension}`
          );

          if (newPath !== oldPath) {
            await this.app.fileManager.renameFile(file, newPath);
            this.service.cache.delete(oldPath);
            this.selected.clear();
            this.selected.add(newPath);
            this.updateSelectionState();
            new Notice("File renamed.");
            this.renderViewport(false);
          }
        } catch (err) {
          new Notice(`Rename failed: ${err.message}`);
        }
      }
    ).open();
  }

  handleBatchRename() {
    const files = this.getSelectedFiles();
    if (!files.length) return new Notice("Select files to rename.");

    new InputPromptModal(
      this.app,
      `Batch Rename (${files.length} files)`,
      "Tokens: {folder} = parent folder, {n} = index, {name} = original name",
      "{folder}_{n}",
      async (pattern) => {
        try {
          const renamed = await this.service.batchRename(files, pattern);
          this.selected.clear();
          this.updateSelectionState();
          new Notice(`Renamed ${renamed} file(s).`);
          this.renderViewport(false);
        } catch (err) {
          new Notice(`Batch rename failed: ${err.message}`);
        }
      }
    ).open();
  }

  handleTrashSelected() {
    const files = this.getSelectedFiles();
    if (!files.length) return new Notice("Select files to trash.");

    new ConfirmModal(this.app, {
      title: `Move ${files.length} file(s) to Trash?`,
      message: `Are you sure you want to move ${
        files.length === 1 ? `"${files[0].name}"` : `${files.length} selected files`
      } to your vault trash?`,
      confirmText: "Move to Trash",
      isDanger: true,
      onConfirm: async () => {
        let count = 0;
        for (const file of files) {
          try {
            await this.app.fileManager.trashFile(file);
            this.service.cache.delete(file.path);
            count++;
          } catch (err) {
            console.error(`Failed to trash "${file.path}":`, err);
          }
        }
        this.selected.clear();
        this.updateSelectionState();
        new Notice(`Moved ${count} file(s) to trash.`);
        this.renderViewport(false);
      }
    }).open();
  }

  onClose() {
    if (this.observer) this.observer.disconnect();
    if (this.galleryResizeObserver) {
      this.galleryResizeObserver.disconnect();
      this.galleryResizeObserver = null;
    }
    if (this.rowsChangedListener) {
      window.removeEventListener("nt-gallery-rows-changed", this.rowsChangedListener);
      this.rowsChangedListener = null;
    }
    this.contentEl.empty();
    if (this.picker && !this.resolved && typeof this.picker.onCancel === "function") {
      this.picker.onCancel();
    }
  }
}

// Inline Dropdown Processor: supports ?[listname] and ?[listname|currentValue]
class InlineDropdownProcessor {
  constructor(plugin) {
    this.plugin = plugin;
    this.regex = /\?\[([^\]|]+)(?:\|([^\]]*))?\]/g;
  }

  process(element, context) {
    if (!element.textContent || !element.textContent.includes("?[")) return;

    const sourceFile = this.plugin.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(sourceFile instanceof TFile)) return;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current;
    while ((current = walker.nextNode())) {
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
      let match;

      while ((match = this.regex.exec(text)) !== null) {
        span.append(text.slice(lastIndex, match.index));
        const fullMatch = match[0];
        const listName = match[1].trim();
        const inlineVal = match[2] !== undefined ? match[2].trim() : null;
        const options = this.plugin.settings.dropdownLists[listName];

        if (options && options.length) {
          const select = span.createEl("select", { cls: "dropdown nt-inline-select" });

          const cache = this.plugin.app.metadataCache.getFileCache(sourceFile);
          const fmVal = cache?.frontmatter?.[`dropdown_${listName}`] || "";
          const activeVal = inlineVal !== null ? inlineVal : fmVal;

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
                const targetSyntax = fullMatch;
                const replacement = `?[${listName}|${chosen}]`;
                return data.replace(targetSyntax, replacement);
              });
              new Notice(`${listName} set to "${chosen}"`);
            } else {
              await this.plugin.app.fileManager.processFrontMatter(sourceFile, (fm) => {
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

// Settings Tab with Interactive Dropdown Builder
class NoteToolboxSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Note Toolbox Settings" });

    new Setting(containerEl)
      .setName("Default View Mode")
      .setDesc("Choose whether the media toolbox opens in Grid View or List View by default.")
      .addDropdown((dd) => {
        dd.addOption("grid", "Grid View (Thumbnails)")
          .addOption("list", "List View (Table)")
          .setValue(this.plugin.settings.defaultViewMode || "grid")
          .onChange(async (val) => {
            this.plugin.settings.defaultViewMode = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Gallery Rows")
      .setDesc("Number of thumbnail rows visible in the Media Toolbox gallery view (thumbnails use a symmetric 16:9 center crop). Applies to open windows instantly.")
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
      .setDesc("Number of thumbnail columns in the Media Toolbox grid view. Fewer columns = larger previews.")
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
      .setDesc("Enable translucent glass panels with frosted blur backdrops and subtle luminous borders across all Note Toolbox modals and cards.")
      .addToggle((tog) => {
        tog.setValue(this.plugin.settings.glassmorphism ?? true).onChange(async (val) => {
          this.plugin.settings.glassmorphism = val;
          await this.plugin.saveSettings();
          this.plugin.applyThemePreferences();
        });
      });

    new Setting(containerEl)
      .setName("Custom Command Aliases")
      .setDesc("Comma-separated short keywords for the command palette and slash (/) menu.")
      .addText((text) => {
        text
          .setPlaceholder("e.g. attach, media, pick, gallery")
          .setValue(this.plugin.settings.customAliases || "")
          .onChange(async (val) => {
            this.plugin.settings.customAliases = val;
            await this.plugin.saveSettings();
            this.plugin.registerAliases();
          });
      });

    // Excluded Folders Setting with Interactive Visual Selector
    new Setting(containerEl)
      .setName("Excluded Folders")
      .setDesc("Folders completely ignored by Note Toolbox. Browse & pick graphically, or edit manually.")
      .addButton((btn) => {
        btn.setButtonText("Select Folders...")
          .setCta()
          .setIcon("folder-plus")
          .onClick(() => {
            new FolderSelectorModal(
              this.app,
              this.plugin.settings.excludedFolders || [],
              async (selected) => {
                this.plugin.settings.excludedFolders = selected;
                await this.plugin.saveSettings();
                if (rawFolderInput) rawFolderInput.setValue(selected.join(", "));
                renderFolderChips();
              }
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
          cls: "nt-muted"
        });
        return;
      }

      list.forEach((folderPath, idx) => {
        const chip = chipsContainer.createDiv({ cls: "nt-folder-chip" });
        const icon = chip.createSpan();
        setIcon(icon, "folder");
        chip.createSpan({ text: folderPath });

        const delBtn = chip.createSpan({ cls: "nt-folder-chip-del" });
        setIcon(delBtn, "x");
        setTooltip(delBtn, `Remove exclusion for "${folderPath}"`);
        delBtn.addEventListener("click", async () => {
          this.plugin.settings.excludedFolders.splice(idx, 1);
          await this.plugin.saveSettings();
          if (rawFolderInput) rawFolderInput.setValue(this.plugin.settings.excludedFolders.join(", "));
          renderFolderChips();
        });
      });
    };

    renderFolderChips();

    // Raw manual input synced with chips
    let rawFolderInput = null;
    new Setting(containerEl)
      .setName("Manual Folder Path List")
      .setDesc("Raw comma-separated paths (synced with the visual selector above).")
      .addTextArea((text) => {
        rawFolderInput = text;
        text
          .setPlaceholder("e.g. Hardware Planner/data, templates, .trash")
          .setValue((this.plugin.settings.excludedFolders || []).join(", "))
          .onChange(async (val) => {
            this.plugin.settings.excludedFolders = val
              .split(",")
              .map((f) => f.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
            renderFolderChips();
          });
        text.inputEl.rows = 2;
        text.inputEl.style.width = "100%";
      });

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
                this.plugin.settings.excludedExtensions = selected;
                await this.plugin.saveSettings();
                if (rawExtInput) rawExtInput.setValue(selected.join(", "));
                renderExtChips();
              }
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
          cls: "nt-muted"
        });
        return;
      }

      list.forEach((ext, idx) => {
        const chip = extChipsContainer.createDiv({ cls: "nt-folder-chip" });
        const icon = chip.createSpan();
        setIcon(icon, "file");
        chip.createSpan({ text: `.${ext}` });

        const delBtn = chip.createSpan({ cls: "nt-folder-chip-del" });
        setIcon(delBtn, "x");
        setTooltip(delBtn, `Remove exclusion for ".${ext}"`);
        delBtn.addEventListener("click", async () => {
          this.plugin.settings.excludedExtensions.splice(idx, 1);
          await this.plugin.saveSettings();
          if (rawExtInput) rawExtInput.setValue(this.plugin.settings.excludedExtensions.join(", "));
          renderExtChips();
        });
      });
    };

    renderExtChips();

    // Raw manual extension input synced with chips
    let rawExtInput = null;
    new Setting(containerEl)
      .setName("Manual Extension List")
      .setDesc("Raw comma-separated extensions (synced with the visual selector above).")
      .addTextArea((text) => {
        rawExtInput = text;
        text
          .setPlaceholder("e.g. csv, txt, json, bak")
          .setValue((this.plugin.settings.excludedExtensions || []).join(", "))
          .onChange(async (val) => {
            this.plugin.settings.excludedExtensions = val
              .split(",")
              .map((f) => f.trim().toLowerCase().replace(/^\./, ""))
              .filter(Boolean);
            await this.plugin.saveSettings();
            renderExtChips();
          });
        text.inputEl.rows = 2;
        text.inputEl.style.width = "100%";
      });

    new Setting(containerEl)
      .setName("Default Scanned Folders")
      .setDesc("Comma-separated folder paths to limit scanning to. Leave empty to scan entire vault.")
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

    containerEl.createEl("h3", {
      text: "Interactive Inline Dropdown Manager",
      cls: "nt-settings-subheading"
    });
    containerEl.createEl("p", {
      text: "Manage your ?[listname] dropdowns visually. Use ?[listname] to bind to note properties, or ?[listname|CurrentValue] for multiple independent dropdowns in a note.",
      cls: "nt-muted"
    });

    const ddContainer = containerEl.createDiv({ cls: "nt-settings-dd-wrap" });
    new DropdownManagerUI(this.plugin, ddContainer).render();
  }
}

module.exports = class NoteToolboxPlugin extends Plugin {
  applyThemePreferences() {
    if (typeof document !== "undefined") {
      document.body.toggleClass("nt-glassmorphic", Boolean(this.settings.glassmorphism ?? true));
    }
  }

  async onload() {
    await this.loadSettings();
    this.applyThemePreferences();
    this.service = new MediaService(this.app, this.settings);

    // Primary Command: Media Toolbox
    this.addCommand({
      id: "open-media-toolbox",
      name: "Open Media Toolbox",
      callback: () => {
        new MediaToolboxModal(this.app, this).open();
      }
    });

    // Command: Interactive Dropdown Manager Modal
    this.addCommand({
      id: "open-dropdown-manager",
      name: "Manage Inline Dropdowns",
      callback: () => {
        new DropdownManagerModal(this.app, this).open();
      }
    });

    // Register Short Command Aliases
    this.registerAliases();

    // Ribbon Icon
    this.addRibbonIcon("layout-grid", "Open Media Toolbox", () => {
      new MediaToolboxModal(this.app, this).open();
    });

    // Canvas & Excalidraw Floating Overlay Injections (debounced)
    const debouncedInject = debounce(() => this.injectOverlayButtons(), 150);
    this.registerEvent(this.app.workspace.on("layout-change", debouncedInject));
    this.registerEvent(this.app.workspace.on("active-leaf-change", debouncedInject));
    this.injectOverlayButtons();

    // Invalidate linked paths cache when metadata cache updates
    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.service.clearLinkedCache();
      })
    );

    // Metadata cache cleanup on file delete/rename
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.service.clearLinkedCache();
        if (file instanceof TFile) {
          this.service.cache.delete(file.path);
        } else if (file instanceof TFolder) {
          this.service.purgeFolder(file.path);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.service.clearLinkedCache();
        if (file instanceof TFolder) {
          this.service.purgeFolder(oldPath);
        } else {
          this.service.cache.delete(oldPath);
        }
      })
    );

    // Markdown Inline Dropdowns Post-Processor
    const processor = new InlineDropdownProcessor(this);
    this.registerMarkdownPostProcessor((el, ctx) => processor.process(el, ctx));

    this.addSettingTab(new NoteToolboxSettingTab(this.app, this));
  }

  createAssetPayload(target) {
    const createOne = (file) => {
      if (!(file instanceof TFile)) return null;
      return {
        file,
        path: file.path,
        name: file.name,
        basename: file.basename,
        extension: file.extension,
        category: getCategory(file),
        resourceUrl: this.app.vault.getResourcePath(file),
        markdownLink: this.app.fileManager.generateMarkdownLink(file, ""),
        metadata: this.service.getBaseMetadata(file)
      };
    };

    if (Array.isArray(target)) {
      return target.map(createOne).filter(Boolean);
    }
    return createOne(target);
  }

  openPicker(options = {}) {
    const modal = new MediaToolboxModal(this.app, this, null, {
      category: options.category || "all",
      lockCategory: options.lockCategory ?? Boolean(options.category && options.category !== "all"),
      multiple: Boolean(options.multiple),
      title: options.title || "",
      initialFolder: options.initialFolder || "/ (All Vault)",
      allowedExtensions: options.allowedExtensions || null,
      excludeExtensions: options.excludeExtensions || null,
      excludeFolders: options.excludeFolders || null,
      onSelect: options.onSelect,
      onCancel: options.onCancel
    });
    modal.open();
    return modal;
  }

  openImagePicker(onSelect, options = {}) {
    return this.openPicker({ ...options, category: "image", lockCategory: options.lockCategory ?? true, onSelect });
  }

  openVideoPicker(onSelect, options = {}) {
    return this.openPicker({ ...options, category: "video", lockCategory: options.lockCategory ?? true, onSelect });
  }

  openAudioPicker(onSelect, options = {}) {
    return this.openPicker({ ...options, category: "audio", lockCategory: options.lockCategory ?? true, onSelect });
  }

  openDocumentPicker(onSelect, options = {}) {
    return this.openPicker({ ...options, category: "document", lockCategory: options.lockCategory ?? true, onSelect });
  }

  pickFile(options = {}) {
    return new Promise((resolve) => {
      this.openPicker({
        ...options,
        onSelect: (result, path, payload) => {
          if (options.returnPayload) {
            resolve(payload);
          } else {
            resolve(result);
          }
        },
        onCancel: () => resolve(null)
      });
    });
  }

  pickAsset(options = {}) {
    return this.pickFile({ ...options, returnPayload: true });
  }

  registerAliases() {
    const raw = this.settings.customAliases || "attach, media, pick";
    const aliases = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

    aliases.forEach((alias) => {
      this.addCommand({
        id: `cmd-alias-${alias}`,
        name: alias,
        callback: () => {
          new MediaToolboxModal(this.app, this).open();
        }
      });
    });
  }

  injectOverlayButtons() {
    const leaves = this.app.workspace.getLeavesOfType("canvas").concat(
      this.app.workspace.getLeavesOfType("excalidraw")
    );

    leaves.forEach((leaf) => {
      const container = leaf.view?.containerEl;
      if (!container || container.querySelector(".nt-canvas-overlay-btn")) return;

      const overlayBtn = container.createDiv({ cls: "nt-canvas-overlay-btn" });
      setIcon(overlayBtn, "layout-grid");
      const viewName = leaf.view.getViewType() === "canvas" ? "Canvas" : "Excalidraw";
      setTooltip(overlayBtn, `Insert Asset to ${viewName}`);

      overlayBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        new MediaToolboxModal(this.app, this, leaf).open();
      });
    });
  }

  onunload() {
    if (typeof document !== "undefined") {
      document.body.removeClass("nt-glassmorphic");
    }
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
};