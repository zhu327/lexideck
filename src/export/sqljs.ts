// sql.js does not publish TypeScript declarations.
// Use ES module .wasm import (the only WASM loading method Cloudflare Workers supports).
import wasmModule from "./sql-wasm-browser.wasm";

export interface SqlJsStatic {
	Database: new (data?: Uint8Array) => SqlJsDatabase;
}

export interface SqlJsDatabase {
	run(sql: string, params?: unknown[]): void;
	exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
	export(): Uint8Array;
	close(): void;
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
	sqlJsPromise ??= loadAndInitSqlJs();
	return sqlJsPromise;
}

async function loadAndInitSqlJs(): Promise<SqlJsStatic> {
	// Cloudflare Workers has WorkerGlobalScope but no self.location.
	// sql.js browser build checks self.location.href, so we polyfill it before import.
	if (typeof globalThis.self !== "undefined" && !(globalThis.self as any).location) {
		(globalThis.self as any).location = { href: "" };
	}
	// @ts-expect-error - untyped dependency, dynamic import
	const { default: initSqlJs } = await import("sql.js/dist/sql-wasm-browser.js");
	return initSqlJs({
		// Provide a pre-compiled WebAssembly.Module via ES module import.
		// This bypasses WebAssembly.instantiate() which is blocked in
		// Cloudflare Workers local dev (miniflare).
		instantiateWasm(imports: any, receiveInstance: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
			const instance = new WebAssembly.Instance(wasmModule, imports);
			receiveInstance(instance, wasmModule);
			return instance.exports;
		},
	}) as Promise<SqlJsStatic>;
}
