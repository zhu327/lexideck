import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// Full-app review flow via the global worker (DEV=1 bypasses auth -> local
// user). addNote a card, see it due, submit a Good review, confirm it leaves
// the due list, then mark the note familiar.
async function anki(action: string, params: unknown = {}) {
	const res = await SELF.fetch("http://localhost/ankiconnect", {
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
		expect(typeof add.result).toBe("number");
		expect(add.result).toBeGreaterThan(0);

		// 2. The card shows up in the due list with Front/Back fields.
		const before = await dueCards();
		const card = before.find((c) => c.fields.Front === "dog");
		expect(card).toBeDefined();
		expect(card?.fields.Back).toBe("犬");
		const cardId = card?.cardId as string;
		const noteId = card?.noteId as string;

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

	it("familiar list shows known state after mark/unmark", async () => {
		// 1. Add a note so we have a card to work with.
		const add = await anki("addNote", {
			note: { deckName: "Default", modelName: "Basic", fields: { Front: "fam-mark", Back: "標" } },
		});
		expect(add.error).toBeNull();

		// 2. Get the UUID noteId from the due list (anki addNote returns numeric id).
		const cards = await dueCards();
		const card = cards.find((c) => c.fields.Front === "fam-mark");
		expect(card).toBeDefined();
		const noteId = card?.noteId;

		// 3. Mark the note familiar.
		const mark = await SELF.fetch("http://localhost/api/review/familiar", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ noteId }),
		});
		expect(mark.status).toBe(200);
		expect(await mark.json()).toEqual({ ok: true });

		// 4. GET /familiar shows the note with known: true.
		const famList = await SELF.fetch("http://localhost/api/review/familiar");
		expect(famList.status).toBe(200);
		const famBody = (await famList.json()) as {
			cards: Array<{ noteId: string; front: string; known: boolean }>;
		};
		const famCard = famBody.cards.find((c) => c.noteId === noteId);
		expect(famCard).toBeDefined();
		expect(famCard?.known).toBe(true);

		// 5. Unmark the note.
		const unmark = await SELF.fetch("http://localhost/api/review/familiar/unmark", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ noteId }),
		});
		expect(unmark.status).toBe(200);
		expect(await unmark.json()).toEqual({ ok: true });

		// 6. GET /familiar now shows the note with known: false.
		const famList2 = await SELF.fetch("http://localhost/api/review/familiar");
		expect(famList2.status).toBe(200);
		const famBody2 = (await famList2.json()) as {
			cards: Array<{ noteId: string; front: string; known: boolean }>;
		};
		const famCard2 = famBody2.cards.find((c) => c.noteId === noteId);
		expect(famCard2).toBeDefined();
		expect(famCard2?.known).toBe(false);
	});

	it("due offset pagination", async () => {
		// 1. Seed 4 notes so we have a pool to paginate over.
		for (let i = 0; i < 4; i++) {
			const add = await anki("addNote", {
				note: {
					deckName: "Default",
					modelName: "Basic",
					fields: { Front: `pg-${i}`, Back: `b-${i}` },
				},
			});
			expect(add.error).toBeNull();
		}

		// 2. First page: limit=2 offset=0.
		const p1 = await SELF.fetch("http://localhost/api/review/due?limit=2&offset=0");
		expect(p1.status).toBe(200);
		const b1 = (await p1.json()) as { cards: Array<{ cardId: string }> };
		expect(b1.cards.length).toBeLessThanOrEqual(2);
		expect(b1.cards.length).toBeGreaterThan(0);

		// 3. Second page: limit=2 offset=2.
		const p2 = await SELF.fetch("http://localhost/api/review/due?limit=2&offset=2");
		expect(p2.status).toBe(200);
		const b2 = (await p2.json()) as { cards: Array<{ cardId: string }> };
		expect(b2.cards.length).toBeGreaterThan(0);

		// 4. Pages must not overlap.
		const ids1 = b1.cards.map((c) => c.cardId);
		const ids2 = b2.cards.map((c) => c.cardId);
		for (const id of ids1) {
			expect(ids2).not.toContain(id);
		}
	});
});
