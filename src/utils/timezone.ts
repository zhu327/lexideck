/**
 * Compute the start of "today" in the user's local timezone.
 * `tzOffsetHours` is the offset from UTC (e.g. 8 for UTC+8 / Asia/Shanghai).
 */
export function todayStartMs(nowMs: number, tzOffsetHours: number): number {
	const localMs = nowMs + tzOffsetHours * 3_600_000;
	return localMs - (localMs % 86_400_000) - tzOffsetHours * 3_600_000;
}

export function parseTzOffset(raw: string | undefined): number {
	const n = Number(raw);
	return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), -12), 14) : 8;
}
