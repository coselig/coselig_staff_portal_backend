/**
 * Cloudflare Worker - 完整登入 + Session 範例
 */

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			...corsHeaders(),
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

export default {
	async fetch(request, env) {

		// 1️⃣ CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(),
			});
		}

		const url = new URL(request.url);

		try {
			// 2️⃣ 健康檢查
			if (url.pathname === "/api/health") {
				return jsonResponse({
					ok: true,
					message: "Worker is alive",
				});
			}

			// 3️⃣ 登入 API
			if (url.pathname === "/api/login" && request.method === "POST") {
				const body = await request.json().catch(() => null);
				if (!body?.username || !body?.password) {
					return jsonResponse({ error: "Missing fields" }, 400);
				}

				const { username, password } = body;

				const user = await env.DB
					.prepare("SELECT id, username, password FROM users WHERE username = ?")
					.bind(username)
					.first();

				if (!user || user.password !== password) {
					return jsonResponse({ error: "Invalid credentials" }, 401);
				}

				// 生成 session
				const sessionId = generateSessionId();
				const expires = new Date(Date.now() + 3600 * 1000).toISOString();

				await env.DB
					.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
					.bind(sessionId, user.id, expires)
					.run();

				return new Response(JSON.stringify({ ok: true, user: { id: user.id, username: user.username } }), {
					status: 200,
					headers: {
						...corsHeaders(),
						"Content-Type": "application/json",
						"Set-Cookie": setCookie("session_id", sessionId, 3600),
					},
				});
			}

			// 4️⃣ 取得當前使用者
			if (url.pathname === "/api/me" && request.method === "GET") {
				const cookie = request.headers.get("Cookie") || "";
				const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
				if (!match) return jsonResponse({ error: "Not logged in" }, 401);

				const sessionId = match[1];
				const session = await env.DB
					.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
					.bind(sessionId)
					.first();

				if (!session || new Date(session.expires_at) < new Date()) {
					return jsonResponse({ error: "Session expired" }, 401);
				}

				const user = await env.DB
					.prepare("SELECT id, username FROM users WHERE id = ?")
					.bind(session.user_id)
					.first();

				return jsonResponse({ ok: true, user });
			}

			// 5️⃣ 登出
			if (url.pathname === "/api/logout" && request.method === "POST") {
				const cookie = request.headers.get("Cookie") || "";
				const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
				if (match) {
					const sessionId = match[1];
					await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
				}

				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: {
						...corsHeaders(),
						"Content-Type": "application/json",
						"Set-Cookie": "session_id=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
					},
				});
			}


			// 註冊新帳號
			if (url.pathname === "/api/register" && request.method === "POST") {
				const body = await request.json().catch(() => null);
				if (!body?.username || !body?.password) {
					return jsonResponse({ error: "Missing fields" }, 400);
				}

				const { username, password } = body;

				// 檢查帳號是否已存在
				const existing = await env.DB
					.prepare("SELECT id FROM users WHERE username = ?")
					.bind(username)
					.first();

				if (existing) {
					return jsonResponse({ error: "Username already exists" }, 409);
				}

				// ⭐ 暫時明文密碼，之後可改 bcrypt
				const result = await env.DB
					.prepare("INSERT INTO users (username, password) VALUES (?, ?)")
					.bind(username, password)
					.run();

				return jsonResponse({
					ok: true,
					user: { id: result.lastInsertRowid, username },
				}, 201);
			}


			// 6️⃣ 找不到路由
			return jsonResponse({ error: "Not Found" }, 404);

		} catch (err) {
			return jsonResponse({ error: "Internal Server Error", detail: err?.message ?? String(err) }, 500);
		}
	},
};
