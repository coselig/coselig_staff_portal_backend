import { jsonResponse } from './utils.js';

export async function handleEmployees(request, env) {
	// 獲取所有員工（包括admin身分組）
	const employees = await env.DB
		.prepare("SELECT id, name, chinese_name, email, role, job_title, phone, address, bank_account, is_active FROM users ORDER BY name")
		.all();

	return jsonResponse({ employees: employees.results }, 200, request);
}

export async function handleWorkingStaff(request, env) {
	// 獲取正在工作的員工（有 check_in 但沒有 check_out 的）
	const workingStaff = await env.DB
		.prepare(`
			SELECT DISTINCT a.user_id, u.name, u.chinese_name, MIN(a.check_in_time) as check_in_time
			FROM attendance a
			JOIN users u ON a.user_id = u.id
			WHERE a.work_date = date('now', '+8 hours')
			AND a.check_in_time IS NOT NULL
			AND a.check_out_time IS NULL
			GROUP BY a.user_id, u.name, u.chinese_name
			ORDER BY u.name
		`)
		.all();

	return jsonResponse({ working_staff: workingStaff.results }, 200, request);
}
