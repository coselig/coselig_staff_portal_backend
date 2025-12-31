// discovery.js - 裝置管理相關的 API 處理函數

import { corsHeaders, jsonResponse } from './utils.js';

// 獲取所有裝置
export async function handleGetDevices(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const devices = await env.DB.prepare("SELECT * FROM devices ORDER BY created_at DESC").all();
		return jsonResponse({ devices: devices.results }, 200, request);
	} catch (err) {
		console.error('Get devices error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 添加新裝置
export async function handleAddDevice(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const body = await request.json().catch(() => null);
		if (!body?.brand || !body?.model || !body?.type || !body?.module_id || !body?.channel || !body?.name) {
			return jsonResponse({ error: "Missing required fields" }, 400, request);
		}

		const { brand, model, type, module_id, channel, name, tcp } = body;

        // 檢查是否已存在相同的 module_id 和 channel 組合
		const existing = await env.DB
            .prepare("SELECT id FROM devices WHERE module_id = ? AND channel = ?")
            .bind(module_id, channel)
			.first();

		if (existing) {
            return jsonResponse({ error: "Device with this module_id and channel already exists" }, 409, request);
		}

		const result = await env.DB
			.prepare(`
				INSERT INTO devices (brand, model, type, module_id, channel, name, tcp)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`)
			.bind(brand, model, type, module_id, channel, name, tcp || null)
			.run();

		return jsonResponse({
			ok: true,
			device: {
				id: result.lastInsertRowid,
				brand, model, type, module_id, channel, name, tcp
			}
		}, 201, request);

	} catch (err) {
		console.error('Add device error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除裝置
export async function handleDeleteDevice(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const url = new URL(request.url);
		const deviceId = url.searchParams.get('id');

		if (!deviceId) {
			return jsonResponse({ error: "Device ID is required" }, 400, request);
		}

		const result = await env.DB
			.prepare("DELETE FROM devices WHERE id = ?")
			.bind(deviceId)
			.run();

		if (result.changes === 0) {
			return jsonResponse({ error: "Device not found" }, 404, request);
		}

		return jsonResponse({ ok: true, message: "Device deleted successfully" }, 200, request);

	} catch (err) {
		console.error('Delete device error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新裝置
export async function handleUpdateDevice(request, env) {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/session_id=([a-zA-Z0-9-]+)/);
	if (!match) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const body = await request.json().catch(() => null);
		if (!body?.id) {
			return jsonResponse({ error: "Device ID is required" }, 400, request);
		}

		const { id, brand, model, type, module_id, channel, name, tcp } = body;

		const result = await env.DB
			.prepare(`
				UPDATE devices
				SET brand = ?, model = ?, type = ?, module_id = ?, channel = ?, name = ?, tcp = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
				WHERE id = ?
			`)
			.bind(brand, model, type, module_id, channel, name, tcp || '', id)
			.run();

		if (result.changes === 0) {
			return jsonResponse({ error: "Device not found" }, 404, request);
		}

		return jsonResponse({ ok: true, message: "Device updated successfully" }, 200, request);

	} catch (err) {
		console.error('Update device error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}