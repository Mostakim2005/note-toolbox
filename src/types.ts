import type { TFile } from "obsidian";

export interface NoteToolboxSettings {
	dropdownLists: Record<string, string[]>;
	scannedFolders: string[];
	excludedFolders: string[];
	excludedExtensions: string[];
	customAliases: string;
	defaultViewMode: "grid" | "list";
	galleryRows: number;
	galleryColumns: number;
	glassmorphism: boolean;
}

export type FileCategory = "image" | "video" | "audio" | "document";
export type CategoryFilter = FileCategory | "all";
export type UsageFilter = "all" | "orphan" | "linked";
export type ViewMode = "grid" | "list";
export type SortMode =
	| "mtime-desc"
	| "mtime-asc"
	| "name-asc"
	| "name-desc"
	| "size-desc"
	| "size-asc"
	| "ext-asc"
	| "ext-desc";

export interface MediaMetadata {
	size: string;
	rawSize: number;
	ext: string;
	mtime: number;
	type: FileCategory | null;
	detail: string;
}

export interface AssetPayload {
	file: TFile;
	path: string;
	name: string;
	basename: string;
	extension: string;
	size: number;
	formattedSize: string;
	category: FileCategory | null;
	resourceUrl: string;
	markdownLink: string;
	metadata: MediaMetadata;
}

export type PickerSelectHandler = (
	chosen: TFile | TFile[],
	path: string | string[],
	payload: AssetPayload | AssetPayload[],
) => void;

export interface ChooserOptions {
	category?: CategoryFilter;
	lockCategory?: boolean;
	multiple?: boolean;
	title?: string;
	initialFolder?: string;
	allowedExtensions?: string[];
	excludeExtensions?: string[];
	excludeFolders?: string[];
	onSelect?: PickerSelectHandler;
	onCancel?: () => void;
	/** Internal: makes pickFile resolve the rich payload instead of the TFile. */
	returnPayload?: boolean;
}

/** Normalized picker configuration used inside MediaToolboxModal. */
export interface PickerConfig {
	category: CategoryFilter;
	lockCategory: boolean;
	multiple: boolean;
	title: string;
	initialFolder: string;
	allowedExtensions: string[] | null;
	excludeExtensions: string[] | null;
	excludeFolders: string[] | null;
	onSelect: PickerSelectHandler;
	onCancel?: () => void;
}
