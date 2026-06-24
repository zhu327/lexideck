import { describe, expect, it } from "vitest";
import {
	buildDueUrl,
	buildQuizUrl,
	enrichUnavailableMessage,
	errorMessage,
	RATING_LABELS,
} from "../pwa/src/helpers";

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
});

describe("buildQuizUrl", () => {
	it("returns only the limit query when deck is null", () => {
		expect(buildQuizUrl(null, 20)).toBe("?limit=20");
	});

	it("includes deck and limit when a deck is provided", () => {
		expect(buildQuizUrl("Default", 20)).toBe("?deck=Default&limit=20");
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
