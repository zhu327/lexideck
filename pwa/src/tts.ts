// Minimal Web Speech API type declarations (not in workers-types)
interface SpeechSynthesisLike {
	cancel(): void;
	speak(utterance: SpeechSynthesisUtteranceLike): void;
}
interface SpeechSynthesisUtteranceLike {
	text: string;
	lang: string;
}
type SpeechSynthesisCtor = new (text: string) => SpeechSynthesisUtteranceLike;

function getSpeechSynthesis(): SpeechSynthesisLike | null {
	const g = globalThis as Record<string, unknown>;
	return (g.speechSynthesis as SpeechSynthesisLike) ?? null;
}

function getUtteranceCtor(): SpeechSynthesisCtor | null {
	const g = globalThis as Record<string, unknown>;
	return (g.SpeechSynthesisUtterance as SpeechSynthesisCtor) ?? null;
}

/**
 * Speak text via Web Speech API. No-op if not supported.
 */
export function speak(text: string, lang = "en"): void {
	const synth = getSpeechSynthesis();
	const Ctor = getUtteranceCtor();
	if (!synth || !Ctor) return;
	synth.cancel();
	const utterance = new Ctor(text);
	utterance.lang = lang;
	synth.speak(utterance);
}

/**
 * Stop any ongoing speech.
 */
export function stopSpeaking(): void {
	const synth = getSpeechSynthesis();
	if (!synth) return;
	synth.cancel();
}

/* ── Auto-pronounce preference ────────────────────────── */

const AUTO_SPEAK_KEY = "tts-auto-speak";

/**
 * Whether flipping a card should pronounce the word automatically.
 * Defaults to on; the header toggle persists the choice per device.
 */
export function isAutoSpeakEnabled(): boolean {
	if (typeof localStorage === "undefined") return true;
	return localStorage.getItem(AUTO_SPEAK_KEY) !== "off";
}

export function setAutoSpeakEnabled(enabled: boolean): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(AUTO_SPEAK_KEY, enabled ? "on" : "off");
	} catch {
		// Private mode / storage full — the in-memory toggle still applies via UI.
	}
}

/** Speak only when auto-pronounce is enabled. Returns whether it spoke. */
export function speakIfEnabled(text: string, lang = "en"): boolean {
	if (!isAutoSpeakEnabled()) return false;
	speak(text, lang);
	return true;
}
