// Note Toolbox — faithful types from live Nihon 1.1.0 bundle
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
