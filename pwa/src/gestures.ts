/**
 * Touch-gesture math for the review card. Pure (no DOM) so it can be unit
 * tested: the pointer-event plumbing lives in review.ts.
 */

import type { Rating } from "./helpers";

/** Minimum horizontal travel (px) before a swipe counts. */
export const SWIPE_THRESHOLD_PX = 72;

/** Horizontal travel (px) before showing directional drag feedback. */
export const SWIPE_INTENT_PX = 24;

export type SwipeRating = Extract<Rating, 1 | 3>;

export interface SwipeInput {
	dx: number;
	dy: number;
	threshold?: number;
}

/**
 * Resolve a completed drag into a rating.
 * Swipe left → Again (1), swipe right → Good (3). Diagonal/vertical drags
 * return null so page scrolling is never mistaken for a rating.
 */
export function resolveSwipe({
	dx,
	dy,
	threshold = SWIPE_THRESHOLD_PX,
}: SwipeInput): SwipeRating | null {
	if (Math.abs(dx) < threshold) return null;
	if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
	return dx < 0 ? 1 : 3;
}

/**
 * Direction of the in-progress drag, used to paint feedback while dragging.
 * Returns null below the intent threshold.
 */
export function swipeIntent(dx: number, intent = SWIPE_INTENT_PX): "left" | "right" | null {
	if (dx <= -intent) return "left";
	if (dx >= intent) return "right";
	return null;
}

/** Clamp the drag offset so the card does not slide off-screen. */
export function clampDragOffset(dx: number, max = 140): number {
	return Math.max(-max, Math.min(max, dx));
}
