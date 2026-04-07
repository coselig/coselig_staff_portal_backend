// users.js - 用戶資料管理相關的 API 處理函數

import { jsonResponse } from './utils.js';

// 獲取當前用戶資料
export async function handleGetCurrentUser(request, env, auth) {
	try {
		const user = await env.DB
			.prepare(`
				SELECT id, name, chinese_name, email, role, job_title, 
				       phone, address, bank_account, is_active, theme_mode,
				       font_size_scale, show_working_staff_card, created_at
				FROM users WHERE id = ?
			`)
			.bind(auth.session.user_id)
			.first();

		if (!user) {
			return jsonResponse({ error: "User not found" }, 404, request);
		}

		return jsonResponse({ user }, 200, request);

	} catch (err) {
		console.error('Get current user error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 獲取所有用戶（僅管理員）
export async function handleGetAllUsers(request, env) {
	try {
		const users = await env.DB
			.prepare(`
				SELECT id, name, chinese_name, email, role, job_title, 
				       phone, address, bank_account, is_active, created_at
				FROM users
				ORDER BY created_at DESC
			`)
			.all();

		return jsonResponse({ users: users.results }, 200, request);

	} catch (err) {
		console.error('Get all users error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 根據 ID 獲取用戶資料（僅管理員）
export async function handleGetUserById(request, env, targetUserId) {
	try {
		const user = await env.DB
			.prepare(`
				SELECT id, name, chinese_name, email, role, job_title, 
				       phone, address, bank_account, is_active, created_at
				FROM users WHERE id = ?
			`)
			.bind(targetUserId)
			.first();

		if (!user) {
			return jsonResponse({ error: "User not found" }, 404, request);
		}

		return jsonResponse({ user }, 200, request);

	} catch (err) {
		console.error('Get user by id error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新當前用戶資料
export async function handleUpdateCurrentUser(request, env, auth) {
	try {
		const body = await request.json().catch(() => null);
		if (!body) {
			return jsonResponse({ error: "Invalid request body" }, 400, request);
		}

		// 允許更新的欄位
		const allowedFields = ['chinese_name', 'job_title', 'phone', 'address', 'bank_account'];
		const updates = [];
		const values = [];

		for (const field of allowedFields) {
			if (body[field] !== undefined) {
				updates.push(`${field} = ?`);
				values.push(body[field]);
			}
		}

		if (updates.length === 0) {
			return jsonResponse({ error: "No valid fields to update" }, 400, request);
		}

		values.push(auth.session.user_id);

		await env.DB
			.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
			.bind(...values)
			.run();

		return jsonResponse({ ok: true, message: "User data updated successfully" }, 200, request);

	} catch (err) {
		console.error('Update current user error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新用戶 UI 偏好設定（字體大小、顯示工作員工卡片）
export async function handleUpdateUiPreferences(request, env, auth) {
	try {
		const body = await request.json().catch(() => null);
		if (!body) {
			return jsonResponse({ error: "Invalid request body" }, 400, request);
		}

		const updates = [];
		const values = [];

		if (body.font_size_scale !== undefined) {
			const scale = parseFloat(body.font_size_scale);
			if (isNaN(scale) || scale < 0.5 || scale > 2.0) {
				return jsonResponse({ error: "font_size_scale must be between 0.5 and 2.0" }, 400, request);
			}
			updates.push('font_size_scale = ?');
			values.push(scale);
		}

		if (body.show_working_staff_card !== undefined) {
			updates.push('show_working_staff_card = ?');
			values.push(body.show_working_staff_card ? 1 : 0);
		}

		if (updates.length === 0) {
			return jsonResponse({ error: "No valid fields to update" }, 400, request);
		}

		values.push(auth.session.user_id);

		await env.DB
			.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
			.bind(...values)
			.run();

		return jsonResponse({ ok: true, message: "UI preferences updated successfully" }, 200, request);

	} catch (err) {
		console.error('Update UI preferences error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新用戶主題模式
export async function handleUpdateThemeMode(request, env, auth) {
	try {
		const { theme_mode } = await request.json();

		// 驗證 theme_mode 值
		const validModes = ['light', 'dark', 'system'];
		if (!validModes.includes(theme_mode)) {
			return jsonResponse({ error: "Invalid theme mode. Must be 'light', 'dark', or 'system'" }, 400, request);
		}

		await env.DB
			.prepare("UPDATE users SET theme_mode = ? WHERE id = ?")
			.bind(theme_mode, auth.session.user_id)
			.run();

		return jsonResponse({ ok: true, message: "Theme mode updated successfully" }, 200, request);

	} catch (err) {
		console.error('Update theme mode error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新用戶角色（僅管理員，不可降低自己）
export async function handleUpdateUserRole(request, env, targetUserId, auth) {
	try {
		const body = await request.json().catch(() => null);
		if (!body?.role) {
			return jsonResponse({ error: "Missing role" }, 400, request);
		}

		const validRoles = ['customer', 'employee', 'admin'];
		if (!validRoles.includes(body.role)) {
			return jsonResponse({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, 400, request);
		}

		// 不允許管理員修改自己的角色
		if (Number(targetUserId) === auth.user.id) {
			return jsonResponse({ error: "Cannot change your own role" }, 403, request);
		}

		const user = await env.DB
			.prepare("SELECT id, role FROM users WHERE id = ?")
			.bind(targetUserId)
			.first();

		if (!user) {
			return jsonResponse({ error: "User not found" }, 404, request);
		}

		await env.DB
			.prepare("UPDATE users SET role = ? WHERE id = ?")
			.bind(body.role, targetUserId)
			.run();

		return jsonResponse({ ok: true, message: `Role updated to '${body.role}'` }, 200, request);

	} catch (err) {
		console.error('Update user role error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 查詢用戶的關聯資料摘要（刪除前預覽，僅管理員）
export async function handleGetUserRelatedData(request, env, targetUserId, auth) {
	try {
		// 不允許管理員查詢自己
		if (Number(targetUserId) === auth.user.id) {
			return jsonResponse({ error: "Cannot query your own account" }, 403, request);
		}

		const user = await env.DB
			.prepare("SELECT id, name, chinese_name, email, role FROM users WHERE id = ?")
			.bind(targetUserId)
			.first();

		if (!user) {
			return jsonResponse({ error: "User not found" }, 404, request);
		}

		// D1 不支援同一請求內的並行查詢，需循序執行
		const attendanceCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM attendance WHERE user_id = ?").bind(targetUserId).first();
		const quoteConfigCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM quote_configurations WHERE user_id = ?").bind(targetUserId).first();
		const quoteConfigAsCustomerCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM quote_configurations WHERE customer_user_id = ?").bind(targetUserId).first();
		const deviceConfigCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM device_configurations WHERE user_id = ?").bind(targetUserId).first();
		const assessmentFormCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM smart_home_assessment_forms WHERE user_id = ?").bind(targetUserId).first();
		const projectCaseCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM project_cases WHERE created_by = ?").bind(targetUserId).first();
		const quoteSnapshotCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM quote_snapshots WHERE created_by = ?").bind(targetUserId).first();
		const sessionCount = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = ?").bind(targetUserId).first();
		const customerRecord = await env.DB.prepare("SELECT id FROM customers WHERE user_id = ?").bind(targetUserId).first();

		return jsonResponse({
			user,
			related: {
				attendance_records: attendanceCount?.cnt ?? 0,
				quote_configurations: quoteConfigCount?.cnt ?? 0,
				quote_as_customer: quoteConfigAsCustomerCount?.cnt ?? 0,
				device_configurations: deviceConfigCount?.cnt ?? 0,
				assessment_forms: assessmentFormCount?.cnt ?? 0,
				project_cases_created: projectCaseCount?.cnt ?? 0,
				quote_snapshots_created: quoteSnapshotCount?.cnt ?? 0,
				active_sessions: sessionCount?.cnt ?? 0,
				has_customer_record: !!customerRecord,
			},
		}, 200, request);

	} catch (err) {
		console.error('Get user related data error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除用戶及其所有關聯資料（僅管理員，不可刪自己）
export async function handleDeleteUser(request, env, targetUserId, auth) {
	try {
		// 不允許管理員刪除自己
		if (Number(targetUserId) === auth.user.id) {
			return jsonResponse({ error: "Cannot delete your own account" }, 403, request);
		}

		const user = await env.DB
			.prepare("SELECT id, role FROM users WHERE id = ?")
			.bind(targetUserId)
			.first();

		if (!user) {
			return jsonResponse({ error: "User not found" }, 404, request);
		}

		// 依序刪除子資料（ON DELETE CASCADE 的資料庫端已處理部分，但明確刪除更安全）
		await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId).run();
		await env.DB.prepare("DELETE FROM attendance WHERE user_id = ?").bind(targetUserId).run();
		await env.DB.prepare("DELETE FROM device_configurations WHERE user_id = ?").bind(targetUserId).run();
		await env.DB.prepare("DELETE FROM smart_home_assessment_forms WHERE user_id = ?").bind(targetUserId).run();
		// quote_configurations: 若此用戶是建立者則刪除；若只是 customer_user_id 則 ON DELETE SET NULL
		await env.DB.prepare("DELETE FROM quote_configurations WHERE user_id = ?").bind(targetUserId).run();
		// project_cases / quote_snapshots: created_by 有 ON DELETE CASCADE，跟著刪；
		// 同時此用戶若是 customers 中對應的客戶，案件 customer_id 有 ON DELETE SET NULL
		await env.DB.prepare("DELETE FROM project_cases WHERE created_by = ?").bind(targetUserId).run();
		await env.DB.prepare("DELETE FROM quote_snapshots WHERE created_by = ?").bind(targetUserId).run();
		// customers 記錄（ON DELETE CASCADE 會跟著 users 刪，但先刪保證順序正確）
		await env.DB.prepare("DELETE FROM customers WHERE user_id = ?").bind(targetUserId).run();
		// 最後刪除用戶本身
		await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId).run();

		return jsonResponse({ ok: true, message: "User and all related data deleted" }, 200, request);

	} catch (err) {
		console.error('Delete user error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

