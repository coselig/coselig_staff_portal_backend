/**
 * Cloudflare Worker - 完整登入 + Session 範例
 */

function corsHeaders(request) {
	// 防呆：request 為 undefined 時允許所有來源
	let origin = request.headers.get("Origin");
	if (!origin || origin === "*") {
		origin = "https://staff-portal.coseligtest.workers.dev";
	}
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Allow-Credentials": "true",
	};
}

function jsonResponse(data, status = 200, request) {
	// 保證 request 不為 undefined
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
	// 確保 user 物件有 id 欄位
	if (user && !('id' in user)) {
		user.id = session.user_id;
	}
	return jsonResponse({ ok: true, user }, 200, request);
}

async function handleEmployees(request, env) {
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

	// 檢查用戶是否為管理員
	const user = await env.DB
		.prepare("SELECT role FROM users WHERE id = ?")
		.bind(session.user_id)
		.first();
	if (!user || user.role !== 'admin') {
		return jsonResponse({ error: "Access denied. Admin only." }, 403, request);
	}

	// 獲取所有員工
	const employees = await env.DB
		.prepare("SELECT id, name, email, role FROM users WHERE role = 'employee' ORDER BY name")
		.all();

	return jsonResponse({ employees: employees.results }, 200, request);
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
	try {
		const body = await request.json().catch(() => null);
		const user_id = body?.user_id;
		const period = body?.period || 'period1';
		if (!user_id) {
			return jsonResponse({ error: '缺少 user_id' }, 400, request);
		}
		const today = new Date().toISOString().slice(0, 10);
		// 先查詢今天該 period 是否有紀錄
		const record = await env.DB.prepare(`
			SELECT id FROM attendance WHERE user_id = ? AND work_date = ? AND period = ?
		`).bind(user_id, today, period).first();
		if (record) {
			// 有紀錄就更新 check_in_time
			await env.DB.prepare(`
				UPDATE attendance SET check_in_time = strftime('%Y-%m-%d %H:%M:%S', datetime('now')), updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now'))
				WHERE user_id = ? AND work_date = ? AND period = ?
			`).bind(user_id, today, period).run();
			return jsonResponse({ message: '補打卡成功（已更新）' });
		} else {
			// 沒有就插入新紀錄
			await env.DB.prepare(`
				INSERT INTO attendance (user_id, work_date, period, check_in_time)
				VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S', datetime('now')))
			`).bind(user_id, today, period).run();
			return jsonResponse({ message: '打卡成功' });
		}
	} catch (err) {
		console.error('checkIn error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

async function checkOut(request, env) {
	try {
		const body = await request.json().catch(() => null);
		const user_id = body?.user_id;
		const period = body?.period || 'period1';
		if (!user_id) {
			return jsonResponse({ error: '缺少 user_id' }, 400, request);
		}
		const today = new Date().toISOString().slice(0, 10);
		// 先查詢今天該 period 是否有紀錄
		const record = await env.DB.prepare(`
			SELECT id FROM attendance WHERE user_id = ? AND work_date = ? AND period = ?
		`).bind(user_id, today, period).first();
		if (record) {
			// 有紀錄就更新 check_out_time
			await env.DB.prepare(`
				UPDATE attendance SET check_out_time = strftime('%Y-%m-%d %H:%M:%S', datetime('now')), updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now'))
				WHERE user_id = ? AND work_date = ? AND period = ?
			`).bind(user_id, today, period).run();
			return jsonResponse({ message: '補下班打卡成功（已更新）' }, 200, request);
		} else {
			// 沒有就插入新紀錄（只設 check_out_time）
			await env.DB.prepare(`
				INSERT INTO attendance (user_id, work_date, period, check_out_time)
				VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S', datetime('now')))
			`).bind(user_id, today, period).run();
			return jsonResponse({ message: '下班打卡成功' }, 200, request);
		}
	} catch (err) {
		console.error('checkOut error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

async function getToday(request, env) {
	const userId = new URL(request.url).searchParams.get('user_id');
	const today = new Date().toISOString().slice(0, 10);
	const records = await env.DB.prepare(`
        SELECT period, check_in_time, check_out_time
        FROM attendance
        WHERE user_id = ? AND work_date = ?
    `).bind(userId, today).all();
	const result = {};
	for (const record of records.results) {
		const period = record.period || 'period1';
		result[`${period}_check_in_time`] = record.check_in_time;
		result[`${period}_check_out_time`] = record.check_out_time;
	}
	return jsonResponse(result, 200, request);
}

async function getMonth(request, env) {
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

	const url = new URL(request.url);
	const requestedUserId = url.searchParams.get('user_id');

	// 檢查權限：只有管理員可以查看其他員工的記錄
	if (requestedUserId !== session.user_id.toString()) {
		const currentUser = await env.DB
			.prepare("SELECT role FROM users WHERE id = ?")
			.bind(session.user_id)
			.first();
		if (!currentUser || currentUser.role !== 'admin') {
			return jsonResponse({ error: "Access denied. Can only view own records." }, 403, request);
		}
	}

	const year = parseInt(url.searchParams.get('year'));
	const month = parseInt(url.searchParams.get('month'));
	const startDate = new Date(year, month - 1, 1).toISOString().slice(0, 10);
	const endDate = new Date(year, month, 1).toISOString().slice(0, 10);
	const records = await env.DB.prepare(`
        SELECT work_date, period, check_in_time, check_out_time
        FROM attendance
        WHERE user_id = ? AND work_date >= ? AND work_date < ?
        ORDER BY work_date, period
    `).bind(requestedUserId, startDate, endDate).all();
	const dayMap = {};
	for (const record of records.results) {
		const date = new Date(record.work_date);
		const day = date.getDate();
		const period = record.period || 'period1';
		if (!dayMap[day]) {
			dayMap[day] = {};
		}
		dayMap[day][`${period}_check_in_time`] = record.check_in_time;
		dayMap[day][`${period}_check_out_time`] = record.check_out_time;
	}
	const formattedRecords = Object.keys(dayMap).map(day => ({
		day: parseInt(day),
		...dayMap[day]
	}));
	return jsonResponse({ records: formattedRecords }, 200, request);
}

// 路由表
const routes = {
	GET: {
		"/api/health": handleHealth,
		"/api/me": handleMe,
		"/api/employees": handleEmployees,
		"/api/attendance/month": getMonth,
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