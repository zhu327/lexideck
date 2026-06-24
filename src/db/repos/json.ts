/**
 * Parse a JSON column value defensively. Returns `fallback` when `raw` is
 * unparseable or does not structurally match `fallback` (array vs plain object
 * vs other). Use for D1 TEXT columns that store JSON so a corrupt row degrades
 * to the fallback instead of throwing.
 */
export function parseJsonColumn<T>(raw: unknown, fallback: T): T {
	try {
		const v = JSON.parse(String(raw));
		if (Array.isArray(fallback)) {
			return Array.isArray(v) ? (v as T) : fallback;
		}
		if (isPlainObject(fallback)) {
			return isPlainObject(v) ? (v as T) : fallback;
		}
		return v as T;
	} catch {
		return fallback;
	}
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}
