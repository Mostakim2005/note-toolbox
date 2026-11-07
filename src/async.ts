/**
 * Wraps an async callback so it can be used where a void-returning listener is
 * expected without floating the promise.
 */
export function voidAsync<Args extends unknown[]>(
	fn: (...args: Args) => Promise<void>,
): (...args: Args) => void {
	return (...args: Args) => {
		void fn(...args);
	};
}
