import { App, Modal, setIcon, setTooltip, type TFile } from "obsidian";
import type { MediaMetadata } from "./types";

/** Full-size lightbox preview for a single asset. */
export class QuickLookModal extends Modal {
	constructor(
		app: App,
		private readonly file: TFile,
		private readonly meta: MediaMetadata,
		private readonly onAttach: ((file: TFile) => void) | null,
		private readonly actionLabel = "Insert / Attach",
	) {
		super(app);
		this.modalEl.addClass("nt-quicklook-modal");
	}

	onOpen(): void {
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
				attr: { src: resourceUrl, alt: this.file.name },
			});
		} else if (this.meta.type === "video") {
			previewArea.createEl("video", {
				attr: { controls: "", autoplay: "", src: resourceUrl },
				cls: "nt-ql-video",
			});
		} else if (this.meta.type === "audio") {
			const playerBox = previewArea.createDiv({ cls: "nt-ql-audio-box" });
			const audioIcon = playerBox.createDiv({ cls: "nt-ql-audio-icon" });
			setIcon(audioIcon, "music");
			playerBox.createEl("audio", {
				attr: { controls: "", autoplay: "", src: resourceUrl },
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

	onClose(): void {
		this.contentEl.empty();
	}
}
