/**
 * Cloudflare Worker - 完整登入 + Session 範例
 */

function corsHeaders(request) {
	const origin = request.headers.get("Origin");
	return {
		"Access-Control-Allow-Origin": origin ?? "",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Allow-Credentials": "true",
	};
}

function jsonResponse(data, status = 200, request) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			...corsHeaders(request),
			"Content-Type": "application/json",
		},
	});
}
function generateSessionId() {
	return crypto.randomUUID();
}

function setCookie(name, value, maxAge = 3600) {
	return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}

// Handler functions
async function handleHealth(request, env) {
	return jsonResponse({ ok: true, message: "Worker is alive" }, 200, request);
}

async function handleLogin(request, env) {
	const body = await request.json().catch(() => null);
	if (!body?.email || !body?.password) {
		return jsonResponse({ error: "Missing fields" }, 400, request);
	}
	const { email, password } = body;
	const user = await env.DB
		.prepare("SELECT id, name, email, password, role FROM users WHERE email = ?")
		.bind(email)
		.first();
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

async function handleMe(request, env) {
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
	return jsonResponse({ ok: true, user }, 200, request);
}

async function handleLogout(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (match) {
		const sessionId = match[1];
		await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
	}
	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: {
			...corsHeaders(request),
			"Content-Type": "application/json",
			"Set-Cookie": "session_id=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
		},
	});
}

async function handleRegister(request, env) {
	const body = await request.json().catch(() => null);
	if (!body?.name || !body?.email || !body?.password || !body?.role) {
		return jsonResponse({ error: "Missing fields" }, 400, request);
	}
	const { name, email, password, role } = body;
	const existing = await env.DB
		.prepare("SELECT id FROM users WHERE email = ?")
		.bind(email)
		.first();
	if (existing) {
		return jsonResponse({ error: "Email already exists" }, 409, request);
	}
	const result = await env.DB
		.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)")
		.bind(name, email, password, role)
		.run();
	return jsonResponse({
		ok: true,
		user: { id: result.lastInsertRowid, name, email, role },
	}, 201, request);
}

async function checkIn(request, env) {
	const { user_id } = await request.json();
	const today = new Date().toISOString().slice(0, 10);
	// 先查詢今天是否有紀錄
	const record = await env.DB.prepare(`
		SELECT id FROM attendance WHERE user_id = ? AND work_date = ?
	`).bind(user_id, today).first();
	if (record) {
		// 有紀錄就更新 check_in_time
		await env.DB.prepare(`
			UPDATE attendance SET check_in_time = datetime('now'), updated_at = CURRENT_TIMESTAMP
			WHERE user_id = ? AND work_date = ?
		`).bind(user_id, today).run();
		return jsonResponse({ message: '補打卡成功（已更新）' });
	} else {
		// 沒有就插入新紀錄
		await env.DB.prepare(`
			INSERT INTO attendance (user_id, work_date, check_in_time)
			VALUES (?, ?, datetime('now'))
		`).bind(user_id, today).run();
		return jsonResponse({ message: '打卡成功' });
	}
}

async function checkOut(request, env) {
	const { user_id } = await request.json();
	const today = new Date().toISOString().slice(0, 10);
	// 先查詢今天是否有紀錄
	const record = await env.DB.prepare(`
		SELECT id FROM attendance WHERE user_id = ? AND work_date = ?
	`).bind(user_id, today).first();
	if (record) {
		// 有紀錄就更新 check_out_time
		await env.DB.prepare(`
			UPDATE attendance SET check_out_time = datetime('now'), updated_at = CURRENT_TIMESTAMP
			WHERE user_id = ? AND work_date = ?
		`).bind(user_id, today).run();
		return jsonResponse({ message: '補下班打卡成功（已更新）' });
	} else {
		// 沒有就插入新紀錄（只設 check_out_time）
		await env.DB.prepare(`
			INSERT INTO attendance (user_id, work_date, check_out_time)
			VALUES (?, ?, datetime('now'))
		`).bind(user_id, today).run();
		return jsonResponse({ message: '下班打卡成功' });
	}
}

async function getToday(request, env) {
	const userId = new URL(request.url).searchParams.get('user_id');
	const today = new Date().toISOString().slice(0, 10);
	const record = await env.DB.prepare(`
        SELECT check_in_time, check_out_time
        FROM attendance
        WHERE user_id = ? AND work_date = ?
    `).bind(userId, today).first();
	return jsonResponse(record ?? {}, 200, request);
}

// 路由表
const routes = {
	GET: {
		"/api/health": handleHealth,
		"/api/me": handleMe,
	},
	POST: {
		"/api/login": handleLogin,
		"/api/logout": handleLogout,
		"/api/register": handleRegister,
	},
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(request),
			});
		}
		if (request.method === 'POST' && url.pathname === '/api/attendance/check-in') {
			return checkIn(request, env);
		}
		if (request.method === 'POST' && url.pathname === '/api/attendance/check-out') {
			return checkOut(request, env);
		}
		if (request.method === 'GET' && url.pathname === '/api/attendance/today') {
			return getToday(request, env);
		}
		try {
			const methodRoutes = routes[request.method];
			const handler = methodRoutes && methodRoutes[url.pathname];
			if (handler) {
				return await handler(request, env);
			}
			return jsonResponse({ error: "Not Found" }, 404, request);
		} catch (err) {
			return jsonResponse({ error: "Internal Server Error", detail: err?.message ?? String(err) }, 500, request);
		}
	},
};