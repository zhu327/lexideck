export interface Env {
	DB: D1Database;
	CONFIG: KVNamespace;
	MEDIA: R2Bucket;
	CF_ACCESS_TEAM_DOMAIN: string;
	CF_ACCESS_AUD: string;
	LLM_API_KEY?: string;
	LLM_BASE_URL?: string;
	LLM_MODEL?: string;
	DEV?: string;
}
