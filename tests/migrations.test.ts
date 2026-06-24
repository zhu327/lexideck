import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
	it("creates all expected tables", async () => {
		const result = await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' " +
				"AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name",
		).all<{ name: string }>();

		const names = (result.results ?? []).map((row) => row.name);
		expect(names).toEqual(
			expect.arrayContaining(["cards", "decks", "enrichments", "models", "notes", "revlog"]),
		);
	});

	it("seeds the Default deck for user local", async () => {
		const deck = await env.DB.prepare(
			"SELECT id, name, user_id FROM decks WHERE user_id = 'local' AND name = 'Default'",
		).first<{ id: string; name: string; user_id: string }>();

		expect(deck).not.toBeNull();
		expect(deck?.id).toBe("deck-default-local");
		expect(deck?.name).toBe("Default");
	});

	it("seeds the Basic model with Front/Back fields and one template", async () => {
		const model = await env.DB.prepare(
			"SELECT id, name, field_names, templates, css, user_id FROM models " +
				"WHERE user_id = 'local' AND name = 'Basic'",
		).first<{
			id: string;
			name: string;
			field_names: string;
			templates: string;
			css: string;
			user_id: string;
		}>();

		expect(model).not.toBeNull();
		expect(model?.id).toBe("model-basic-local");
		expect(JSON.parse(model?.field_names ?? "[]")).toEqual(["Front", "Back"]);
		expect(JSON.parse(model?.templates ?? "{}")).toEqual({
			"Card 1": { Front: "{{Front}}", Back: "{{Back}}" },
		});
		expect(model?.css).toBe("");
	});
});
