import { jsonResponse } from './utils.js';

export async function handleManualPunch(request, env) {
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

	const body = await request.json().catch(() => null);
	if (!body?.employee_id || !body?.date || !body?.periods) {
		return jsonResponse({ error: "Missing fields" }, 400, request);
	}
	const { employee_id, date, periods } = body;

	// 為每個 period 更新或插入記錄
	for (const [period, times] of Object.entries(periods)) {
		let checkIn = times.check_in;
		let checkOut = times.check_out;

		// 將 HH:mm 轉為完整的 datetime
		if (checkIn) {
			checkIn = `${date} ${checkIn}:00`;
		}
		if (checkOut) {
			checkOut = `${date} ${checkOut}:00`;
		}

		// 檢查是否已有記錄
		const existing = await env.DB
			.prepare("SELECT id FROM attendance WHERE user_id = ? AND work_date = ? AND period = ?")
			.bind(employee_id, date, period)
			.first();

		if (existing) {
			// 更新
			await env.DB
				.prepare(`
					UPDATE attendance
					SET check_in_time = ?, check_out_time = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
					WHERE user_id = ? AND work_date = ? AND period = ?
				`)
				.bind(checkIn, checkOut, employee_id, date, period)
				.run();
		} else {
			// 插入
			await env.DB
				.prepare(`
					INSERT INTO attendance (user_id, work_date, period, check_in_time, check_out_time)
					VALUES (?, ?, ?, ?, ?)
				`)
				.bind(employee_id, date, period, checkIn, checkOut)
				.run();
		}
	}

	return jsonResponse({ message: '補打卡成功' }, 200, request);
}

export async function checkIn(request, env) {
	try {
		const body = await request.json().catch(() => null);
		const user_id = body?.user_id;
		const period = body?.period || 'period1';
		if (!user_id) {
			return jsonResponse({ error: '缺少 user_id' }, 400, request);
		}
		// 修正：使用 UTC+8 時區計算今天的日期
		const now = new Date();
		const taipeiTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
		const today = taipeiTime.toISOString().slice(0, 10);
		// 先查詢今天該 period 是否有紀錄
		const record = await env.DB.prepare(`
			SELECT id FROM attendance WHERE user_id = ? AND work_date = ? AND period = ?
		`).bind(user_id, today, period).first();
		if (record) {
			// 有紀錄就更新 check_in_time
			await env.DB.prepare(`
				UPDATE attendance SET check_in_time = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')), updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
				WHERE user_id = ? AND work_date = ? AND period = ?
			`).bind(user_id, today, period).run();
			return jsonResponse({ message: '補打卡成功（已更新）' });
		} else {
			// 沒有就插入新紀錄
			await env.DB.prepare(`
				INSERT INTO attendance (user_id, work_date, period, check_in_time)
				VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')))
			`).bind(user_id, today, period).run();
			return jsonResponse({ message: '打卡成功' });
		}
	} catch (err) {
		console.error('checkIn error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

export async function checkOut(request, env) {
	try {
		const body = await request.json().catch(() => null);
		const user_id = body?.user_id;
		const period = body?.period || 'period1';
		if (!user_id) {
			return jsonResponse({ error: '缺少 user_id' }, 400, request);
		}
		// 修正：使用 UTC+8 時區計算今天的日期
		const now = new Date();
		const taipeiTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
		const today = taipeiTime.toISOString().slice(0, 10);
		const currentHour = taipeiTime.getHours();

		// 跨日邏輯：如果在凌晨 0-5 點打卡，檢查前一天是否有未完成的打卡記錄
		let targetDate = today;
		let isOvernightCheckOut = false;

		if (currentHour >= 0 && currentHour < 5) {
			// 計算前一天的日期
			const yesterday = new Date(taipeiTime);
			yesterday.setDate(yesterday.getDate() - 1);
			const yesterdayStr = yesterday.toISOString().slice(0, 10);

			// 查詢前一天該 period 是否有未完成的打卡記錄（有上班但沒下班）
			const yesterdayRecord = await env.DB.prepare(`
				SELECT id, check_in_time, check_out_time FROM attendance 
				WHERE user_id = ? AND work_date = ? AND period = ?
			`).bind(user_id, yesterdayStr, period).first();

			// 如果前一天有上班記錄但沒有下班記錄，則視為跨日班次
			if (yesterdayRecord && yesterdayRecord.check_in_time && !yesterdayRecord.check_out_time) {
				targetDate = yesterdayStr;
				isOvernightCheckOut = true;
			}
		}

		// 先查詢目標日期該 period 是否有紀錄
		const record = await env.DB.prepare(`
			SELECT id, check_in_time FROM attendance WHERE user_id = ? AND work_date = ? AND period = ?
		`).bind(user_id, targetDate, period).first();

		if (record) {
			// 有紀錄就更新 check_out_time
			await env.DB.prepare(`
				UPDATE attendance SET check_out_time = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')), updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
				WHERE user_id = ? AND work_date = ? AND period = ?
			`).bind(user_id, targetDate, period).run();

			const message = isOvernightCheckOut ? '跨日下班打卡成功' : '補下班打卡成功（已更新）';
			return jsonResponse({ message }, 200, request);
		} else {
			// 沒有就插入新紀錄（只設 check_out_time）
			await env.DB.prepare(`
				INSERT INTO attendance (user_id, work_date, period, check_out_time)
				VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')))
			`).bind(user_id, targetDate, period).run();
			return jsonResponse({ message: '下班打卡成功' }, 200, request);
		}
	} catch (err) {
		console.error('checkOut error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

export async function getToday(request, env) {
	const userId = new URL(request.url).searchParams.get('user_id');
	// 修正：使用 UTC+8 時區計算今天的日期
	const now = new Date();
	const taipeiTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
	const today = taipeiTime.toISOString().slice(0, 10);
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

export async function getMonth(request, env) {
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

// 更新期間名稱
export async function updatePeriodName(request, env) {
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

	const body = await request.json().catch(() => null);
	if (!body?.oldPeriod || !body?.newPeriod) {
		return jsonResponse({ error: "Missing oldPeriod or newPeriod" }, 400, request);
	}

	const { oldPeriod, newPeriod } = body;

	try {
		// 更新該用戶所有記錄中的期間名稱
		const result = await env.DB
			.prepare("UPDATE attendance SET period = ? WHERE user_id = ? AND period = ?")
			.bind(newPeriod, session.user_id, oldPeriod)
			.run();

		return jsonResponse({
			success: true,
			message: `已更新 ${result.changes} 筆記錄的期間名稱`,
			changes: result.changes
		}, 200, request);
	} catch (error) {
		console.error('更新期間名稱失敗:', error);
		return jsonResponse({ error: "更新失敗" }, 500, request);
	}
}