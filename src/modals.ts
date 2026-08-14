import { App, Modal } from "obsidian";

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

export class FolderSelectModal extends Modal {
    constructor(
        app: App,
        private readonly folders: string[],
        selectedFolders: string[],
        private readonly onSave: (folders: string[]) => void,
    ) {
        super(app);
        this.selected = new Set(selectedFolders);
    }

    private readonly selected: Set<string>;

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
        buttons.createEl("button", { text: "Apply", cls: "mod-cta" }).addEventListener("click", () => {
            this.close();
            this.onSave([...this.selected]);
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class ConfirmModal extends Modal {
    constructor(
        app: App,
        private readonly titleText: string,
        private readonly message: string,
        private readonly confirmText: string,
        private readonly onConfirm: () => void | Promise<void>,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("note-toolbox-modal");

        contentEl.createEl("h2", { text: this.titleText });
        contentEl.createEl("p", { text: this.message });

        const buttons = contentEl.createDiv({ cls: "note-toolbox-modal-buttons" });
        buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
        buttons.createEl("button", { text: this.confirmText, cls: "mod-warning" }).addEventListener("click", () => {
            this.close();
            void this.onConfirm();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
