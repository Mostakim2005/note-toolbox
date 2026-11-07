import { App, Modal } from "obsidian";

export interface ConfirmModalOptions {
	title: string;
	message?: string;
	confirmText?: string;
	isDanger?: boolean;
	onConfirm?: () => void | Promise<void>;
}

/** Confirmation dialog used by all destructive actions. */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly options: ConfirmModalOptions,
	) {
		super(app);
		this.modalEl.addClass("nt-prompt-modal");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: this.options.title });
		if (this.options.message) {
			contentEl.createEl("p", { text: this.options.message, cls: "nt-muted" });
		}

		const actions = contentEl.createDiv({ cls: "nt-modal-actions" });
		actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

		const okBtn = actions.createEl("button", {
			text: this.options.confirmText ?? "Confirm",
			cls: this.options.isDanger ? "mod-warning" : "mod-cta",
		});
		okBtn.addEventListener("click", () => {
			this.close();
			if (typeof this.options.onConfirm === "function") void this.options.onConfirm();
		});

		window.setTimeout(() => okBtn.focus(), 40);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Simple text prompt retained for the file multi-select view. */
export class InputModal extends Modal {
	constructor(
		app: App,
		private readonly titleText: string,
		private readonly placeholder: string,
		private readonly initialValue: string,
		private readonly onSubmit: (value: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("note-toolbox-modal");

		contentEl.createEl("h2", { text: this.titleText });

		const input = contentEl.createEl("input", {
			type: "text",
			placeholder: this.placeholder,
			cls: "note-toolbox-modal-input",
		});
		input.value = this.initialValue;

		const buttons = contentEl.createDiv({ cls: "note-toolbox-modal-buttons" });

		const cancelButton = buttons.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => this.close());

		const submitButton = buttons.createEl("button", { text: "OK", cls: "mod-cta" });
		submitButton.addEventListener("click", () => void this.submit(input.value));

		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") void this.submit(input.value);
			if (event.key === "Escape") this.close();
		});

		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(value: string): Promise<void> {
		const trimmed = value.trim();
		if (!trimmed) return;

		this.close();
		await this.onSubmit(trimmed);
	}
}

/** Simple folder picker retained for the file multi-select view. */
export class FolderSelectModal extends Modal {
	private readonly selected: Set<string>;

	constructor(
		app: App,
		private readonly folders: string[],
		selectedFolders: string[],
		private readonly onSave: (folders: string[]) => void,
	) {
		super(app);
		this.selected = new Set(selectedFolders);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("note-toolbox-modal");

		contentEl.createEl("h2", { text: "Select folders" });

		const list = contentEl.createDiv({ cls: "note-toolbox-folder-list" });

		for (const folder of this.folders) {
			const label = list.createEl("label", { cls: "note-toolbox-folder-option" });
			const checkbox = label.createEl("input", { type: "checkbox" });
			checkbox.checked = this.selected.has(folder);
			label.createSpan({ text: folder || "/ (root)" });

			checkbox.addEventListener("change", () => {
				if (checkbox.checked) this.selected.add(folder);
				else this.selected.delete(folder);
			});
		}

		const buttons = contentEl.createDiv({ cls: "note-toolbox-modal-buttons" });
		buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		buttons
			.createEl("button", { text: "Apply", cls: "mod-cta" })
			.addEventListener("click", () => {
				this.close();
				this.onSave([...this.selected]);
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Text prompt used by rename, batch rename, and merge flows. */
export class InputPromptModal extends Modal {
	constructor(
		app: App,
		private readonly titleText: string,
		private readonly desc: string,
		private readonly defaultValue: string,
		private readonly onConfirm: (value: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("nt-prompt-modal");

		contentEl.createEl("h3", { text: this.titleText });
		if (this.desc) contentEl.createEl("p", { text: this.desc, cls: "nt-muted" });

		const input = contentEl.createEl("input", {
			type: "text",
			cls: "nt-input nt-prompt-input",
		});
		input.value = this.defaultValue;

		const actions = contentEl.createDiv({ cls: "nt-modal-actions" });
		actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const ok = actions.createEl("button", { text: "Confirm", cls: "mod-cta" });

		const handleConfirm = () => {
			const val = input.value.trim();
			if (val) {
				this.close();
				void this.onConfirm(val);
			}
		};

		ok.addEventListener("click", handleConfirm);
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") handleConfirm();
		});
		window.setTimeout(() => input.focus(), 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Destination folder chooser for batch moves. */
export class SelectFolderModal extends Modal {
	constructor(
		app: App,
		private readonly folders: string[],
		private readonly onSelect: (folder: string) => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("nt-prompt-modal");
		contentEl.createEl("h3", { text: "Move Selected to Folder" });

		const select = contentEl.createEl("select", {
			cls: "nt-select nt-folder-picker nt-prompt-select",
		});

		this.folders.forEach((folder) => {
			const opt = select.createEl("option", { text: folder, value: folder });
			if (folder === "/ (All Vault)") opt.value = "";
		});

		const actions = contentEl.createDiv({ cls: "nt-modal-actions" });
		actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const ok = actions.createEl("button", { text: "Move", cls: "mod-cta" });
		ok.addEventListener("click", () => {
			this.close();
			void this.onSelect(select.value);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
