/// <reference lib="dom" />

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteSearchResult } from "../pwa/src/api";

type FakeListener = (event: { target: FakeElement; stopPropagation: () => void }) => void;

class FakeClassList {
	constructor(private readonly element: FakeElement) {}

	contains(name: string): boolean {
		return this.element.className.split(/\s+/).includes(name);
	}

	toggle(name: string, force?: boolean): void {
		const names = new Set(this.element.className.split(/\s+/).filter(Boolean));
		const shouldHave = force ?? !names.has(name);
		if (shouldHave) names.add(name);
		else names.delete(name);
		this.element.className = [...names].join(" ");
	}
}

class FakeElement {
	readonly tagName: string;
	readonly children: FakeElement[] = [];
	readonly dataset: Record<string, string> = {};
	readonly style: Record<string, string> = {};
	readonly listeners = new Map<string, FakeListener[]>();
	readonly classList = new FakeClassList(this);
	parentElement: FakeElement | null = null;
	id = "";
	className = "";
	type = "";
	title = "";
	disabled = false;
	readonly attributes = new Map<string, string>();
	private html = "";
	private text = "";

	constructor(tagName = "div") {
		this.tagName = tagName.toUpperCase();
	}

	get parentNode(): FakeElement | null {
		return this.parentElement;
	}

	set innerHTML(value: string) {
		this.html = value;
		this.children.length = 0;
	}

	get innerHTML(): string {
		return this.html;
	}

	set textContent(value: string) {
		this.text = value;
	}

	get textContent(): string {
		return `${this.text}${this.html}${this.children.map((child) => child.textContent).join("")}`;
	}

	append(...children: FakeElement[]): void {
		for (const child of children) this.appendChild(child);
	}

	appendChild(child: FakeElement): FakeElement {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	insertBefore(child: FakeElement, reference: FakeElement | null): FakeElement {
		child.parentElement = this;
		const index = reference ? this.children.indexOf(reference) : -1;
		if (index >= 0) this.children.splice(index, 0, child);
		else this.children.push(child);
		return child;
	}

	remove(): void {
		if (!this.parentElement) return;
		const index = this.parentElement.children.indexOf(this);
		if (index >= 0) this.parentElement.children.splice(index, 1);
		this.parentElement = null;
	}

	addEventListener(type: string, listener: FakeListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: FakeListener): void {
		this.listeners.set(
			type,
			(this.listeners.get(type) ?? []).filter((item) => item !== listener),
		);
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	click(): void {
		let stopped = false;
		let current: FakeElement | null = this;
		const event = { target: this, stopPropagation: () => (stopped = true) };
		while (current && !stopped) {
			for (const listener of current.listeners.get("click") ?? []) listener(event);
			current = current.parentElement;
		}
	}

	closest(selector: string): FakeElement | null {
		let current: FakeElement | null = this;
		while (current) {
			if (matches(current, selector)) return current;
			current = current.parentElement;
		}
		return null;
	}

	querySelector<T>(selector: string): T | null {
		return (this.querySelectorAll<T>(selector)[0] as T | undefined) ?? null;
	}

	querySelectorAll<T>(selector: string): T[] {
		const found: T[] = [];
		for (const child of this.children) {
			if (matches(child, selector)) found.push(child as T);
			found.push(...child.querySelectorAll<T>(selector));
		}
		return found;
	}
}

function matches(element: FakeElement, selector: string): boolean {
	const dataMatch = selector.match(/^\[data-note-id="([^"]+)"\]$/);
	if (dataMatch) return element.dataset.noteId === dataMatch[1];
	if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
	if (selector.startsWith("#")) return element.id === selector.slice(1);
	return element.tagName.toLowerCase() === selector.toLowerCase();
}

const fetchEnrichment = vi.fn();
const markFamiliar = vi.fn();
const unmarkFamiliar = vi.fn();
const deleteNote = vi.fn();
const enrichNote = vi.fn();

vi.mock("../pwa/src/api", () => ({
	deleteNote,
	enrichNote,
	fetchEnrichment,
	markFamiliar,
	unmarkFamiliar,
}));

vi.mock("../pwa/src/tts", () => ({
	speak: vi.fn(),
}));

function note(noteId: string, front: string, back: string): NoteSearchResult {
	return {
		noteId,
		fields: { Front: front, Back: back },
		deckName: "Default",
		tags: [],
		known: false,
	};
}

function renderRow(item: NoteSearchResult): HTMLElement {
	const row = document.createElement("div") as unknown as FakeElement;
	row.className = "search-row";
	row.dataset.noteId = item.noteId;
	row.textContent = item.fields.Front ?? "";
	return row as unknown as HTMLElement;
}

describe("attachCardActions", () => {
	beforeEach(() => {
		vi.resetModules();
		fetchEnrichment.mockResolvedValue(null);
		markFamiliar.mockResolvedValue(undefined);
		unmarkFamiliar.mockResolvedValue(undefined);
		deleteNote.mockResolvedValue(undefined);
		enrichNote.mockResolvedValue({ error: "unavailable" });
		vi.stubGlobal("document", {
			body: new FakeElement("body"),
			createElement: (tagName: string) => new FakeElement(tagName),
		});
	});

	it("opens the selected note in a bottom sheet with previous and next controls", async () => {
		const first = note("1", "apple", "苹果");
		const second = note("2", "banana", "香蕉");
		const results = document.createElement("div") as unknown as FakeElement;
		results.append(
			renderRow(first) as unknown as FakeElement,
			renderRow(second) as unknown as FakeElement,
		);
		const cache = new Map([
			[first.noteId, first],
			[second.noteId, second],
		]);
		const { attachCardActions } = await import("../pwa/src/search-card-actions");
		attachCardActions(results as unknown as HTMLElement, cache);

		results.querySelector<FakeElement>('[data-note-id="1"]')?.click();
		await Promise.resolve();

		const sheet = (document.body as unknown as FakeElement).querySelector<FakeElement>(
			".search-sheet",
		);
		expect(sheet).not.toBeNull();
		expect(sheet?.textContent).toContain("apple");
		expect(sheet?.textContent).not.toContain("Mark Known");
		expect(sheet?.textContent).toContain("‹ Prev");
		expect(sheet?.textContent).not.toContain("‹ Previous");
		expect(sheet?.textContent).toContain("×");
		expect(sheet?.querySelector(".search-sheet-prev")).not.toBeNull();
		expect(sheet?.querySelector(".search-sheet-next")).not.toBeNull();
		expect(sheet?.querySelector(".search-known-btn")).toBeNull();
		expect(results.querySelector(".search-expanded")).toBeNull();
	});

	it("keeps the refresh action above enrichment details in the bottom sheet", async () => {
		const item = note("1", "apple", "苹果");
		const results = document.createElement("div") as unknown as FakeElement;
		results.append(renderRow(item) as unknown as FakeElement);
		const cache = new Map([[item.noteId, item]]);
		const { attachCardActions } = await import("../pwa/src/search-card-actions");
		attachCardActions(results as unknown as HTMLElement, cache);

		results.querySelector<FakeElement>('[data-note-id="1"]')?.click();
		await Promise.resolve();

		const sheetText = (document.body as unknown as FakeElement).querySelector<FakeElement>(
			".search-sheet",
		)?.textContent;
		expect(sheetText?.indexOf("search-enrich-actions")).toBeLessThan(
			sheetText?.indexOf("search-enrich-area") ?? -1,
		);
	});

	it("moves between search results from the bottom sheet", async () => {
		const first = note("1", "apple", "苹果");
		const second = note("2", "banana", "香蕉");
		const results = document.createElement("div") as unknown as FakeElement;
		results.append(
			renderRow(first) as unknown as FakeElement,
			renderRow(second) as unknown as FakeElement,
		);
		const cache = new Map([
			[first.noteId, first],
			[second.noteId, second],
		]);
		const { attachCardActions } = await import("../pwa/src/search-card-actions");
		attachCardActions(results as unknown as HTMLElement, cache);

		results.querySelector<FakeElement>('[data-note-id="1"]')?.click();
		await Promise.resolve();
		(document.body as unknown as FakeElement)
			.querySelector<FakeElement>(".search-sheet-next")
			?.click();
		await Promise.resolve();

		const sheet = (document.body as unknown as FakeElement).querySelector<FakeElement>(
			".search-sheet",
		);
		expect(sheet?.textContent).toContain("banana");
		expect(sheet?.textContent).not.toContain("apple");
		expect(
			(document.body as unknown as FakeElement).querySelector<FakeElement>(".search-sheet-next")
				?.disabled,
		).toBe(true);
		expect(
			(document.body as unknown as FakeElement).querySelector<FakeElement>(".search-sheet-prev")
				?.disabled,
		).toBe(false);
	});
});
