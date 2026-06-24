import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Full-app review flow via the global worker (DEV=1 bypasses auth -> local
// user). addNote a card, see it due, submit a Good review, confirm it leaves
// the due list, then mark the note familiar.
async function anki(action: string, params: unknown = {}) {
	const res = await SELF.fetch("http://localhost/", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ action, version: 6, params }),
	});
	return (await res.json()) as { result: unknown; error: string | null };
}

interface DueCard {
	cardId: string;
	noteId: string;
	fields: Record<string, string>;
}

async function dueCards(limit = 20): Promise<DueCard[]> {
	const res = await SELF.fetch(`http://localhost/api/review/due?limit=${limit}`);
	expect(res.status).toBe(200);
	const body = (await res.json()) as { cards: DueCard[] };
	return body.cards;
}

describe("review flow (full app)", () => {
	it("addNote -> due -> submit -> due (gone) -> familiar", async () => {
		// 1. Add a Basic note (creates a New card due now).
		const add = await anki("addNote", {
			note: { deckName: "Default", modelName: "Basic", fields: { Front: "dog", Back: "犬" } },
		});
		expect(add.error).toBeNull();
		expect(typeof add.result).toBe("string");
		const noteId = add.result as string;

		// 2. The card shows up in the due list with Front/Back fields.
		const before = await dueCards();
		const card = before.find((c) => c.noteId === noteId && c.fields.Front === "dog");
		expect(card).toBeDefined();
		expect(card?.fields.Back).toBe("犬");
		const cardId = card?.cardId as string;

		// 3. Submit a Good (rating 3) review -> 200 with a future due.
		const t0 = Date.now();
		const submit = await SELF.fetch("http://localhost/api/review/submit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cardId, rating: 3 }),
		});
		expect(submit.status).toBe(200);
		const submitBody = (await submit.json()) as { due: number };
		expect(submitBody.due).toBeGreaterThan(t0);

		// 4. The card is no longer due.
		const after = await dueCards();
		expect(after.map((c) => c.cardId)).not.toContain(cardId);

		// 5. Mark the note familiar.
		const familiar = await SELF.fetch("http://localhost/api/review/familiar", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ noteId }),
		});
		expect(familiar.status).toBe(200);
		expect(await familiar.json()).toEqual({ ok: true });
	});
});
