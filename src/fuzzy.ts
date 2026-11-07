// Note Toolbox — helpers ported from Nihon 1.1.0 (L41-83)
export const EXTENSIONS = {
	images: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]),
	video: new Set(["mp4", "webm", "ogv", "mov", "mkv", "avi", "m4v", "3gp"]),
	audio: new Set(["mp3", "wav", "m4a", "ogg", "flac", "aac", "opus"]),
	docs: new Set(["pdf", "epub", "html", "htm", "txt", "rtf", "doc", "docx", "csv"]),
};

export const sharedNameCollator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});
export const sharedExtCollator = new Intl.Collator(undefined, { sensitivity: "base" });

export function getExtensions() {
	return EXTENSIONS;
}

export function debounce<Args extends unknown[]>(
	fn: (...args: Args) => void,
	delay = 160,
): (...args: Args) => void {
	let timer: number | null = null;
	return (...args: Args) => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			fn(...args);
			timer = null;
		}, delay);
	};
}

export function formatBytes(bytes: number): string {
	if (!bytes || bytes <= 0 || isNaN(bytes)) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i] ?? "B"}`;
}

export function formatDuration(seconds: number): string {
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

export function getCategory(file: { extension: string } | null): "image" | "video" | "audio" | "document" | null {
	if (!file || !file.extension) return null;
	const ext = file.extension.toLowerCase();
	if (EXTENSIONS.images.has(ext)) return "image";
	if (EXTENSIONS.video.has(ext)) return "video";
	if (EXTENSIONS.audio.has(ext)) return "audio";
	if (EXTENSIONS.docs.has(ext)) return "document";
	return null;
}
