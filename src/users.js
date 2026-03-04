// users.js - 用戶資料管理相關的 API 處理函數

import { corsHeaders, jsonResponse } from './utils.js';

// 獲取當前用戶 ID 的輔助函數
async function getCurrentUserId(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) return null;

	const sessionId = match[1];
	const session = await env.DB
		.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
		.bind(sessionId)
		.first();

	if (!session || new Date(session.expires_at) < new Date()) {
		return null;
	}

	return session.user_id;
}

// 獲取用戶角色
async function getUserRole(userId, env) {
	const user = await env.DB
		.prepare("SELECT role FROM users WHERE id = ?")
		.bind(userId)
		.first();
	return user?.role;
}

// 獲取當前用戶資料
export async function handleGetCurrentUser(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const user = await env.DB
			.prepare(`
				SELECT id, name, chinese_name, email, role, job_title, 
				       phone, address, bank_account, is_active, theme_mode,
				       font_size_scale, show_working_staff_card, created_at
				FROM users WHERE id = ?
			`)
			.bind(userId)
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
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	const role = await getUserRole(userId, env);
	if (role !== 'admin') {
		return jsonResponse({ error: "Forbidden: Admin only" }, 403, request);
	}

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
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	const role = await getUserRole(userId, env);
	if (role !== 'admin') {
		return jsonResponse({ error: "Forbidden: Admin only" }, 403, request);
	}

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
export async function handleUpdateCurrentUser(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

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

		values.push(userId);

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
export async function handleUpdateUiPreferences(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

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

		values.push(userId);

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
export async function handleUpdateThemeMode(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const { theme_mode } = await request.json();

		// 驗證 theme_mode 值
		const validModes = ['light', 'dark', 'system'];
		if (!validModes.includes(theme_mode)) {
			return jsonResponse({ error: "Invalid theme mode. Must be 'light', 'dark', or 'system'" }, 400, request);
		}

		await env.DB
			.prepare("UPDATE users SET theme_mode = ? WHERE id = ?")
			.bind(theme_mode, userId)
			.run();

		return jsonResponse({ ok: true, message: "Theme mode updated successfully" }, 200, request);

	} catch (err) {
		console.error('Update theme mode error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}
