import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Worker routes', () => {
	it('returns health status for /api/health (unit style)', async () => {
		const request = new Request('http://example.com/api/health');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchInlineSnapshot(`
			{
			  "message": "Worker is alive",
			  "ok": true,
			}
		`);
	});

	it('requires login for /api/me (integration style)', async () => {
		const response = await SELF.fetch('http://example.com/api/me');
		expect(response.status).toBe(401);
		expect(await response.text()).toMatchInlineSnapshot(`"{"error":"Not logged in"}"`);
	});

	it('returns not found for unknown routes (integration style)', async () => {
		const response = await SELF.fetch('http://example.com/does-not-exist');
		expect(response.status).toBe(404);
		expect(await response.text()).toMatchInlineSnapshot(`"{"error":"Not Found"}"`);
	});
});
