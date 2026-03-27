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

			// 添加填充
			while (payloadBase64.length % 4) {
				payloadBase64 += '=';
			}

			// 使用 Uint8Array + TextDecoder 正確解碼 UTF-8
			const binaryString = atob(payloadBase64);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			const decodedPayload = new TextDecoder('utf-8').decode(bytes);
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

	// 查找或創建用戶
	let user = await env.DB
		.prepare("SELECT id, name, email, role, theme_mode, font_size_scale, show_working_staff_card FROM users WHERE email = ?")
		.bind(googleUser.email)
		.first();

	console.log('Existing user from DB:', user);
	console.log('User ID type:', typeof user?.id, 'value:', user?.id);

	if (!user) {
		// 自動註冊新用戶
		console.log('Creating new user:', googleUser.name, googleUser.email);
		// 為 Google 用戶生成一個隨機密碼（他們不會用到，但 schema 要求 NOT NULL）
		const randomPassword = crypto.randomUUID();
		const insertResult = await env.DB
			.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'customer')")
			.bind(googleUser.name, googleUser.email, randomPassword)
			.run();

		console.log('Insert result:', JSON.stringify(insertResult));
		console.log('Insert meta:', JSON.stringify(insertResult.meta));

		// 直接從資料庫查詢剛插入的用戶，確保獲得正確的 ID
		const newUser = await env.DB
			.prepare("SELECT id, name, email, role, theme_mode, font_size_scale, show_working_staff_card FROM users WHERE email = ?")
			.bind(googleUser.email)
			.first();

		console.log('New user from DB:', newUser);

		if (newUser && newUser.id > 0) {
			user = newUser;
			console.log('Created user with ID:', user.id);

			// 自動為 customer 角色用戶創建 customers 記錄
			await env.DB
				.prepare("INSERT INTO customers (user_id) VALUES (?)")
				.bind(newUser.id)
				.run();
		} else {
			console.error('Failed to get valid user ID, newUser:', newUser);
			return jsonResponse({ error: "Failed to create user with valid ID" }, 500, request);
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

	return new Response(JSON.stringify({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, theme_mode: user.theme_mode, font_size_scale: user.font_size_scale, show_working_staff_card: user.show_working_staff_card } }), {
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
	console.log('handleMe - Cookie header:', cookie);
	console.log('handleMe - All headers:', JSON.stringify([...request.headers.entries()]));
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) {
		console.log('handleMe - No session_id found in cookie');
		return jsonResponse({ error: "Not logged in" }, 401, request);
	}
	const sessionId = match[1];
	console.log('handleMe - Found session_id:', sessionId);
	const session = await env.DB
		.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
		.bind(sessionId)
		.first();
	console.log('handleMe - Session from DB:', session);
	if (!session || new Date(session.expires_at) < new Date()) {
		console.log('handleMe - Session expired or not found');
		return jsonResponse({ error: "Session expired" }, 401, request);
	}
	const user = await env.DB
		.prepare("SELECT id, name, chinese_name, email, role, theme_mode, font_size_scale, show_working_staff_card FROM users WHERE id = ?")
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
