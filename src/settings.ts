import type { NoteToolboxSettings } from "./types";
export const DEFAULT_SETTINGS: NoteToolboxSettings = {
	dropdownLists: { status: ["To Do", "In Progress", "Completed"], priority: ["Low", "Medium", "High"], urgency: ["Urgent", "Not Urgent"] },
	scannedFolders: [],
	excludedFolders: [],
	excludedExtensions: [],
	customAliases: "attach, media, pick, gallery",
	defaultViewMode: "grid",
	galleryRows: 4,
	galleryColumns: 5,
	glassmorphism: true,
};
