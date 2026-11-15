import { describe, expect, it } from "vitest";
import {
	clampDragOffset,
	resolveSwipe,
	SWIPE_INTENT_PX,
	SWIPE_THRESHOLD_PX,
	swipeIntent,
} from "../pwa/src/gestures";

describe("resolveSwipe", () => {
	it("ignores drags shorter than the threshold", () => {
		expect(resolveSwipe({ dx: SWIPE_THRESHOLD_PX - 1, dy: 0 })).toBeNull();
		expect(resolveSwipe({ dx: -(SWIPE_THRESHOLD_PX - 1), dy: 0 })).toBeNull();
	});

	it("rates a left swipe as Again", () => {
		expect(resolveSwipe({ dx: -SWIPE_THRESHOLD_PX, dy: 0 })).toBe(1);
	});

	it("rates a right swipe as Good", () => {
		expect(resolveSwipe({ dx: SWIPE_THRESHOLD_PX, dy: 0 })).toBe(3);
	});

	it("ignores mostly vertical drags so scrolling never rates a card", () => {
		expect(resolveSwipe({ dx: 90, dy: 120 })).toBeNull();
		expect(resolveSwipe({ dx: -90, dy: -120 })).toBeNull();
	});

	it("accepts diagonal drags that are clearly horizontal", () => {
		expect(resolveSwipe({ dx: 120, dy: 40 })).toBe(3);
	});

	it("honours a custom threshold", () => {
		expect(resolveSwipe({ dx: 40, dy: 0, threshold: 30 })).toBe(3);
		expect(resolveSwipe({ dx: 40, dy: 0, threshold: 60 })).toBeNull();
	});
});

describe("swipeIntent", () => {
	it("returns null inside the intent dead zone", () => {
		expect(swipeIntent(0)).toBeNull();
		expect(swipeIntent(SWIPE_INTENT_PX - 1)).toBeNull();
	});

	it("reports the drag direction", () => {
		expect(swipeIntent(SWIPE_INTENT_PX)).toBe("right");
		expect(swipeIntent(-SWIPE_INTENT_PX)).toBe("left");
	});
});

describe("clampDragOffset", () => {
	it("keeps the card from sliding off-screen", () => {
		expect(clampDragOffset(400)).toBe(140);
		expect(clampDragOffset(-400)).toBe(-140);
		expect(clampDragOffset(42)).toBe(42);
	});

	it("accepts a custom maximum", () => {
		expect(clampDragOffset(90, 60)).toBe(60);
	});
});
