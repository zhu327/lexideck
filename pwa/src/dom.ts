/** Set `textContent` of the first element matching `selector` within `scope`. */
export function setText(scope: HTMLElement, selector: string, text: string): void {
	const el = scope.querySelector(selector);
	if (el instanceof HTMLElement) el.textContent = text;
}

/** Set `innerHTML` of the first element matching `selector` within `scope`. */
export function setHtml(scope: HTMLElement, selector: string, html: string): void {
	const el = scope.querySelector(selector);
	if (el instanceof HTMLElement) el.innerHTML = html;
}
