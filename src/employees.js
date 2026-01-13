import { jsonResponse } from './utils.js';

export async function handleEmployees(request, env) {
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

	// 獲取所有員工（包括admin身分組）
	const employees = await env.DB
		.prepare("SELECT id, name, email, role FROM users ORDER BY name")
		.all();

	return jsonResponse({ employees: employees.results }, 200, request);
}

export async function handleWorkingStaff(request, env) {
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

	// 獲取正在工作的員工（有 check_in 但沒有 check_out 的）
	const workingStaff = await env.DB
		.prepare(`
			SELECT DISTINCT a.user_id, u.name, MIN(a.check_in_time) as check_in_time
			FROM attendance a
			JOIN users u ON a.user_id = u.id
			WHERE a.work_date = date('now')
			AND a.check_in_time IS NOT NULL
			AND a.check_out_time IS NULL
			GROUP BY a.user_id, u.name
			ORDER BY u.name
		`)
		.all();

	return jsonResponse({ working_staff: workingStaff.results }, 200, request);
}