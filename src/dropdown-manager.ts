import { Notice, setIcon, setTooltip } from "obsidian";
import type NoteToolboxPlugin from "./main";
import { ConfirmModal } from "./modals";

/**
 * Interactive builder for `?[listname]` dropdown definitions.
 * Port of DropdownManagerUI (Nihon main.js L470+).
 */
export class DropdownManagerUI {
	private activeList: string | null;
	private readonly selectedOptions = new Set<number>();
	private lastClickedOptionIdx: number | null = null;

	constructor(
		private readonly plugin: NoteToolboxPlugin,
		private readonly containerEl: HTMLElement,
		private readonly onUpdate: (() => void) | null = null,
	) {
		const keys = Object.keys(this.plugin.settings.dropdownLists || {});
		this.activeList = keys.length > 0 ? (keys[0] ?? null) : null;
	}

	async saveAndRefresh(rerender = true): Promise<void> {
		await this.plugin.saveSettings();
		if (this.onUpdate) this.onUpdate();
		if (rerender) this.render();
	}

	render(): void {
		this.containerEl.empty();
		const wrap = this.containerEl.createDiv({ cls: "nt-dd-manager" });

		const listsObj = this.plugin.settings.dropdownLists || {};
		const listNames = Object.keys(listsObj);

		if (this.activeList && !listsObj[this.activeList]) {
			this.activeList = listNames[0] ?? null;
			this.selectedOptions.clear();
		} else if (!this.activeList && listNames.length > 0) {
			this.activeList = listNames[0] ?? null;
		}

		const listBar = wrap.createDiv({ cls: "nt-dd-list-bar" });
		const chipWrap = listBar.createDiv({ cls: "nt-chip-group" });

		listNames.forEach((name) => {
			const isActive = name === this.activeList;
			const chip = chipWrap.createEl("button", {
				cls: `nt-chip ${isActive ? "is-active" : ""}`,
			});
			const iconSpan = chip.createSpan({ cls: "nt-chip-icon" });
			setIcon(iconSpan, "list-filter");
			chip.createSpan({ text: name });
			chip.createSpan({
				cls: "nt-dd-chip-count",
				text: `${(listsObj[name] ?? []).length}`,
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
			cls: "nt-dd-input",
		});
		const addListBtn = addListForm.createEl("button", { cls: "nt-btn-mint nt-btn-sm" });
		setIcon(addListBtn.createSpan({ cls: "nt-btn-icon" }), "plus");
		addListBtn.createSpan({ text: "New Dropdown" });

		const handleCreateList = async (): Promise<void> => {
			const raw = newListInput.value
				.trim()
				.replace(/\s+/g, "_")
				.replace(/[^\w-]/g, "");
			if (!raw) {
				new Notice("Enter a valid list name.");
				return;
			}
			if (listsObj[raw]) {
				new Notice(`Dropdown "${raw}" already exists.`);
				return;
			}

			this.plugin.settings.dropdownLists[raw] = [];
			this.activeList = raw;
			this.selectedOptions.clear();
			await this.saveAndRefresh(true);
			new Notice(`Created dropdown ?[${raw}]`);
		};

		addListBtn.addEventListener("click", () => void handleCreateList());
		newListInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void handleCreateList();
			}
		});

		if (!this.activeList) {
			const empty = wrap.createDiv({ cls: "nt-dd-empty" });
			empty.setText("No dropdown lists configured. Create one above to get started.");
			return;
		}

		const activeList = this.activeList;
		const options = listsObj[activeList] ?? [];

		const activeHeader = wrap.createDiv({ cls: "nt-dd-active-header" });
		const leftMeta = activeHeader.createDiv({ cls: "nt-dd-active-meta" });

		const nameInput = leftMeta.createEl("input", {
			type: "text",
			cls: "nt-dd-title-input",
		});
		nameInput.value = activeList;
		setTooltip(nameInput, "Click to rename this dropdown list");

		const commitListRename = async (): Promise<void> => {
			const nextName = nameInput.value
				.trim()
				.replace(/\s+/g, "_")
				.replace(/[^\w-]/g, "");
			if (!nextName || nextName === activeList) {
				nameInput.value = activeList;
				return;
			}
			if (listsObj[nextName]) {
				new Notice(`Dropdown "${nextName}" already exists.`);
				nameInput.value = activeList;
				return;
			}

			const updated: Record<string, string[]> = {};
			for (const key of Object.keys(listsObj)) {
				if (key === activeList) updated[nextName] = listsObj[key] ?? [];
				else updated[key] = listsObj[key] ?? [];
			}
			this.plugin.settings.dropdownLists = updated;
			this.activeList = nextName;
			await this.saveAndRefresh(true);
			new Notice(`Renamed dropdown to ?[${nextName}]`);
		};

		nameInput.addEventListener("blur", () => void commitListRename());
		nameInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				nameInput.blur();
			}
		});

		const tokenBadge = leftMeta.createEl("button", {
			cls: "nt-dd-token-badge",
			text: `?[${activeList}]`,
		});
		setTooltip(tokenBadge, "Click to copy token for your note");
		tokenBadge.addEventListener("click", () => {
			void navigator.clipboard.writeText(`?[${activeList}]`);
			new Notice(`Copied ?[${activeList}] to clipboard.`);
		});

		const rightHeaderOps = activeHeader.createDiv({ cls: "nt-btn-group" });
		const deleteListBtn = rightHeaderOps.createEl("button", { cls: "nt-btn-sm mod-warning" });
		setIcon(deleteListBtn.createSpan({ cls: "nt-btn-icon" }), "trash-2");
		deleteListBtn.createSpan({ text: "Delete List" });

		deleteListBtn.addEventListener("click", () => {
			const deletedName = activeList;
			new ConfirmModal(this.plugin.app, {
				title: `Delete Dropdown "${deletedName}"?`,
				message: `Are you sure you want to delete ?[${deletedName}] and all its options? Existing notes using this tag will not be changed.`,
				confirmText: "Delete Dropdown",
				isDanger: true,
				onConfirm: async () => {
					delete this.plugin.settings.dropdownLists[deletedName];
					this.activeList = Object.keys(this.plugin.settings.dropdownLists)[0] ?? null;
					this.selectedOptions.clear();
					await this.saveAndRefresh(true);
					new Notice(`Deleted dropdown "${deletedName}".`);
				},
			}).open();
		});

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
		});
		delSelectedBtn.disabled = this.selectedOptions.size === 0;
		setIcon(delSelectedBtn.createSpan({ cls: "nt-btn-icon" }), "trash");
		delSelectedBtn.createSpan({ text: `Delete Selected (${this.selectedOptions.size})` });

		delSelectedBtn.addEventListener("click", () => {
			if (this.selectedOptions.size === 0) return;
			const count = this.selectedOptions.size;
			new ConfirmModal(this.plugin.app, {
				title: `Delete ${count} Option(s)?`,
				message: `Are you sure you want to remove the ${count} selected options from "${activeList}"?`,
				confirmText: "Delete",
				isDanger: true,
				onConfirm: async () => {
					this.plugin.settings.dropdownLists[activeList] = options.filter(
						(_, idx) => !this.selectedOptions.has(idx),
					);
					this.selectedOptions.clear();
					await this.saveAndRefresh(true);
					new Notice(`Deleted ${count} option(s).`);
				},
			}).open();
		});

		const addOptGroup = toolbar.createDiv({ cls: "nt-dd-inline-add" });
		const addOptInput = addOptGroup.createEl("input", {
			type: "text",
			placeholder: "Add option (or comma-separated options)...",
			cls: "nt-dd-input",
		});
		const addOptBtn = addOptGroup.createEl("button", { cls: "nt-btn-mint nt-btn-sm" });
		setIcon(addOptBtn.createSpan({ cls: "nt-btn-icon" }), "plus");
		addOptBtn.createSpan({ text: "Add Option" });

		const handleAddOption = async (): Promise<void> => {
			const raw = addOptInput.value.trim();
			if (!raw) return;
			const newItems = raw
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);

			const currentList = this.plugin.settings.dropdownLists[activeList] ?? [];
			let addedCount = 0;
			newItems.forEach((item) => {
				if (!currentList.includes(item)) {
					currentList.push(item);
					addedCount++;
				}
			});

			if (addedCount > 0) {
				this.plugin.settings.dropdownLists[activeList] = currentList;
				await this.saveAndRefresh(true);
			} else {
				new Notice("Option already exists in this list.");
			}
		};

		addOptBtn.addEventListener("click", () => void handleAddOption());
		addOptInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void handleAddOption();
			}
		});

		const optionsListEl = wrap.createDiv({ cls: "nt-dd-options-list" });
		if (options.length === 0) {
			optionsListEl.createDiv({
				cls: "nt-dd-empty",
				text: "No options in this dropdown yet. Add options above.",
			});
			return;
		}

		options.forEach((optValue, idx) => {
			const isSelected = this.selectedOptions.has(idx);
			const row = optionsListEl.createDiv({
				cls: `nt-dd-option-row ${isSelected ? "is-selected" : ""}`,
			});

			const checkBtn = row.createDiv({ cls: "nt-dd-checkbox" });
			if (isSelected) setIcon(checkBtn, "check");
			checkBtn.addEventListener("click", (event) => {
				if (event.shiftKey && this.lastClickedOptionIdx !== null) {
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
				cls: "nt-dd-opt-input",
			});
			optInput.value = optValue;

			const commitOptEdit = async (): Promise<void> => {
				const nextVal = optInput.value.trim();
				if (!nextVal) {
					optInput.value = optValue;
					return;
				}
				if (nextVal !== optValue) {
					const list = this.plugin.settings.dropdownLists[activeList];
					if (list) list[idx] = nextVal;
					await this.saveAndRefresh(false);
				}
			};

			optInput.addEventListener("blur", () => void commitOptEdit());
			optInput.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					optInput.blur();
				}
			});

			const rowOps = row.createDiv({ cls: "nt-dd-row-ops" });

			const upBtn = rowOps.createEl("button", { cls: "nt-icon-btn" });
			upBtn.disabled = idx === 0;
			setIcon(upBtn, "chevron-up");
			setTooltip(upBtn, "Move up");
			upBtn.addEventListener("click", () => {
				if (idx === 0) return;
				const arr = this.plugin.settings.dropdownLists[activeList];
				if (!arr) return;
				const prev = arr[idx - 1];
				const current = arr[idx];
				if (prev === undefined || current === undefined) return;
				arr[idx - 1] = current;
				arr[idx] = prev;
				this.selectedOptions.clear();
				void this.saveAndRefresh(true);
			});

			const downBtn = rowOps.createEl("button", { cls: "nt-icon-btn" });
			downBtn.disabled = idx === options.length - 1;
			setIcon(downBtn, "chevron-down");
			setTooltip(downBtn, "Move down");
			downBtn.addEventListener("click", () => {
				const arr = this.plugin.settings.dropdownLists[activeList];
				if (!arr || idx >= arr.length - 1) return;
				const next = arr[idx + 1];
				const current = arr[idx];
				if (next === undefined || current === undefined) return;
				arr[idx + 1] = current;
				arr[idx] = next;
				this.selectedOptions.clear();
				void this.saveAndRefresh(true);
			});

			const delBtn = rowOps.createEl("button", { cls: "nt-icon-btn nt-dd-del-btn" });
			setIcon(delBtn, "x");
			setTooltip(delBtn, "Remove option");
			delBtn.addEventListener("click", () => {
				const list = this.plugin.settings.dropdownLists[activeList];
				if (list) list.splice(idx, 1);
				this.selectedOptions.clear();
				void this.saveAndRefresh(true);
			});
		});
	}
}
