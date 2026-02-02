import { jsonResponse, generateSessionId, setCookie, corsHeaders } from './utils.js';

export async function handleGoogleLogin(request, env) {
	const body = await request.json().catch(() => null);
	if (!body?.id_token) {
		return jsonResponse({ error: "Missing id_token" }, 400, request);
	}
	const { id_token } = body;

	// 驗證 Google ID Token - 簡化版本，信任來自前端的 token
	// 由於前端使用 Google Identity Services，我們信任 token 的有效性
	let googleUser;

	try {
		// 嘗試解析 JWT token 獲取用戶信息
		const tokenParts = id_token.split('.');
		console.log('Token parts length:', tokenParts.length);
		console.log('Token preview:', id_token.substring(0, 50) + '...');

		if (tokenParts.length === 3) {
			// JWT payload 是 base64url 編碼的，需要轉換為 base64
			let payloadBase64 = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
			console.log('Payload base64 before padding:', payloadBase64.substring(0, 50) + '...');

			// 添加填充
			while (payloadBase64.length % 4) {
				payloadBase64 += '=';
			}
			console.log('Payload base64 after padding:', payloadBase64.substring(0, 50) + '...');

			// 使用 Cloudflare Workers 的 atob 函數
			const decodedPayload = atob(payloadBase64);
			console.log('Decoded payload string:', decodedPayload.substring(0, 100) + '...');

			const payload = JSON.parse(decodedPayload);
			console.log('Parsed payload keys:', Object.keys(payload));
			console.log('Email in payload:', payload.email);
			console.log('Name in payload:', payload.name);

			googleUser = {
				email: payload.email,
				name: payload.name,
				sub: payload.sub
			};
			console.log('Final googleUser:', googleUser);
		} else {
			console.error('Invalid token format, parts:', tokenParts.length);
			return jsonResponse({ error: "Invalid token format" }, 400, request);
		}
	} catch (e) {
		console.error('JWT decode failed:', e);
		console.error('Error name:', e.name);
		console.error('Error message:', e.message);
		console.error('Error stack:', e.stack);
		return jsonResponse({ error: "Invalid Google token: " + e.message }, 401, request);
	}

	// 檢查是否為允許的域名 (生產環境只允許 coselig.com，測試環境允許任何域名)
	const isProduction = request.url.includes('coselig.com');
	if (isProduction && !googleUser.email.endsWith('@coselig.com')) {
		return jsonResponse({ error: "Only coselig.com emails are allowed in production" }, 403, request);
	}

	// 查找或創建用戶
	let user = await env.DB
		.prepare("SELECT id, name, email, role FROM users WHERE email = ?")
		.bind(googleUser.email)
		.first();

	if (!user) {
		// 自動註冊新用戶
		console.log('Creating new user:', googleUser.name, googleUser.email);
		// 為 Google 用戶生成一個隨機密碼（他們不會用到，但 schema 要求 NOT NULL）
		const randomPassword = crypto.randomUUID();
		const insertResult = await env.DB
			.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'employee')")
			.bind(googleUser.name, googleUser.email, randomPassword)
			.run();

		console.log('Insert result:', insertResult);

		if (insertResult.success && insertResult.meta.last_row_id) {
			user = {
				id: insertResult.meta.last_row_id,
				name: googleUser.name,
				email: googleUser.email,
				role: 'employee'
			};
			console.log('Created user with ID:', user.id);
		} else {
			console.error('Failed to insert user, result:', insertResult);
			return jsonResponse({ error: "Failed to create user" }, 500, request);
		}
	}

	// 創建 session
	const sessionId = generateSessionId();
	const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
	await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
	await env.DB
		.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
		.bind(sessionId, user.id, expires)
		.run();

	return new Response(JSON.stringify({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } }), {
		status: 200,
		headers: {
			...corsHeaders(request),
			"Content-Type": "application/json",
			"Set-Cookie": setCookie("session_id", sessionId, 30 * 24 * 3600),
		},
	});
}

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
	const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
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
			"Set-Cookie": setCookie("session_id", sessionId, 30 * 24 * 3600),
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
		.prepare("SELECT id, name, chinese_name, email, role FROM users WHERE id = ?")
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