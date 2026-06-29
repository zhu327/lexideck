import { authFetch } from "./api";
import {
	countPendingOps,
	deleteOp,
	getAllOps,
	getPendingOps,
	markOpFailed,
	resetOpToPending,
	setOpSyncing,
} from "./offline-review";

export interface SyncResult {
	synced: number;
	failed: number;
	remaining: number;
	stoppedReason?: "network" | "auth" | "server-error";
}

export interface SyncStatus {
	pendingCount: number;
	lastError?: string;
}

let syncMutex: Promise<void> | null = null;

export async function syncReviewOps(): Promise<SyncResult> {
	const prev = syncMutex;
	let release!: () => void;
	syncMutex = new Promise<void>((r) => {
		release = r;
	});
	if (prev) await prev;
	try {
		const ops = await getPendingOps();
		let synced = 0;
		let failed = 0;
		let stoppedReason: "network" | "auth" | "server-error" | undefined;

		for (const op of ops) {
			await setOpSyncing(op.clientOperationId);
			try {
				const res = await authFetch("/api/review/submit", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ cardId: op.cardId, rating: op.rating }),
				});

				if (res.ok) {
					await deleteOp(op.clientOperationId);
					synced++;
				} else if (res.status === 401 || res.status === 403) {
					stoppedReason = "auth";
					break;
				} else if (res.status === 400) {
					await markOpFailed(op.clientOperationId, "Invalid request");
					failed++;
				} else if (res.status === 404 || res.status === 409) {
					await markOpFailed(op.clientOperationId, "server-priority");
					failed++;
				} else if (res.status >= 500 && res.status < 600) {
					// Server error — keep op for retry, stop this round
					await resetOpToPending(op.clientOperationId);
					stoppedReason = "server-error";
					break;
				}
			} catch (e) {
				if (e instanceof TypeError) {
					stoppedReason = "network";
					break;
				}
				throw e;
			}
		}

		const remaining = await countPendingOps();
		return { synced, failed, remaining, stoppedReason };
	} finally {
		syncMutex = null;
		release();
	}
}

export async function getSyncStatus(): Promise<SyncStatus> {
	const pendingCount = await countPendingOps();
	const allOps = await getAllOps();
	const lastError = allOps.reduce<string | undefined>((latest, op) => {
		if (op.syncStatus !== "failed" || !op.lastError) return latest;
		if (!latest) return op.lastError;
		return op.lastError; // last iterated wins; ops are createdAt-ascending from getAllOps
	}, undefined);
	return { pendingCount, lastError };
}
