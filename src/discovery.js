// discovery.js - 裝置管理相關的 API 處理函數

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

// 保存設備配置
export async function handleSaveConfiguration(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const body = await request.json().catch(() => null);
		if (!body?.name || !body?.devices) {
			return jsonResponse({ error: "Missing required fields: name and devices" }, 400, request);
		}

		const { name, devices } = body;

		// 檢查是否已存在相同名稱的配置
		const existing = await env.DB
			.prepare("SELECT id FROM device_configurations WHERE user_id = ? AND name = ?")
			.bind(userId, name)
			.first();

		if (existing) {
			// 更新現有配置
			await env.DB
				.prepare(`
					UPDATE device_configurations
					SET devices = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
					WHERE user_id = ? AND name = ?
				`)
				.bind(JSON.stringify(devices), userId, name)
				.run();
		} else {
			// 創建新配置
			await env.DB
				.prepare(`
					INSERT INTO device_configurations (user_id, name, devices)
					VALUES (?, ?, ?)
				`)
				.bind(userId, name, JSON.stringify(devices))
				.run();
		}

		return jsonResponse({ ok: true, message: "Configuration saved successfully" }, 200, request);

	} catch (err) {
		console.error('Save configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 加載設備配置
export async function handleLoadConfiguration(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const url = new URL(request.url);
		const name = url.searchParams.get('name');

		if (!name) {
			return jsonResponse({ error: "Configuration name is required" }, 400, request);
		}

		const config = await env.DB
			.prepare("SELECT devices FROM device_configurations WHERE user_id = ? AND name = ?")
			.bind(userId, name)
			.first();

		if (!config) {
			return jsonResponse({ error: "Configuration not found" }, 404, request);
		}

		const devices = JSON.parse(config.devices);
		return jsonResponse({ devices }, 200, request);

	} catch (err) {
		console.error('Load configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 獲取配置列表
export async function handleGetConfigurations(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		// 獲取所有配置並關聯用戶資訊
		const configs = await env.DB
			.prepare(`
				SELECT 
					dc.id,
					dc.user_id,
					dc.name,
					dc.devices,
					dc.created_at,
					dc.updated_at,
					u.chinese_name,
					u.name as user_name
				FROM device_configurations dc
				LEFT JOIN users u ON dc.user_id = u.id
				ORDER BY dc.updated_at DESC
			`)
			.all();

		return jsonResponse({ configurations: configs.results }, 200, request);

	} catch (err) {
		console.error('Get configurations error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除配置
export async function handleDeleteConfiguration(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const url = new URL(request.url);
		const name = url.searchParams.get('name');

		if (!name) {
			return jsonResponse({ error: "Configuration name is required" }, 400, request);
		}

		const result = await env.DB
			.prepare("DELETE FROM device_configurations WHERE user_id = ? AND name = ?")
			.bind(userId, name)
			.run();

		if (result.changes === 0) {
			return jsonResponse({ error: "Configuration not found" }, 404, request);
		}

		return jsonResponse({ ok: true, message: "Configuration deleted successfully" }, 200, request);

	} catch (err) {
		console.error('Delete configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}