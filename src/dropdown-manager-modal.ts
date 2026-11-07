import { Modal, setIcon, setTooltip } from "obsidian";
import type NoteToolboxPlugin from "./main";
import { DropdownManagerUI } from "./dropdown-manager";

/** Standalone modal hosting the inline dropdown manager. */
export class DropdownManagerModal extends Modal {
	constructor(
		app: import("obsidian").App,
		private readonly plugin: NoteToolboxPlugin,
	) {
		super(app);
		this.modalEl.addClass("nt-dropdown-modal");
	}

	onOpen(): void {
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
			text: "Create and manage ?[listname] inline dropdowns and their options interactively.",
		});

		const body = contentEl.createDiv({ cls: "nt-dd-modal-body" });
		new DropdownManagerUI(this.plugin, body).render();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
