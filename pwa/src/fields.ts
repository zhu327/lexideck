/**
 * Render card fields as structured HTML.
 * @param fields - The card's field map (e.g., {Front: "dog", Back: "犬"})
 * @param frontKey - The first field name to use as the front side
 * @returns HTML string for the back side, with each field as a labeled block
 */
export function renderFields(fields: Record<string, string>, frontKey: string): string {
	const entries = Object.entries(fields);
	const backFields = entries.filter(([key]) => key !== frontKey);

	return backFields
		.map(
			([key, value]) => `
    <div class="field-block">
      <span class="field-label">${escapeHtml(key)}</span>
      <div class="field-value">${value}</div>
    </div>
  `,
		)
		.join("");
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
