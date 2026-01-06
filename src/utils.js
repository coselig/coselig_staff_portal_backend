/**
 * Utility functions for Cloudflare Worker
 */

export function corsHeaders(request) {
	// 允許的來源列表
	const allowedOrigins = [
		"https://staff.coselig.com",
		"https://staff-portal.coseligtest.workers.dev",
	];

	let origin = request.headers.get("Origin");
	if (!origin || origin === "*" || !allowedOrigins.includes(origin)) {
		origin = allowedOrigins[0];  // 預設使用第一個允許的來源
	}
	return {
		"Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Allow-Credentials": "true",
	};
}

export function jsonResponse(data, status = 200, request) {
	// 保證 request 不為 undefined
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			...corsHeaders(request),
			"Content-Type": "application/json",
		},
	});
}

export function generateSessionId() {
	return crypto.randomUUID();
}

export function setCookie(name, value, maxAge = 3600) {
	return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}