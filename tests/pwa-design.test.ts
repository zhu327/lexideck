import { afterEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
	private readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	clear(): void {
		this.values.clear();
	}
}

class MarkupOnlyElement {
	innerHTML = "";

	querySelector(): null {
		return null;
	}
}

describe("PWA Lovable-inspired page shells", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders Review with an editorial hero before the card", async () => {
		vi.stubGlobal("HTMLElement", MarkupOnlyElement);
		vi.stubGlobal("localStorage", new MemoryStorage());
		const root = new MarkupOnlyElement();
		const { renderReview } = await import("../pwa/src/review");

		await renderReview(root as unknown as HTMLElement);

		expect(root.innerHTML).toContain("review-page");
		expect(root.innerHTML).toContain("review-hero");
		expect(root.innerHTML).toContain("Daily Review");
		expect(root.innerHTML).toContain("Review due cards");
	});

	it("renders Stats with a page hero and un-nested stats area", async () => {
		const root = new MarkupOnlyElement();
		const { renderStats } = await import("../pwa/src/stats");

		await renderStats(root as unknown as HTMLElement);

		expect(root.innerHTML).toContain("stats-page");
		expect(root.innerHTML).toContain("stats-hero");
		expect(root.innerHTML).toContain("Progress Snapshot");
		expect(root.innerHTML).toContain("Your memory practice at a glance");
		expect(root.innerHTML).toContain('id="stats-area"');
		expect(root.innerHTML).not.toContain('id="stats-area" class="card-area"');
	});
});
