// quote.js - 估價系統相關的 API 處理函數

import { corsHeaders, jsonResponse } from './utils.js';

// 獲取當前用戶 ID 的輔助函數
async function getCurrentUserId(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	console.log('getCurrentUserId - Cookie:', cookie);
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) {
		console.log('getCurrentUserId - No session_id in cookie');
		return null;
	}

	const sessionId = match[1];
	console.log('getCurrentUserId - session_id:', sessionId);
	const session = await env.DB
		.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
		.bind(sessionId)
		.first();
	console.log('getCurrentUserId - session from DB:', session);

	if (!session) {
		console.log('getCurrentUserId - Session not found in DB');
		return null;
	}

	if (new Date(session.expires_at) < new Date()) {
		console.log('getCurrentUserId - Session expired:', session.expires_at, 'vs now:', new Date().toISOString());
		return null;
	}

	console.log('getCurrentUserId - Valid session, user_id:', session.user_id);
	return session.user_id;
}

// 保存估價配置
export async function handleSaveQuoteConfiguration(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const body = await request.json().catch(() => null);
		if (!body?.name || !body?.quoteData) {
			return jsonResponse({ error: "Missing required fields: name and quoteData" }, 400, request);
		}

		const { name, quoteData } = body;

		// 檢查是否已存在相同名稱的配置（不限制 user_id）
		const existing = await env.DB
			.prepare("SELECT id FROM quote_configurations WHERE name = ?")
			.bind(name)
			.first();

		if (existing) {
			// 更新現有配置（任何人都可以更新）
			await env.DB
				.prepare(`
					UPDATE quote_configurations
					SET quote_data = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
					WHERE name = ?
				`)
				.bind(JSON.stringify(quoteData), name)
				.run();
		} else {
			// 創建新配置
			await env.DB
				.prepare(`
					INSERT INTO quote_configurations (user_id, name, quote_data)
					VALUES (?, ?, ?)
				`)
				.bind(userId, name, JSON.stringify(quoteData))
				.run();
		}

		return jsonResponse({ ok: true, message: "Quote configuration saved successfully" }, 200, request);

	} catch (err) {
		console.error('Save quote configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 加載估價配置
export async function handleLoadQuoteConfiguration(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const url = new URL(request.url);
		const name = url.searchParams.get('name');

		if (!name) {
			return jsonResponse({ error: "Configuration name is required" }, 400, request);
		}

		const config = await env.DB
			.prepare("SELECT quote_data FROM quote_configurations WHERE name = ?")
			.bind(name)
			.first();

		if (!config) {
			return jsonResponse({ error: "Configuration not found" }, 404, request);
		}

		const quoteData = JSON.parse(config.quote_data);
		return jsonResponse({ quoteData }, 200, request);

	} catch (err) {
		console.error('Load quote configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 獲取估價配置列表
export async function handleGetQuoteConfigurations(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		// 獲取所有配置並關聯用戶資訊
		const configs = await env.DB
			.prepare(`
				SELECT
					qc.id,
					qc.user_id,
					qc.name,
					qc.quote_data,
					qc.created_at,
					qc.updated_at,
					u.chinese_name,
					u.name as user_name
				FROM quote_configurations qc
				LEFT JOIN users u ON qc.user_id = u.id
				ORDER BY qc.updated_at DESC
			`)
			.all();

		return jsonResponse({ configurations: configs.results }, 200, request);

	} catch (err) {
		console.error('Get quote configurations error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除估價配置
export async function handleDeleteQuoteConfiguration(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const url = new URL(request.url);
		const name = url.searchParams.get('name');

		if (!name) {
			return jsonResponse({ error: "Configuration name is required" }, 400, request);
		}

		const result = await env.DB
			.prepare("DELETE FROM quote_configurations WHERE name = ?")
			.bind(name)
			.run();

		if (result.changes === 0) {
			return jsonResponse({ error: "Configuration not found" }, 404, request);
		}

		return jsonResponse({ ok: true, message: "Quote configuration deleted successfully" }, 200, request);

	} catch (err) {
		console.error('Delete quote configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 獲取模組選項
export async function handleGetModuleOptions(request, env) {
	try {
		const modules = await env.DB
			.prepare("SELECT id, model, channel_count, is_dimmable, max_ampere_per_channel, max_ampere_total FROM module_options ORDER BY model")
			.all();

		// 轉換資料格式以匹配前端期望
		const moduleOptions = modules.results.map(module => ({
			id: module.id,
			model: module.model,
			channelCount: module.channel_count,
			isDimmable: module.is_dimmable === 1,
			maxAmperePerChannel: module.max_ampere_per_channel,
			maxAmpereTotal: module.max_ampere_total,
		}));

		return jsonResponse({ moduleOptions }, 200, request);

	} catch (err) {
		console.error('Get module options error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 添加模組選項
export async function handleAddModuleOption(request, env) {
	try {
		const body = await request.json().catch(() => null);
		if (!body?.model || body.channelCount === undefined || body.maxAmperePerChannel === undefined || body.maxAmpereTotal === undefined) {
			return jsonResponse({ error: "Missing required fields: model, channelCount, maxAmperePerChannel, maxAmpereTotal" }, 400, request);
		}

		const { model, channelCount, isDimmable = true, maxAmperePerChannel, maxAmpereTotal } = body;

		// 檢查是否已存在相同型號
		const existing = await env.DB
			.prepare("SELECT id FROM module_options WHERE model = ?")
			.bind(model)
			.first();

		if (existing) {
			return jsonResponse({ error: "Module model already exists" }, 409, request);
		}

		await env.DB
			.prepare(`
				INSERT INTO module_options (model, channel_count, is_dimmable, max_ampere_per_channel, max_ampere_total)
				VALUES (?, ?, ?, ?, ?)
			`)
			.bind(model, channelCount, isDimmable ? 1 : 0, maxAmperePerChannel, maxAmpereTotal)
			.run();

		return jsonResponse({ ok: true, message: "Module option added successfully" }, 201, request);

	} catch (err) {
		console.error('Add module option error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新模組選項
export async function handleUpdateModuleOption(request, env) {
	try {
		const url = new URL(request.url);
		const id = url.searchParams.get('id');

		if (!id) {
			return jsonResponse({ error: "Module ID is required" }, 400, request);
		}

		const body = await request.json().catch(() => null);
		if (!body) {
			return jsonResponse({ error: "Request body is required" }, 400, request);
		}

		const { model, channelCount, isDimmable, maxAmperePerChannel, maxAmpereTotal } = body;

		// 檢查模組是否存在
		const existing = await env.DB
			.prepare("SELECT id FROM module_options WHERE id = ?")
			.bind(id)
			.first();

		if (!existing) {
			return jsonResponse({ error: "Module option not found" }, 404, request);
		}

		// 如果更新型號，檢查是否與其他模組衝突
		if (model) {
			const duplicate = await env.DB
				.prepare("SELECT id FROM module_options WHERE model = ? AND id != ?")
				.bind(model, id)
				.first();

			if (duplicate) {
				return jsonResponse({ error: "Module model already exists" }, 409, request);
			}
		}

		// 構建更新語句
		let updateFields = [];
		let values = [];

		if (model !== undefined) {
			updateFields.push("model = ?");
			values.push(model);
		}
		if (channelCount !== undefined) {
			updateFields.push("channel_count = ?");
			values.push(channelCount);
		}
		if (isDimmable !== undefined) {
			updateFields.push("is_dimmable = ?");
			values.push(isDimmable ? 1 : 0);
		}
		if (maxAmperePerChannel !== undefined) {
			updateFields.push("max_ampere_per_channel = ?");
			values.push(maxAmperePerChannel);
		}
		if (maxAmpereTotal !== undefined) {
			updateFields.push("max_ampere_total = ?");
			values.push(maxAmpereTotal);
		}

		if (updateFields.length === 0) {
			return jsonResponse({ error: "No fields to update" }, 400, request);
		}

		values.push(id); // WHERE 條件

		await env.DB
			.prepare(`UPDATE module_options SET ${updateFields.join(", ")} WHERE id = ?`)
			.bind(...values)
			.run();

		return jsonResponse({ ok: true, message: "Module option updated successfully" }, 200, request);

	} catch (err) {
		console.error('Update module option error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除模組選項
export async function handleDeleteModuleOption(request, env) {
	try {
		const url = new URL(request.url);
		const id = url.searchParams.get('id');

		if (!id) {
			return jsonResponse({ error: "Module ID is required" }, 400, request);
		}

		const result = await env.DB
			.prepare("DELETE FROM module_options WHERE id = ?")
			.bind(id)
			.run();

		if (result.changes === 0) {
			return jsonResponse({ error: "Module option not found" }, 404, request);
		}

		return jsonResponse({ ok: true, message: "Module option deleted successfully" }, 200, request);

	} catch (err) {
		console.error('Delete module option error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}