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

/**
 * Check if TTS is available in current browser.
 */
export function isTtsAvailable(): boolean {
	return getSpeechSynthesis() !== null;
}
