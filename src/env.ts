export interface Env {
	DB: D1Database;
	LLM_API_KEY?: string;
	LLM_BASE_URL?: string;
	LLM_MODEL?: string;
	ANKICONNECT_API_KEY?: string;
	NEW_CARDS_PER_DAY?: string;
	REVIEWS_PER_DAY?: string;
	TIMEZONE?: string;
	DEV?: string;
}
