// discovery.js - 裝置管理相關的 API 處理函數

import { jsonResponse } from './utils.js';

// 保存設備配置
export async function handleSaveConfiguration(request, env, auth) {
	try {
		const body = await request.json().catch(() => null);
		if (!body?.name || !body?.devices) {
			return jsonResponse({ error: "Missing required fields: name and devices" }, 400, request);
		}

		const { name, devices } = body;
		const caseId = body?.case_id ?? null;

		// 嘗試以 case_id 操作；若資料庫尚未有 case_id 欄位則回退到不使用 case_id 的操作
		try {
			const existing = await env.DB
				.prepare(caseId !== null ? "SELECT id FROM device_configurations WHERE name = ? AND case_id = ?" : "SELECT id FROM device_configurations WHERE name = ?")
				.bind(...(caseId !== null ? [name, caseId] : [name]))
				.first();

			if (existing) {
				if (caseId !== null) {
					await env.DB
						.prepare(`
							UPDATE device_configurations
							SET devices = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
							WHERE name = ? AND case_id = ?
						`)
						.bind(JSON.stringify(devices), name, caseId)
						.run();
				} else {
					await env.DB
						.prepare(`
							UPDATE device_configurations
							SET devices = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
							WHERE name = ?
						`)
						.bind(JSON.stringify(devices), name)
						.run();
				}
			} else {
				if (caseId !== null) {
					await env.DB
						.prepare(`
							INSERT INTO device_configurations (user_id, name, devices, case_id)
							VALUES (?, ?, ?, ?)
						`)
						.bind(auth.session.user_id, name, JSON.stringify(devices), caseId)
						.run();
				} else {
					await env.DB
						.prepare(`
							INSERT INTO device_configurations (user_id, name, devices)
							VALUES (?, ?, ?)
						`)
						.bind(auth.session.user_id, name, JSON.stringify(devices))
						.run();
				}
			}
		} catch (err) {
			// 若是因為 case_id 欄位不存在導致的錯誤，回退至不帶 case_id 的舊流程
			console.warn('SaveConfiguration: SQL with case_id failed, retrying without case_id', err);
			const existing = await env.DB
				.prepare("SELECT id FROM device_configurations WHERE name = ?")
				.bind(name)
				.first();

			if (existing) {
				await env.DB
					.prepare(`
						UPDATE device_configurations
						SET devices = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
						WHERE name = ?
					`)
					.bind(JSON.stringify(devices), name)
					.run();
			} else {
				await env.DB
					.prepare(`
						INSERT INTO device_configurations (user_id, name, devices)
						VALUES (?, ?, ?)
					`)
					.bind(auth.session.user_id, name, JSON.stringify(devices))
					.run();
			}
		}

		return jsonResponse({ ok: true, message: "Configuration saved successfully" }, 200, request);

	} catch (err) {
		console.error('Save configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 加載設備配置
export async function handleLoadConfiguration(request, env) {
	try {
		const url = new URL(request.url);
		const name = url.searchParams.get('name');
		const caseIdParam = url.searchParams.get('case_id');
		const caseId = caseIdParam ? Number(caseIdParam) : null;

		if (!name) {
			return jsonResponse({ error: "Configuration name is required" }, 400, request);
		}

		try {
			const config = await env.DB
				.prepare(caseId !== null ? "SELECT devices FROM device_configurations WHERE name = ? AND case_id = ?" : "SELECT devices FROM device_configurations WHERE name = ?")
				.bind(...(caseId !== null ? [name, caseId] : [name]))
				.first();

			if (!config) {
				return jsonResponse({ error: "Configuration not found" }, 404, request);
			}

			const devices = JSON.parse(config.devices);
			return jsonResponse({ devices }, 200, request);
		} catch (err) {
			console.warn('LoadConfiguration: SQL with case_id failed, retrying without case_id', err);
			const config = await env.DB
				.prepare("SELECT devices FROM device_configurations WHERE name = ?")
				.bind(name)
				.first();

			if (!config) {
				return jsonResponse({ error: "Configuration not found" }, 404, request);
			}

			const devices = JSON.parse(config.devices);
			return jsonResponse({ devices }, 200, request);
		}

	} catch (err) {
		console.error('Load configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 獲取配置列表
export async function handleGetConfigurations(request, env) {
	try {
		// 可選地按 case_id 過濾
		const url = new URL(request.url);
		const caseIdParam = url.searchParams.get('case_id');
		const caseId = caseIdParam ? Number(caseIdParam) : null;

		let query = `
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
			`;

		if (caseId !== null) {
			query += `WHERE dc.case_id = ? `;
		}
		query += `ORDER BY dc.updated_at DESC`;

		try {
			const configs = caseId !== null
				? await env.DB.prepare(query).bind(caseId).all()
				: await env.DB.prepare(query).all();

			return jsonResponse({ configurations: configs.results }, 200, request);
		} catch (err) {
			console.warn('GetConfigurations: SQL with case_id failed, retrying without case_id', err);
			// Retry without case_id filter
			const fallbackQuery = `
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
			`;
			const configs = await env.DB.prepare(fallbackQuery).all();
			return jsonResponse({ configurations: configs.results }, 200, request);
		}

	} catch (err) {
		console.error('Get configurations error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除配置
export async function handleDeleteConfiguration(request, env) {
	try {
		const url = new URL(request.url);
		const name = url.searchParams.get('name');
		const caseIdParam = url.searchParams.get('case_id');
		const caseId = caseIdParam ? Number(caseIdParam) : null;

		if (!name) {
			return jsonResponse({ error: "Configuration name is required" }, 400, request);
		}

		try {
			const result = caseId !== null
				? await env.DB.prepare("DELETE FROM device_configurations WHERE name = ? AND case_id = ?").bind(name, caseId).run()
				: await env.DB.prepare("DELETE FROM device_configurations WHERE name = ?").bind(name).run();

			if (result.changes === 0) {
				return jsonResponse({ error: "Configuration not found" }, 404, request);
			}

			return jsonResponse({ ok: true, message: "Configuration deleted successfully" }, 200, request);
		} catch (err) {
			console.warn('DeleteConfiguration: SQL with case_id failed, retrying without case_id', err);
			const result = await env.DB.prepare("DELETE FROM device_configurations WHERE name = ?").bind(name).run();
			if (result.changes === 0) {
				return jsonResponse({ error: "Configuration not found" }, 404, request);
			}
			return jsonResponse({ ok: true, message: "Configuration deleted successfully" }, 200, request);
		}

		if (result.changes === 0) {
			return jsonResponse({ error: "Configuration not found" }, 404, request);
		}

		return jsonResponse({ ok: true, message: "Configuration deleted successfully" }, 200, request);

	} catch (err) {
		console.error('Delete configuration error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// ===== 裝置設定選項 CRUD =====

// Validate device config option payloads. If partial is true, only validate provided fields.
function validateDeviceConfigPayload(body, opts = { partial: false }) {
	if (!body || typeof body !== 'object') return { ok: false, message: 'Invalid JSON body' };
	const partial = !!opts.partial;

	if (!partial) {
		if (!body.brand || typeof body.brand !== 'string') return { ok: false, message: 'brand is required and must be a string' };
		if (!body.model || typeof body.model !== 'string') return { ok: false, message: 'model is required and must be a string' };
		if (!body.types || !Array.isArray(body.types)) return { ok: false, message: 'types is required and must be an array of strings' };
		if (!body.channels || typeof body.channels !== 'object') return { ok: false, message: 'channels is required and must be an object mapping to arrays' };
	}

	if (body.brand !== undefined && typeof body.brand !== 'string') return { ok: false, message: 'brand must be a string' };
	if (body.model !== undefined && typeof body.model !== 'string') return { ok: false, message: 'model must be a string' };
	if (body.types !== undefined) {
		if (!Array.isArray(body.types)) return { ok: false, message: 'types must be an array' };
		for (const t of body.types) if (typeof t !== 'string') return { ok: false, message: 'each type must be a string' };
	}
	if (body.channels !== undefined) {
		if (typeof body.channels !== 'object') return { ok: false, message: 'channels must be an object' };
		for (const k of Object.keys(body.channels)) {
			if (!Array.isArray(body.channels[k])) return { ok: false, message: `channels.${k} must be an array` };
			for (const v of body.channels[k]) if (typeof v !== 'string') return { ok: false, message: `channels.${k} values must be strings` };
		}
	}
	if (body.channelMap !== undefined) {
		if (typeof body.channelMap !== 'object') return { ok: false, message: 'channelMap must be an object' };
		for (const k of Object.keys(body.channelMap)) {
			if (!Array.isArray(body.channelMap[k])) return { ok: false, message: `channelMap.${k} must be an array` };
			for (const v of body.channelMap[k]) if (typeof v !== 'string') return { ok: false, message: `channelMap.${k} values must be strings` };
		}
	}

	return { ok: true };
}

// 獲取所有裝置設定選項
export async function handleGetDeviceConfigOptions(request, env) {
	try {
		const options = await env.DB
			.prepare("SELECT id, brand, model, types, channels, channel_map, created_at, updated_at FROM device_config_options ORDER BY brand, model")
			.all();

		const deviceConfigOptions = options.results.map(opt => ({
			id: opt.id,
			brand: opt.brand,
			model: opt.model,
			types: JSON.parse(opt.types),
			channels: JSON.parse(opt.channels),
			channelMap: JSON.parse(opt.channel_map),
			createdAt: opt.created_at,
			updatedAt: opt.updated_at,
		}));

		return jsonResponse({ deviceConfigOptions }, 200, request);
	} catch (err) {
		console.error('Get device config options error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 返回已組裝的 deviceConfigs 結構：brand -> model -> { types, channels, channel_map }
export async function handleGetDeviceConfigs(request, env) {
	try {
		const options = await env.DB
			.prepare("SELECT id, brand, model, types, channels, channel_map, created_at, updated_at FROM device_config_options ORDER BY brand, model")
			.all();

		const deviceConfigOptions = options.results.map(opt => ({
			id: opt.id,
			brand: opt.brand,
			model: opt.model,
			types: JSON.parse(opt.types),
			channels: JSON.parse(opt.channels),
			channelMap: JSON.parse(opt.channel_map),
			createdAt: opt.created_at,
			updatedAt: opt.updated_at,
		}));

		const deviceConfigs = {};
		for (const opt of deviceConfigOptions) {
			if (!deviceConfigs[opt.brand]) deviceConfigs[opt.brand] = {};
			deviceConfigs[opt.brand][opt.model] = {
				types: opt.types,
				channels: opt.channels,
				channel_map: opt.channelMap,
			};
		}

		return jsonResponse({ deviceConfigs }, 200, request);
	} catch (err) {
		console.error('Get device configs error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 新增裝置設定選項
export async function handleAddDeviceConfigOption(request, env) {
	try {
		const body = await request.json();
		// Validate payload shape
		const validation = validateDeviceConfigPayload(body);
		if (!validation.ok) {
			return jsonResponse({ error: validation.message }, 400, request);
		}

		const { brand, model, types, channels, channelMap = {} } = body;

		// 檢查是否已存在
		const existing = await env.DB
			.prepare("SELECT id FROM device_config_options WHERE brand = ? AND model = ?")
			.bind(brand, model)
			.first();

		if (existing) {
			return jsonResponse({ error: 'Device config option already exists for this brand and model' }, 409, request);
		}

		await env.DB
			.prepare("INSERT INTO device_config_options (brand, model, types, channels, channel_map) VALUES (?, ?, ?, ?, ?)")
			.bind(brand, model, JSON.stringify(types), JSON.stringify(channels), JSON.stringify(channelMap))
			.run();

		return jsonResponse({ ok: true, message: 'Device config option added' }, 201, request);
	} catch (err) {
		console.error('Add device config option error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新裝置設定選項
export async function handleUpdateDeviceConfigOption(request, env) {
	try {
		const url = new URL(request.url);
		const id = url.searchParams.get('id');
		if (!id) {
			return jsonResponse({ error: 'Missing id' }, 400, request);
		}

		const body = await request.json();
		const { brand, model, types, channels, channelMap } = body;

		// Partial payloads allowed for updates; validate provided fields
		const validation = validateDeviceConfigPayload(body, { partial: true });
		if (!validation.ok) {
			return jsonResponse({ error: validation.message }, 400, request);
		}

		const existing = await env.DB
			.prepare("SELECT id FROM device_config_options WHERE id = ?")
			.bind(id)
			.first();

		if (!existing) {
			return jsonResponse({ error: 'Device config option not found' }, 404, request);
		}

		// 檢查唯一性（排除自身）
		if (brand && model) {
			const duplicate = await env.DB
				.prepare("SELECT id FROM device_config_options WHERE brand = ? AND model = ? AND id != ?")
				.bind(brand, model, id)
				.first();
			if (duplicate) {
				return jsonResponse({ error: 'Device config option already exists for this brand and model' }, 409, request);
			}
		}

		let updateFields = [];
		let values = [];

		if (brand !== undefined) { updateFields.push("brand = ?"); values.push(brand); }
		if (model !== undefined) { updateFields.push("model = ?"); values.push(model); }
		if (types !== undefined) { updateFields.push("types = ?"); values.push(JSON.stringify(types)); }
		if (channels !== undefined) { updateFields.push("channels = ?"); values.push(JSON.stringify(channels)); }
		if (channelMap !== undefined) { updateFields.push("channel_map = ?"); values.push(JSON.stringify(channelMap)); }

		if (updateFields.length === 0) {
			return jsonResponse({ error: 'No fields to update' }, 400, request);
		}

		updateFields.push("updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))");
		values.push(id);

		await env.DB
			.prepare(`UPDATE device_config_options SET ${updateFields.join(", ")} WHERE id = ?`)
			.bind(...values)
			.run();

		return jsonResponse({ ok: true, message: 'Device config option updated' }, 200, request);
	} catch (err) {
		console.error('Update device config option error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除裝置設定選項
export async function handleDeleteDeviceConfigOption(request, env) {
	try {
		const url = new URL(request.url);
		const id = url.searchParams.get('id');
		if (!id) {
			return jsonResponse({ error: 'Missing id' }, 400, request);
		}

		const result = await env.DB
			.prepare("DELETE FROM device_config_options WHERE id = ?")
			.bind(id)
			.run();

		if (result.changes === 0) {
			return jsonResponse({ error: 'Device config option not found' }, 404, request);
		}

		return jsonResponse({ ok: true, message: 'Device config option deleted' }, 200, request);
	} catch (err) {
		console.error('Delete device config option error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}
