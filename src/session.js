import { jsonResponse } from './utils.js';

export function extractSessionId(request) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	return match ? match[1] : null;
}

async function loadSession(sessionId, env) {
	const session = await env.DB
		.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
		.bind(sessionId)
		.first();

	if (!session || new Date(session.expires_at) < new Date()) {
		return null;
	}

	return {
		id: sessionId,
		...session,
	};
}

export async function getSession(request, env) {
	const sessionId = extractSessionId(request);
	if (!sessionId) {
		return null;
	}

	return loadSession(sessionId, env);
}

export async function requireSession(request, env) {
	const sessionId = extractSessionId(request);
	if (!sessionId) {
		return { response: jsonResponse({ error: "Not logged in" }, 401, request) };
	}

	const session = await loadSession(sessionId, env);

	if (!session) {
		return { response: jsonResponse({ error: "Session expired" }, 401, request) };
	}

	return {
		session,
	};
}

export async function getCurrentUserId(request, env) {
	const session = await getSession(request, env);
	return session?.user_id ?? null;
}

export async function getUserRole(userId, env) {
	const user = await env.DB
		.prepare("SELECT role FROM users WHERE id = ?")
		.bind(userId)
		.first();

	return user?.role ?? null;
}

export async function requireUser(request, env, fields = "id, role") {
	const auth = await requireSession(request, env);
	if (auth.response) {
		return auth;
	}

	const user = await env.DB
		.prepare(`SELECT ${fields} FROM users WHERE id = ?`)
		.bind(auth.session.user_id)
		.first();

	if (!user) {
		return { response: jsonResponse({ error: "User not found" }, 404, request) };
	}

	return {
		...auth,
		user,
	};
}

export async function requireAdmin(request, env, fields = "id, role") {
	const auth = await requireUser(request, env, fields);
	if (auth.response) {
		return auth;
	}

	if (auth.user.role !== 'admin') {
		return { response: jsonResponse({ error: "Access denied. Admin only." }, 403, request) };
	}

	return auth;
}

export async function requireNonCustomer(request, env, fields = "id, role") {
	const auth = await requireUser(request, env, fields);
	if (auth.response) {
		return auth;
	}

	if (auth.user.role === 'customer') {
		return { response: jsonResponse({ error: "Forbidden" }, 403, request) };
	}

	return auth;
}
