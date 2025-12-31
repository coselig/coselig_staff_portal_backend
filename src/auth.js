import { jsonResponse, generateSessionId, setCookie, corsHeaders } from './utils.js';

export async function handleLogin(request, env) {
	const body = await request.json().catch(() => null);
	if ((!body?.email && !body?.name) || !body?.password) {
		return jsonResponse({ error: "Missing fields" }, 400, request);
	}
	const { email, name, password } = body;
	let user;
	if (email) {
		user = await env.DB
			.prepare("SELECT id, name, email, password, role FROM users WHERE email = ?")
			.bind(email)
			.first();
	} else if (name) {
		user = await env.DB
			.prepare("SELECT id, name, email, password, role FROM users WHERE name = ?")
			.bind(name)
			.first();
	}
	if (!user) {
		return jsonResponse({ error: "User not found" }, 401, request);
	}
	if (user.password !== password) {
		return jsonResponse({ error: "Wrong password" }, 401, request);
	}
	const sessionId = generateSessionId();
	const expires = new Date(Date.now() + 3600 * 1000).toISOString();
	// 先移除該 user 的所有舊 session
	await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
	// 再新增新 session
	await env.DB
		.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
		.bind(sessionId, user.id, expires)
		.run();
	return new Response(JSON.stringify({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } }), {
		status: 200,
		headers: {
			...corsHeaders(request),
			"Content-Type": "application/json",
			"Set-Cookie": setCookie("session_id", sessionId, 3600),
		},
	});
}

export async function handleMe(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) return jsonResponse({ error: "Not logged in" }, 401, request);
	const sessionId = match[1];
	const session = await env.DB
		.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
		.bind(sessionId)
		.first();
	if (!session || new Date(session.expires_at) < new Date()) {
		return jsonResponse({ error: "Session expired" }, 401, request);
	}
	const user = await env.DB
		.prepare("SELECT id, name, email, role FROM users WHERE id = ?")
		.bind(session.user_id)
		.first();
	// 確保 user 物件有 id 欄位
	if (user && !('id' in user)) {
		user.id = session.user_id;
	}
	return jsonResponse({ ok: true, user }, 200, request);
}

export async function handleLogout(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) return jsonResponse({ error: "Not logged in" }, 401, request);
	const sessionId = match[1];
	await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			...corsHeaders(request),
			"Content-Type": "application/json",
			"Set-Cookie": setCookie("session_id", "", 0),
		},
	});
}

export async function handleRegister(request, env) {
	const body = await request.json().catch(() => null);
	if (!body?.name || !body?.email || !body?.password) {
		return jsonResponse({ error: "Missing fields" }, 400, request);
	}
	const { name, email, password } = body;

	// 檢查 email 是否已存在
	const existingUser = await env.DB
		.prepare("SELECT id FROM users WHERE email = ?")
		.bind(email)
		.first();
	if (existingUser) {
		return jsonResponse({ error: "Email already exists" }, 409, request);
	}

	// 新增用戶
	const result = await env.DB
		.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'employee')")
		.bind(name, email, password)
		.run();

	if (result.success) {
		return jsonResponse({ ok: true, message: "User registered successfully" }, 201, request);
	} else {
		return jsonResponse({ error: "Failed to register user" }, 500, request);
	}
}