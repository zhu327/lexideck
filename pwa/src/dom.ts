/** Escape HTML special characters so a string is safe for use in attributes and text content. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Strip executable markup from untrusted HTML (Anki/Yomitan note fields):
 * removes script/iframe/object/embed elements, `on*` event-handler attributes,
 * and `javascript:`/`vbscript:`/`data:text/html` URLs. Best-effort defense in
 * depth — field content is still rendered as rich HTML by design.
 */
export function sanitizeFieldHtml(html: string): string {
	if (!html.includes("<")) return html;
	return (
		html
			// Paired dangerous elements including their content
			.replace(/<\s*(script|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
			// Leftover unclosed/self-closing dangerous tags
			.replace(/<\s*(script|iframe|object|embed)\b[^>]*\/?>/gi, "")
			// Inline event handlers (onclick=..., onerror=..., ...)
			.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
			// Script-protocol URLs in linkable/referenceable attributes
			.replace(
				/\s(?:href|src|xlink:href)\s*=\s*(?:"\s*(?:javascript|vbscript):[^"]*"|'\s*(?:javascript|vbscript):[^']*'|(?:javascript|vbscript):[^\s>]+)/gi,
				"",
			)
			// Inline HTML documents in href/src (data:text/html)
			.replace(
				/\s(?:href|src|xlink:href)\s*=\s*(?:"data:text\/html[^"]*"|'data:text\/html[^']*')/gi,
				"",
			)
	);
}

/** Set `textContent` of the first element matching `selector` within `scope`. */
export function setText(scope: HTMLElement, selector: string, text: string): void {
	const el = scope.querySelector(selector);
	if (el instanceof HTMLElement) el.textContent = text;
}

/**
 * Set sanitized innerHTML of the first element matching `selector` within
 * `scope`. HTML inserted this way is expected to be note-field content and is
 * passed through `sanitizeFieldHtml`.
 */
export function setHtml(scope: HTMLElement, selector: string, html: string): void {
	const el = scope.querySelector(selector);
	if (el instanceof HTMLElement) el.innerHTML = sanitizeFieldHtml(html);
}
