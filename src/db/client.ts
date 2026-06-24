export type SqlBinding = string | number | boolean | null | ArrayBuffer | Uint8Array;

export interface DbClient {
	exec(sql: string, ...params: SqlBinding[]): Promise<D1Result>;
	query<T = Record<string, unknown>>(sql: string, ...params: SqlBinding[]): Promise<T[]>;
	queryFirst<T = Record<string, unknown>>(sql: string, ...params: SqlBinding[]): Promise<T | null>;
}

export function createDbClient(d1: D1Database): DbClient {
	return {
		exec: async (sql: string, ...params: SqlBinding[]) =>
			d1
				.prepare(sql)
				.bind(...params)
				.run(),
		query: async <T = Record<string, unknown>>(sql: string, ...params: SqlBinding[]) => {
			const result = await d1
				.prepare(sql)
				.bind(...params)
				.all<T>();
			return result.results;
		},
		queryFirst: async <T = Record<string, unknown>>(sql: string, ...params: SqlBinding[]) =>
			d1
				.prepare(sql)
				.bind(...params)
				.first<T>(),
	};
}
