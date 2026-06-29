import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedReviewOp } from "../pwa/src/offline-review";

vi.mock("../pwa/src/api", () => ({
	authFetch: vi.fn(),
}));

vi.mock("../pwa/src/offline-review", () => ({
	getPendingOps: vi.fn(),
	getAllOps: vi.fn(),
	setOpSyncing: vi.fn(),
	deleteOp: vi.fn(),
	markOpFailed: vi.fn(),
	resetOpToPending: vi.fn(),
	countPendingOps: vi.fn(),
}));

import { authFetch } from "../pwa/src/api";
import {
	countPendingOps,
	deleteOp,
	getAllOps,
	getPendingOps,
	markOpFailed,
	resetOpToPending,
	setOpSyncing,
} from "../pwa/src/offline-review";
import { getSyncStatus, syncReviewOps } from "../pwa/src/review-sync";

const mockAuthFetch = authFetch as Mock<typeof authFetch>;
const mockGetPendingOps = getPendingOps as Mock<typeof getPendingOps>;
const mockGetAllOps = getAllOps as Mock<typeof getAllOps>;
const mockSetOpSyncing = setOpSyncing as Mock<typeof setOpSyncing>;
const mockDeleteOp = deleteOp as Mock<typeof deleteOp>;
const mockMarkOpFailed = markOpFailed as Mock<typeof markOpFailed>;
const mockResetOpToPending = resetOpToPending as Mock<typeof resetOpToPending>;
const mockCountPendingOps = countPendingOps as Mock<typeof countPendingOps>;

function makeOp(overrides: Partial<QueuedReviewOp> = {}): QueuedReviewOp {
	return {
		clientOperationId: overrides.clientOperationId ?? "op-1",
		cardId: overrides.cardId ?? "card-1",
		rating: overrides.rating ?? 3,
		createdAt: overrides.createdAt ?? 1000,
		scope: overrides.scope ?? "all",
		syncStatus: overrides.syncStatus ?? "pending",
		lastError: overrides.lastError,
	};
}

function okResponse(): Response {
	return { ok: true, status: 200 } as Response;
}

function errorResponse(status: number): Response {
	return { ok: false, status } as Response;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("syncReviewOps", () => {
	it("syncs all pending ops when all return 200", async () => {
		const ops = [
			makeOp({ clientOperationId: "op-1", createdAt: 1000 }),
			makeOp({ clientOperationId: "op-2", createdAt: 2000 }),
			makeOp({ clientOperationId: "op-3", createdAt: 3000 }),
		];
		mockGetPendingOps.mockResolvedValue(ops);
		mockAuthFetch.mockResolvedValue(okResponse());
		mockDeleteOp.mockResolvedValue(undefined);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockCountPendingOps.mockResolvedValue(0);

		const result = await syncReviewOps();

		expect(result.synced).toBe(3);
		expect(result.failed).toBe(0);
		expect(result.remaining).toBe(0);
		expect(result.stoppedReason).toBeUndefined();
		expect(mockDeleteOp).toHaveBeenCalledTimes(3);
	});

	it("submits ops in createdAt order", async () => {
		const ops = [
			makeOp({ clientOperationId: "op-a", cardId: "card-a", createdAt: 1000 }),
			makeOp({ clientOperationId: "op-b", cardId: "card-b", createdAt: 2000 }),
		];
		mockGetPendingOps.mockResolvedValue(ops);
		mockAuthFetch.mockResolvedValue(okResponse());
		mockDeleteOp.mockResolvedValue(undefined);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockCountPendingOps.mockResolvedValue(0);

		await syncReviewOps();

		// setOpSyncing called in order
		expect(mockSetOpSyncing).toHaveBeenNthCalledWith(1, "op-a");
		expect(mockSetOpSyncing).toHaveBeenNthCalledWith(2, "op-b");
		// deleteOp called in order
		expect(mockDeleteOp).toHaveBeenNthCalledWith(1, "op-a");
		expect(mockDeleteOp).toHaveBeenNthCalledWith(2, "op-b");
		// authFetch called with correct body
		expect(mockAuthFetch).toHaveBeenNthCalledWith(
			1,
			"/api/review/submit",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ cardId: "card-a", rating: 3 }),
			}),
		);
	});

	it("stops on network failure with stoppedReason 'network'", async () => {
		const ops = [
			makeOp({ clientOperationId: "op-1", createdAt: 1000 }),
			makeOp({ clientOperationId: "op-2", createdAt: 2000 }),
			makeOp({ clientOperationId: "op-3", createdAt: 3000 }),
		];
		mockGetPendingOps.mockResolvedValue(ops);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockDeleteOp.mockResolvedValue(undefined);
		mockCountPendingOps.mockResolvedValue(2);
		mockAuthFetch
			.mockResolvedValueOnce(okResponse())
			.mockRejectedValueOnce(new TypeError("network error"));

		const result = await syncReviewOps();

		expect(result.synced).toBe(1);
		expect(result.stoppedReason).toBe("network");
		expect(mockDeleteOp).toHaveBeenCalledTimes(1);
		expect(mockDeleteOp).toHaveBeenCalledWith("op-1");
	});

	it("stops on 401 with stoppedReason 'auth'", async () => {
		const ops = [makeOp({ clientOperationId: "op-1" })];
		mockGetPendingOps.mockResolvedValue(ops);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockAuthFetch.mockResolvedValue(errorResponse(401));
		mockCountPendingOps.mockResolvedValue(1);

		const result = await syncReviewOps();

		expect(result.stoppedReason).toBe("auth");
		expect(result.synced).toBe(0);
		expect(mockDeleteOp).not.toHaveBeenCalled();
	});

	it("marks op failed on 400 and continues to next op", async () => {
		const ops = [
			makeOp({ clientOperationId: "op-1", createdAt: 1000 }),
			makeOp({ clientOperationId: "op-2", createdAt: 2000 }),
		];
		mockGetPendingOps.mockResolvedValue(ops);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockMarkOpFailed.mockResolvedValue(undefined);
		mockDeleteOp.mockResolvedValue(undefined);
		mockCountPendingOps.mockResolvedValue(0);
		mockAuthFetch.mockResolvedValueOnce(errorResponse(400)).mockResolvedValueOnce(okResponse());

		const result = await syncReviewOps();

		expect(mockMarkOpFailed).toHaveBeenCalledWith("op-1", "Invalid request");
		expect(result.failed).toBe(1);
		expect(result.synced).toBe(1);
		expect(mockDeleteOp).toHaveBeenCalledWith("op-2");
	});

	it("marks op failed with 'server-priority' on 404", async () => {
		const ops = [makeOp({ clientOperationId: "op-1" })];
		mockGetPendingOps.mockResolvedValue(ops);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockMarkOpFailed.mockResolvedValue(undefined);
		mockAuthFetch.mockResolvedValue(errorResponse(404));
		mockCountPendingOps.mockResolvedValue(0);

		const result = await syncReviewOps();

		expect(mockMarkOpFailed).toHaveBeenCalledWith("op-1", "server-priority");
		expect(result.failed).toBe(1);
	});

	it("marks op failed with 'server-priority' on 409", async () => {
		const ops = [makeOp({ clientOperationId: "op-1" })];
		mockGetPendingOps.mockResolvedValue(ops);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockMarkOpFailed.mockResolvedValue(undefined);
		mockAuthFetch.mockResolvedValue(errorResponse(409));
		mockCountPendingOps.mockResolvedValue(0);

		const result = await syncReviewOps();

		expect(mockMarkOpFailed).toHaveBeenCalledWith("op-1", "server-priority");
		expect(result.failed).toBe(1);
	});

	it("resets op to pending and stops on 503", async () => {
		const ops = [makeOp({ clientOperationId: "op-1" })];
		mockGetPendingOps.mockResolvedValue(ops);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockResetOpToPending.mockResolvedValue(undefined);
		mockAuthFetch.mockResolvedValue(errorResponse(503));
		mockCountPendingOps.mockResolvedValue(1);

		const result = await syncReviewOps();

		expect(mockResetOpToPending).toHaveBeenCalledWith("op-1");
		expect(mockMarkOpFailed).not.toHaveBeenCalled();
		expect(result.stoppedReason).toBe("server-error");
		expect(result.failed).toBe(0);
	});

	it("prevents concurrent sync via mutex", async () => {
		const ops = [makeOp({ clientOperationId: "op-1" })];
		mockGetPendingOps.mockResolvedValue(ops);
		mockSetOpSyncing.mockResolvedValue(undefined);
		mockAuthFetch.mockResolvedValue(okResponse());
		mockDeleteOp.mockResolvedValue(undefined);
		mockCountPendingOps.mockResolvedValue(0);

		// Start two syncs concurrently
		const [r1, r2] = await Promise.all([syncReviewOps(), syncReviewOps()]);

		// Both should complete, and getPendingOps should be called twice (sequentially)
		expect(mockGetPendingOps).toHaveBeenCalledTimes(2);
		expect(r1.synced + r2.synced).toBe(2);
	});
});

describe("getSyncStatus", () => {
	it("returns correct pendingCount", async () => {
		mockCountPendingOps.mockResolvedValue(5);
		mockGetAllOps.mockResolvedValue([]);

		const status = await getSyncStatus();

		expect(status.pendingCount).toBe(5);
		expect(status.lastError).toBeUndefined();
	});

	it("returns lastError from the most recently failed op", async () => {
		mockCountPendingOps.mockResolvedValue(2);
		mockGetAllOps.mockResolvedValue([
			makeOp({
				clientOperationId: "op-1",
				syncStatus: "failed",
				lastError: "old error",
				createdAt: 1000,
			}),
			makeOp({
				clientOperationId: "op-2",
				syncStatus: "failed",
				lastError: "recent error",
				createdAt: 2000,
			}),
		]);

		const status = await getSyncStatus();

		expect(status.pendingCount).toBe(2);
		expect(status.lastError).toBe("recent error");
	});
});
