/// <reference lib="dom" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

type Listener = (event: { target: FakeElement; key?: string }) => void;

class FakeClassList {
	constructor(private readonly element: FakeElement) {}

	contains(name: string): boolean {
		return this.element.className.split(/\s+/).includes(name);
	}
}

class FakeElement {
	readonly tagName: string;
	readonly children: FakeElement[] = [];
	readonly listeners = new Map<string, Listener[]>();
	readonly dataset: Record<string, string> = {};
	readonly style: Record<string, string> = {};
	readonly classList = new FakeClassList(this);
	parentElement: FakeElement | null = null;
	id = "";
	className = "";
	type = "";
	title = "";
	disabled = false;
	value = "";
	href = "";
	download = "";
	clicked = false;
	private html = "";
	private text = "";

	constructor(tagName = "div") {
		this.tagName = tagName.toUpperCase();
	}

	set innerHTML(value: string) {
		this.html = value;
		this.children.length = 0;
		if (value.includes('id="search-input"')) {
			const exportTitle = this.appendKnownChild("div", "", "search-export-title");
			exportTitle.textContent = "Export your collection";
			const exportCopy = this.appendKnownChild("div", "", "hint");
			exportCopy.textContent =
				"Exports all notes as an Anki .apkg file. Review progress is not included.";
			const exportButton = this.appendKnownChild("button", "export-apkg-btn", "secondary");
			exportButton.textContent = "Export .apkg";
			this.appendKnownChild("div", "export-apkg-status", "hint");
			this.appendKnownChild("input", "search-input");
			this.appendKnownChild("div", "search-status", "hint");
			this.appendKnownChild("div", "search-results", "card-area");
			this.appendKnownChild("button", "search-more", "secondary");
		}
	}

	get innerHTML(): string {
		return this.html;
	}

	set textContent(value: string) {
		this.text = value;
	}

	get textContent(): string {
		const childText = this.children.map((child) => child.textContent).join("");
		return `${this.text}${childText}`;
	}

	appendChild(child: FakeElement): FakeElement {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	removeChild(child: FakeElement): FakeElement {
		const index = this.children.indexOf(child);
		if (index >= 0) this.children.splice(index, 1);
		child.parentElement = null;
		return child;
	}

	remove(): void {
		this.parentElement?.removeChild(this);
	}

	querySelector<T>(selector: string): T | null {
		if (!selector.startsWith("#")) return null;
		return (this.findById(selector.slice(1)) as T | undefined) ?? null;
	}

	addEventListener(type: string, listener: Listener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	click(): void {
		this.clicked = true;
		for (const listener of this.listeners.get("click") ?? []) {
			listener({ target: this });
		}
	}

	closest(selector: string): FakeElement | null {
		if (!selector.startsWith(".")) return null;
		const className = selector.slice(1);
		let current: FakeElement | null = this;
		while (current) {
			if (current.classList.contains(className)) return current;
			current = current.parentElement;
		}
		return null;
	}

	private appendKnownChild(tagName: string, id: string, className = ""): FakeElement {
		const child = new FakeElement(tagName);
		child.id = id;
		child.className = className;
		this.appendChild(child);
		return child;
	}

	private findById(id: string): FakeElement | undefined {
		if (this.id === id) return this;
		for (const child of this.children) {
			const found = child.findById(id);
			if (found) return found;
		}
		return undefined;
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("downloadApkgExport", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllGlobals();
		vi.stubGlobal("localStorage", new MemoryStorage());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("calls the APKG endpoint with auth and returns the blob plus server filename", async () => {
		(globalThis.localStorage as Storage).setItem("anki-api-key", "secret-key");
		const body = new Blob(["apkg bytes"], { type: "application/octet-stream" });
		const fetchMock = vi.fn(
			async () =>
				new Response(body, {
					status: 200,
					headers: { "Content-Disposition": 'attachment; filename="anki-vocab-2026-06-29.apkg"' },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { downloadApkgExport } = await import("../pwa/src/api");
		const result = await downloadApkgExport();

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/export/apkg",
			expect.objectContaining({ headers: expect.any(Headers) }),
		);
		const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
		const init = calls[0][1];
		expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-key");
		expect(result.filename).toBe("anki-vocab-2026-06-29.apkg");
		expect(await result.blob.text()).toBe("apkg bytes");
	});

	it("falls back to a safe filename when Content-Disposition is missing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(new Blob(["bytes"]), { status: 200 })),
		);

		const { downloadApkgExport } = await import("../pwa/src/api");
		const result = await downloadApkgExport();

		expect(result.filename).toBe("anki-vocab-export.apkg");
	});

	it("rejects non-OK responses with a useful error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: "no notes to export" }), {
						status: 400,
						statusText: "Bad Request",
						headers: { "content-type": "application/json" },
					}),
			),
		);

		const { downloadApkgExport } = await import("../pwa/src/api");
		await expect(downloadApkgExport()).rejects.toThrow(/no notes to export/i);
	});
});

describe("Search APKG export UI", () => {
	const searchNotes = vi.fn();
	const deleteNote = vi.fn();
	const downloadApkgExport = vi.fn();
	let body: FakeElement;
	let createdAnchors: FakeElement[];
	let revokeObjectURL: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllGlobals();
		searchNotes.mockResolvedValue({ notes: [], total: 0 });
		deleteNote.mockResolvedValue(undefined);
		downloadApkgExport.mockReset();
		vi.useFakeTimers();
		createdAnchors = [];
		body = new FakeElement("body");
		revokeObjectURL = vi.fn();
		vi.stubGlobal("document", {
			body,
			createElement: (tagName: string) => {
				const element = new FakeElement(tagName);
				if (tagName === "a") createdAnchors.push(element);
				return element;
			},
		});
		const urlConstructor = URL as typeof URL & {
			createObjectURL: (blob: Blob) => string;
			revokeObjectURL: (url: string) => void;
		};
		urlConstructor.createObjectURL = vi.fn(() => "blob:apkg");
		urlConstructor.revokeObjectURL = revokeObjectURL as unknown as (url: string) => void;
		vi.doMock("../pwa/src/api", () => ({
			deleteNote,
			downloadApkgExport,
			searchNotes,
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.doUnmock("../pwa/src/api");
		vi.unstubAllGlobals();
	});

	it("renders the export button and explanatory copy", async () => {
		const root = new FakeElement();
		const { renderSearch } = await import("../pwa/src/search");

		await renderSearch(root as unknown as HTMLElement);

		const button = root.querySelector<FakeElement>("#export-apkg-btn");
		expect(button).not.toBeNull();
		expect(button?.textContent).toContain("Export .apkg");
		expect(root.textContent).toMatch(/all notes/i);
		expect(root.textContent).toMatch(/review progress/i);
	});

	it("disables the export button and shows exporting state while pending", async () => {
		const pending = deferred<{ blob: Blob; filename: string }>();
		downloadApkgExport.mockReturnValue(pending.promise);
		const root = new FakeElement();
		const { renderSearch } = await import("../pwa/src/search");
		await renderSearch(root as unknown as HTMLElement);
		const button = root.querySelector<FakeElement>("#export-apkg-btn");
		const status = root.querySelector<FakeElement>("#export-apkg-status");

		button?.click();
		await Promise.resolve();

		expect(button?.disabled).toBe(true);
		expect(button?.textContent).toMatch(/exporting/i);
		expect(status?.textContent).toMatch(/exporting/i);
		pending.resolve({ blob: new Blob(["bytes"]), filename: "anki-vocab.apkg" });
		await pending.promise;
	});

	it("downloads the returned blob with a temporary object URL and cleans it up", async () => {
		downloadApkgExport.mockResolvedValue({
			blob: new Blob(["bytes"]),
			filename: "anki-vocab.apkg",
		});
		const root = new FakeElement();
		const { renderSearch } = await import("../pwa/src/search");
		await renderSearch(root as unknown as HTMLElement);
		const button = root.querySelector<FakeElement>("#export-apkg-btn");

		button?.click();
		await Promise.resolve();
		await Promise.resolve();

		expect(
			(URL as typeof URL & { createObjectURL: (blob: Blob) => string }).createObjectURL,
		).toHaveBeenCalledOnce();
		expect(createdAnchors[0]?.href).toBe("blob:apkg");
		expect(createdAnchors[0]?.download).toBe("anki-vocab.apkg");
		expect(createdAnchors[0]?.clicked).toBe(true);
		expect(revokeObjectURL).not.toHaveBeenCalled();
		expect(body.children).toHaveLength(0);

		await vi.runOnlyPendingTimersAsync();

		expect(revokeObjectURL).toHaveBeenCalledWith("blob:apkg");
	});

	it("shows a friendly error message when export fails", async () => {
		downloadApkgExport.mockRejectedValue(new Error("network down"));
		const root = new FakeElement();
		const { renderSearch } = await import("../pwa/src/search");
		await renderSearch(root as unknown as HTMLElement);
		const button = root.querySelector<FakeElement>("#export-apkg-btn");
		const status = root.querySelector<FakeElement>("#export-apkg-status");

		button?.click();
		await Promise.resolve();
		await Promise.resolve();

		expect(button?.disabled).toBe(false);
		expect(button?.textContent).toContain("Export .apkg");
		expect(status?.textContent).toMatch(/couldn't export/i);
		expect(status?.textContent).toMatch(/network down/i);
	});
});
