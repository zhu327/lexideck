import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCardHTML } from "../pwa/src/card-renderer";
import { renderFields } from "../pwa/src/fields";
import {
	buildDueUrl,
	buildFamiliarUrl,
	buildQuizUrl,
	enrichUnavailableMessage,
	errorMessage,
	formatInterval,
	RATING_LABELS,
	stateClass,
	stateLabel,
} from "../pwa/src/helpers";
import { isTtsAvailable, speak, stopSpeaking } from "../pwa/src/tts";

describe("buildDueUrl", () => {
	it("returns only the limit query when deck is null", () => {
		expect(buildDueUrl(null, 20)).toBe("?limit=20");
	});

	it("includes deck and limit when a deck is provided", () => {
		expect(buildDueUrl("Default", 20)).toBe("?deck=Default&limit=20");
	});

	it("URL-encodes special characters in the deck name", () => {
		expect(buildDueUrl("My Deck", 20)).toBe("?deck=My%20Deck&limit=20");
	});

	it("includes offset when provided", () => {
		expect(buildDueUrl("Default", 50, 10)).toBe("?deck=Default&limit=50&offset=10");
	});

	it("omits offset when not provided", () => {
		expect(buildDueUrl("Default", 50)).toBe("?deck=Default&limit=50");
	});

	it("includes offset with null deck", () => {
		expect(buildDueUrl(null, 50, 5)).toBe("?limit=50&offset=5");
	});

	it("omits offset when zero", () => {
		expect(buildDueUrl(null, 50, 0)).toBe("?limit=50");
	});
});

describe("buildQuizUrl", () => {
	it("returns only the limit query when deck is null", () => {
		expect(buildQuizUrl(null, 20)).toBe("?limit=20");
	});

	it("includes deck and limit when a deck is provided", () => {
		expect(buildQuizUrl("Default", 20)).toBe("?deck=Default&limit=20");
	});
});

describe("buildFamiliarUrl", () => {
	it("returns an empty string (no params)", () => {
		expect(buildFamiliarUrl()).toBe("");
	});
});

describe("RATING_LABELS", () => {
	it("maps each rating to its FSRS-style label", () => {
		expect(RATING_LABELS[1]).toBe("Again");
		expect(RATING_LABELS[2]).toBe("Hard");
		expect(RATING_LABELS[3]).toBe("Good");
		expect(RATING_LABELS[4]).toBe("Easy");
	});
});

describe("buildCardHTML", () => {
	it("keeps the enrich action in its own padded area above ratings", () => {
		const html = buildCardHTML().replace(/\s+/g, " ");

		expect(html).toContain('<div class="enrich-actions"> <button id="enrich-btn"');
		expect(html).toContain('</button> </div> <div id="enrich-result"></div> <div class="ratings"');
	});
});

describe("errorMessage", () => {
	it("returns the message of an Error", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom");
	});

	it("stringifies non-Error values", () => {
		expect(errorMessage("oops")).toBe("oops");
		expect(errorMessage(42)).toBe("42");
	});
});

describe("enrichUnavailableMessage", () => {
	it("returns a 'not configured' message for HTTP 503", () => {
		expect(enrichUnavailableMessage(503)).toContain("not configured");
	});

	it("returns a generic message for other statuses", () => {
		const message = enrichUnavailableMessage(502);
		expect(message).not.toContain("not configured");
		expect(message.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// registerShortcuts — keyboard module tests
// Uses a mocked document to simulate keydown events in the Workers test env.
// ---------------------------------------------------------------------------

describe("formatInterval", () => {
	it("returns 'now' for past due times", () => {
		expect(formatInterval(Date.now() - 1000)).toBe("now");
	});
	it("returns minutes for < 1 hour", () => {
		const result = formatInterval(Date.now() + 180_000); // 3 min
		expect(result).toBe("3m");
	});
	it("returns hours for < 1 day", () => {
		const result = formatInterval(Date.now() + 7_200_000); // 2 hours
		expect(result).toBe("2h");
	});
	it("returns days for < 30 days", () => {
		const result = formatInterval(Date.now() + 259_200_000); // 3 days
		expect(result).toBe("3d");
	});
	it("returns months for >= 30 days", () => {
		const result = formatInterval(Date.now() + 2_592_000_000); // ~30 days
		expect(result).toBe("1.0mo");
	});
});

describe("registerShortcuts", () => {
	type Listener = (event: { key: string; target: unknown; preventDefault: () => void }) => void;

	let listeners: Listener[];
	let mockDocument: {
		addEventListener: ReturnType<typeof vi.fn>;
		removeEventListener: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		listeners = [];
		mockDocument = {
			addEventListener: vi.fn((_type: string, listener: Listener) => {
				listeners.push(listener);
			}),
			removeEventListener: vi.fn((_type: string, listener: Listener) => {
				listeners = listeners.filter((l) => l !== listener);
			}),
		};
		vi.stubGlobal("document", mockDocument);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function fireKeydown(key: string, target?: unknown) {
		const event = {
			key,
			target: target ?? { tagName: "DIV", isContentEditable: false },
			preventDefault: vi.fn(),
		};
		for (const listener of [...listeners]) {
			listener(event);
		}
		return event;
	}

	it("returns a cleanup function", async () => {
		const { registerShortcuts } = await import("../pwa/src/keyboard");
		const cleanup = registerShortcuts([]);
		expect(typeof cleanup).toBe("function");
	});

	it("calls the matching handler on keydown", async () => {
		const { registerShortcuts } = await import("../pwa/src/keyboard");
		const handler = vi.fn();
		registerShortcuts([{ key: " ", handler }]);

		fireKeydown(" ");
		expect(handler).toHaveBeenCalledOnce();
	});

	it("does not call handler for non-matching keys", async () => {
		const { registerShortcuts } = await import("../pwa/src/keyboard");
		const handler = vi.fn();
		registerShortcuts([{ key: " ", handler }]);

		fireKeydown("a");
		expect(handler).not.toHaveBeenCalled();
	});

	it("after cleanup, keydown no longer triggers handler", async () => {
		const { registerShortcuts } = await import("../pwa/src/keyboard");
		const handler = vi.fn();
		const cleanup = registerShortcuts([{ key: " ", handler }]);

		cleanup();
		fireKeydown(" ");
		expect(handler).not.toHaveBeenCalled();
		expect(mockDocument.removeEventListener).toHaveBeenCalledOnce();
	});

	it("ignores events from <input> targets", async () => {
		const { registerShortcuts } = await import("../pwa/src/keyboard");
		const handler = vi.fn();
		registerShortcuts([{ key: " ", handler }]);

		fireKeydown(" ", { tagName: "INPUT", isContentEditable: false });
		expect(handler).not.toHaveBeenCalled();
	});

	it("ignores events from <textarea> targets", async () => {
		const { registerShortcuts } = await import("../pwa/src/keyboard");
		const handler = vi.fn();
		registerShortcuts([{ key: "1", handler }]);

		fireKeydown("1", { tagName: "TEXTAREA", isContentEditable: false });
		expect(handler).not.toHaveBeenCalled();
	});

	it("ignores events from contenteditable targets", async () => {
		const { registerShortcuts } = await import("../pwa/src/keyboard");
		const handler = vi.fn();
		registerShortcuts([{ key: " ", handler }]);

		fireKeydown(" ", { tagName: "DIV", isContentEditable: true });
		expect(handler).not.toHaveBeenCalled();
	});

	it("supports multiple independent bindings", async () => {
		const { registerShortcuts } = await import("../pwa/src/keyboard");
		const handlerA = vi.fn();
		const handlerB = vi.fn();
		registerShortcuts([
			{ key: "1", handler: handlerA },
			{ key: "2", handler: handlerB },
		]);

		fireKeydown("1");
		expect(handlerA).toHaveBeenCalledOnce();
		expect(handlerB).not.toHaveBeenCalled();

		fireKeydown("2");
		expect(handlerA).toHaveBeenCalledOnce();
		expect(handlerB).toHaveBeenCalledOnce();
	});
});

describe("TTS module", () => {
	it("isTtsAvailable returns false in Node environment", () => {
		// In Node, speechSynthesis is undefined
		expect(isTtsAvailable()).toBe(false);
	});

	it("speak does not throw when speechSynthesis is unavailable", () => {
		expect(() => speak("hello")).not.toThrow();
	});

	it("stopSpeaking does not throw when speechSynthesis is unavailable", () => {
		expect(() => stopSpeaking()).not.toThrow();
	});
});

describe("stateLabel", () => {
	it("returns 'New' for state 0", () => {
		expect(stateLabel(0)).toBe("New");
	});
	it("returns 'Learning' for state 1", () => {
		expect(stateLabel(1)).toBe("Learning");
	});
	it("returns 'Review' for state 2", () => {
		expect(stateLabel(2)).toBe("Review");
	});
	it("returns 'Relearning' for state 3", () => {
		expect(stateLabel(3)).toBe("Relearning");
	});
	it("returns 'Unknown' for unrecognized state", () => {
		expect(stateLabel(99)).toBe("Unknown");
	});
});

describe("stateClass", () => {
	it("returns 'state-new' for state 0", () => {
		expect(stateClass(0)).toBe("state-new");
	});
	it("returns 'state-learning' for state 1", () => {
		expect(stateClass(1)).toBe("state-learning");
	});
	it("returns 'state-review' for state 2", () => {
		expect(stateClass(2)).toBe("state-review");
	});
	it("returns 'state-relearning' for state 3", () => {
		expect(stateClass(3)).toBe("state-relearning");
	});
	it("returns 'state-unknown' for unrecognized state", () => {
		expect(stateClass(99)).toBe("state-unknown");
	});
});

describe("renderFields", () => {
	it("renders Basic model (Front/Back) correctly", () => {
		const html = renderFields({ Front: "dog", Back: "犬" }, "Front");
		expect(html).toContain("Back");
		expect(html).toContain("犬");
		expect(html).not.toContain("dog");
	});

	it("renders multi-field model (Word/Definition/Example) correctly", () => {
		const html = renderFields({ Word: "aberration", Definition: "偏离", Example: "例句" }, "Word");
		expect(html).toContain("Definition");
		expect(html).toContain("偏离");
		expect(html).toContain("Example");
		expect(html).toContain("例句");
		expect(html).not.toContain("aberration");
	});

	it("renders HTML in field values (card content from Yomitan contains HTML)", () => {
		const html = renderFields({ Front: "hello", Back: "line1<br>line2" }, "Front");
		expect(html).toContain("<br>");
	});
});
