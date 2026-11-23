import { TFile, type App } from "obsidian";
import { EXTENSIONS } from "./fuzzy";

export interface NotePreviewData {
	mtime: number;
	title: string;
	excerpt: string;
	images: string[];
	tags: string[];
	taskDone: number;
	taskTotal: number;
}

const IMAGE_EXT_SET = EXTENSIONS.images;
const FRONTMATTER_IMAGE_KEYS = ["cover", "image", "banner", "thumbnail", "featured", "feature_image"];

function isImagePath(path: string): boolean {
	const clean = path.split("?")[0]?.split("#")[0] ?? "";
	const dot = clean.lastIndexOf(".");
	if (dot === -1) return false;
	return IMAGE_EXT_SET.has(clean.slice(dot + 1).toLowerCase());
}

function stripMarkdownToExcerpt(raw: string, maxChars = 320): string {
	let text = raw;
	// Strip leading YAML frontmatter
	if (text.startsWith("---")) {
		const end = text.indexOf("\n---", 3);
		if (end !== -1) {
			text = text.slice(end + 4);
		}
	}
	// Remove fenced code blocks and comments
	text = text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/~~~[\s\S]*?~~~/g, " ")
		.replace(/%%[\s\S]*?%%/g, " ")
		.replace(/<!--[\s\S]*?-->/g, " ");

	const lines = text.split(/\r?\n/);
	const cleaned: string[] = [];
	let totalLen = 0;

	for (const rawLine of lines) {
		const line = rawLine
			.trim()
			.replace(/^#{1,6}\s+/, "")
			.replace(/^>\s*(\[![^\]]+\][+-]?\s*)?/, "")
			.replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
			.replace(/^[-*+]\s+/, "")
			.replace(/^\d+\.\s+/, "")
			.replace(/!\[\[[^\]]+\]\]/g, "")
			.replace(/!\[[^\]]*\]\([^)]+\)/g, "")
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
			.replace(/\[\[([^\]]+)\]\]/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/<[^>]+>/g, " ")
			.replace(/[*_~`]+/g, "")
			.replace(/\s+/g, " ")
			.trim();

		if (!line || line === "---" || line === "***" || line === "___") continue;
		cleaned.push(line);
		totalLen += line.length + 1;
		if (totalLen >= maxChars) break;
	}

	const joined = cleaned.join(" ").trim();
	if (joined.length <= maxChars) return joined;
	return `${joined.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Lightweight lazy preview & multi-image cache for Markdown notes.
 * Performs zero work at Obsidian startup; populates only on demand for visible notes
 * and invalidates entries whenever a note's mtime changes.
 */
export class NotePreviewCache {
	private cache = new Map<string, NotePreviewData>();
	private inFlight = new Map<string, Promise<NotePreviewData>>();

	constructor(private readonly app: App) {}

	getCached(file: TFile): NotePreviewData | null {
		const entry = this.cache.get(file.path);
		if (entry && entry.mtime === file.stat.mtime) {
			return entry;
		}
		return null;
	}

	invalidate(path: string): void {
		this.cache.delete(path);
		this.inFlight.delete(path);
	}

	clear(): void {
		this.cache.clear();
		this.inFlight.clear();
	}

	/** Synchronous metadata-only snapshot (tags, title, frontmatter/embed images, tasks) with zero disk read. */
	getQuickMetadata(file: TFile): NotePreviewData {
		const existing = this.getCached(file);
		if (existing) return existing;

		const meta = this.app.metadataCache.getFileCache(file);
		const fm = meta?.frontmatter;

		// Title: frontmatter title fallback to basename
		const fmTitle: unknown = fm ? Reflect.get(fm, "title") : undefined;
		const title =
			typeof fmTitle === "string" && fmTitle.trim() ? fmTitle.trim() : file.basename;

		// Tags from inline + frontmatter
		const tagSet = new Set<string>();
		for (const t of meta?.tags ?? []) {
			tagSet.add(t.tag.replace(/^#/, ""));
		}
		const fmTags: unknown = fm ? Reflect.get(fm, "tags") : undefined;
		if (Array.isArray(fmTags)) {
			for (const t of fmTags) {
				if (typeof t === "string" && t.trim()) tagSet.add(t.trim().replace(/^#/, ""));
			}
		} else if (typeof fmTags === "string" && fmTags.trim()) {
			for (const part of fmTags.split(/[,\s]+/)) {
				if (part.trim()) tagSet.add(part.trim().replace(/^#/, ""));
			}
		}

		// Task counts from metadataCache listItems
		let taskDone = 0;
		let taskTotal = 0;
		for (const item of meta?.listItems ?? []) {
			if (typeof item.task === "string") {
				taskTotal += 1;
				if (item.task !== " ") taskDone += 1;
			}
		}

		// Collect up to 3 image URLs (frontmatter cover first, then embedded vault images)
		const images: string[] = [];
		const seenImg = new Set<string>();
		const pushImageUrl = (url: string) => {
			if (!url || seenImg.has(url) || images.length >= 3) return;
			seenImg.add(url);
			images.push(url);
		};

		if (fm) {
			for (const key of FRONTMATTER_IMAGE_KEYS) {
				const rawVal: unknown = Reflect.get(fm, key);
				if (typeof rawVal !== "string" || !rawVal.trim()) continue;
				const trimmed = rawVal.trim().replace(/^!\[\[|^\[\[|\]\]$/g, "").split("|")[0]?.trim() ?? "";
				if (!trimmed) continue;
				if (/^https?:\/\//i.test(trimmed)) {
					pushImageUrl(trimmed);
				} else {
					const dest = this.app.metadataCache.getFirstLinkpathDest(trimmed, file.path);
					if (dest instanceof TFile && isImagePath(dest.path)) {
						pushImageUrl(this.app.vault.getResourcePath(dest));
					}
				}
			}
		}

		for (const emb of meta?.embeds ?? []) {
			if (images.length >= 3) break;
			const link = emb.link.split("|")[0]?.split("#")[0]?.trim() ?? "";
			if (!link) continue;
			const dest = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
			if (dest instanceof TFile && isImagePath(dest.path)) {
				pushImageUrl(this.app.vault.getResourcePath(dest));
			}
		}

		return {
			mtime: file.stat.mtime,
			title,
			excerpt: "",
			images,
			tags: Array.from(tagSet).sort(),
			taskDone,
			taskTotal,
		};
	}

	/** Lazily loads full cleaned excerpt + fallback Markdown external images for one note. */
	async getPreview(file: TFile): Promise<NotePreviewData> {
		const cached = this.getCached(file);
		if (cached) return cached;

		const pending = this.inFlight.get(file.path);
		if (pending) return pending;

		const job = (async (): Promise<NotePreviewData> => {
			const base = this.getQuickMetadata(file);
			try {
				const raw = await this.app.vault.cachedRead(file);
				const excerpt = stripMarkdownToExcerpt(raw);

				// Fallback: detect Markdown external image links ![alt](https://...) if fewer than 3 images found
				const images = [...base.images];
				if (images.length < 3) {
					const seen = new Set(images);
					const imgRegex = /!\[[^\]]*\]\(([^)\s]+)\)/g;
					let match: RegExpExecArray | null;
					while ((match = imgRegex.exec(raw)) !== null && images.length < 3) {
						const rawTarget = match[1]?.trim() ?? "";
						if (!rawTarget) continue;
						if (/^https?:\/\//i.test(rawTarget)) {
							if (!seen.has(rawTarget)) {
								seen.add(rawTarget);
								images.push(rawTarget);
							}
						} else {
							const decoded = decodeURIComponent(rawTarget);
							const dest = this.app.metadataCache.getFirstLinkpathDest(decoded, file.path);
							if (dest instanceof TFile && isImagePath(dest.path)) {
								const url = this.app.vault.getResourcePath(dest);
								if (!seen.has(url)) {
									seen.add(url);
									images.push(url);
								}
							}
						}
					}
				}

				const full: NotePreviewData = {
					...base,
					mtime: file.stat.mtime,
					excerpt,
					images,
				};
				this.cache.set(file.path, full);
				return full;
			} catch {
				this.cache.set(file.path, base);
				return base;
			} finally {
				this.inFlight.delete(file.path);
			}
		})();

		this.inFlight.set(file.path, job);
		return job;
	}
}
