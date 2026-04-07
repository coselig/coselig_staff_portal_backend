// project_cases.js - 案件管理與估價快照 API

import { jsonResponse } from './utils.js';

// ===== 案件 CRUD =====

// 取得所有案件（員工/管理員）
export async function handleGetCases(request, env, auth) {
	try {
		const url = new URL(request.url);
		const customerId = url.searchParams.get('customer_id');

		let query;
		let bindings;

		if (customerId) {
			query = `
				SELECT
					pc.id, pc.name, pc.status, pc.notes,
					pc.customer_id, pc.created_by,
					pc.created_at, pc.updated_at,
					c.company AS customer_company,
					u.name AS customer_name,
					u.chinese_name AS customer_chinese_name,
					cu.name AS creator_name,
					cu.chinese_name AS creator_chinese_name,
					(SELECT COUNT(*) FROM quote_snapshots qs WHERE qs.case_id = pc.id) AS snapshot_count
				FROM project_cases pc
				LEFT JOIN customers c ON pc.customer_id = c.id
				LEFT JOIN users u ON c.user_id = u.id
				LEFT JOIN users cu ON pc.created_by = cu.id
				WHERE pc.customer_id = ?
				ORDER BY pc.created_at DESC
			`;
			bindings = [customerId];
		} else {
			query = `
				SELECT
					pc.id, pc.name, pc.status, pc.notes,
					pc.customer_id, pc.created_by,
					pc.created_at, pc.updated_at,
					c.company AS customer_company,
					u.name AS customer_name,
					u.chinese_name AS customer_chinese_name,
					cu.name AS creator_name,
					cu.chinese_name AS creator_chinese_name,
					(SELECT COUNT(*) FROM quote_snapshots qs WHERE qs.case_id = pc.id) AS snapshot_count
				FROM project_cases pc
				LEFT JOIN customers c ON pc.customer_id = c.id
				LEFT JOIN users u ON c.user_id = u.id
				LEFT JOIN users cu ON pc.created_by = cu.id
				ORDER BY pc.created_at DESC
			`;
			bindings = [];
		}

		const stmt = env.DB.prepare(query);
		const cases = bindings.length > 0
			? await stmt.bind(...bindings).all()
			: await stmt.all();

		return jsonResponse({ cases: cases.results }, 200, request);
	} catch (err) {
		console.error('Get cases error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 建立新案件
export async function handleCreateCase(request, env, auth) {
	try {
		const body = await request.json();
		const { name, customer_id, notes, status = 'active' } = body;

		if (!name?.trim()) {
			return jsonResponse({ error: 'Missing required field: name' }, 400, request);
		}

		const result = await env.DB
			.prepare(`
				INSERT INTO project_cases (name, customer_id, created_by, notes, status)
				VALUES (?, ?, ?, ?, ?)
			`)
			.bind(name.trim(), customer_id ?? null, auth.session.user_id, notes?.trim() ?? null, status)
			.run();

		return jsonResponse({ ok: true, id: result.meta.last_row_id }, 201, request);
	} catch (err) {
		console.error('Create case error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 取得單一案件（含最新快照摘要）
export async function handleGetCaseById(request, env, caseId, auth) {
	try {
		const projectCase = await env.DB
			.prepare(`
				SELECT
					pc.id, pc.name, pc.status, pc.notes,
					pc.customer_id, pc.created_by,
					pc.created_at, pc.updated_at,
					c.company AS customer_company,
					u.name AS customer_name,
					u.chinese_name AS customer_chinese_name,
					u.email AS customer_email,
					u.phone AS customer_phone,
					cu.name AS creator_name,
					cu.chinese_name AS creator_chinese_name
				FROM project_cases pc
				LEFT JOIN customers c ON pc.customer_id = c.id
				LEFT JOIN users u ON c.user_id = u.id
				LEFT JOIN users cu ON pc.created_by = cu.id
				WHERE pc.id = ?
			`)
			.bind(caseId)
			.first();

		if (!projectCase) {
			return jsonResponse({ error: 'Case not found' }, 404, request);
		}

		return jsonResponse({ case: projectCase }, 200, request);
	} catch (err) {
		console.error('Get case by id error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新案件
export async function handleUpdateCase(request, env, caseId, auth) {
	try {
		const body = await request.json();
		const { name, customer_id, notes, status } = body;

		const existing = await env.DB
			.prepare('SELECT id FROM project_cases WHERE id = ?')
			.bind(caseId)
			.first();

		if (!existing) {
			return jsonResponse({ error: 'Case not found' }, 404, request);
		}

		await env.DB
			.prepare(`
				UPDATE project_cases
				SET
					name = COALESCE(?, name),
					customer_id = COALESCE(?, customer_id),
					notes = COALESCE(?, notes),
					status = COALESCE(?, status),
					updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
				WHERE id = ?
			`)
			.bind(name?.trim() ?? null, customer_id ?? null, notes?.trim() ?? null, status ?? null, caseId)
			.run();

		return jsonResponse({ ok: true }, 200, request);
	} catch (err) {
		console.error('Update case error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除案件（管理員）
export async function handleDeleteCase(request, env, caseId, auth) {
	try {
		const existing = await env.DB
			.prepare('SELECT id FROM project_cases WHERE id = ?')
			.bind(caseId)
			.first();

		if (!existing) {
			return jsonResponse({ error: 'Case not found' }, 404, request);
		}

		await env.DB
			.prepare('DELETE FROM project_cases WHERE id = ?')
			.bind(caseId)
			.run();

		return jsonResponse({ ok: true }, 200, request);
	} catch (err) {
		console.error('Delete case error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// ===== 估價快照 =====

// 取得某案件的所有快照（不含 quote_data，只有摘要）
export async function handleGetSnapshots(request, env, caseId, auth) {
	try {
		const caseExists = await env.DB
			.prepare('SELECT id FROM project_cases WHERE id = ?')
			.bind(caseId)
			.first();

		if (!caseExists) {
			return jsonResponse({ error: 'Case not found' }, 404, request);
		}

		const snapshots = await env.DB
			.prepare(`
				SELECT
					qs.id, qs.case_id, qs.label, qs.created_at,
					qs.created_by,
					u.name AS creator_name,
					u.chinese_name AS creator_chinese_name
				FROM quote_snapshots qs
				LEFT JOIN users u ON qs.created_by = u.id
				WHERE qs.case_id = ?
				ORDER BY qs.created_at ASC
			`)
			.bind(caseId)
			.all();

		return jsonResponse({ snapshots: snapshots.results }, 200, request);
	} catch (err) {
		console.error('Get snapshots error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 取得單一快照（含 quote_data）
export async function handleGetSnapshotById(request, env, caseId, snapshotId, auth) {
	try {
		const snapshot = await env.DB
			.prepare(`
				SELECT qs.id, qs.case_id, qs.label, qs.quote_data, qs.created_at,
					qs.created_by, u.name AS creator_name, u.chinese_name AS creator_chinese_name
				FROM quote_snapshots qs
				LEFT JOIN users u ON qs.created_by = u.id
				WHERE qs.id = ? AND qs.case_id = ?
			`)
			.bind(snapshotId, caseId)
			.first();

		if (!snapshot) {
			return jsonResponse({ error: 'Snapshot not found' }, 404, request);
		}

		return jsonResponse({ snapshot }, 200, request);
	} catch (err) {
		console.error('Get snapshot by id error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 新增快照
export async function handleCreateSnapshot(request, env, caseId, auth) {
	try {
		const body = await request.json();
		const { label, quote_data } = body;

		if (!label?.trim()) {
			return jsonResponse({ error: 'Missing required field: label' }, 400, request);
		}
		if (!quote_data) {
			return jsonResponse({ error: 'Missing required field: quote_data' }, 400, request);
		}

		const caseExists = await env.DB
			.prepare('SELECT id FROM project_cases WHERE id = ?')
			.bind(caseId)
			.first();

		if (!caseExists) {
			return jsonResponse({ error: 'Case not found' }, 404, request);
		}

		const quoteJson = typeof quote_data === 'string' ? quote_data : JSON.stringify(quote_data);

		const result = await env.DB
			.prepare(`
				INSERT INTO quote_snapshots (case_id, label, quote_data, created_by)
				VALUES (?, ?, ?, ?)
			`)
			.bind(caseId, label.trim(), quoteJson, auth.session.user_id)
			.run();

		// 更新 case updated_at
		await env.DB
			.prepare(`
				UPDATE project_cases
				SET updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
				WHERE id = ?
			`)
			.bind(caseId)
			.run();

		return jsonResponse({ ok: true, id: result.meta.last_row_id }, 201, request);
	} catch (err) {
		console.error('Create snapshot error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除快照
export async function handleDeleteSnapshot(request, env, caseId, snapshotId, auth) {
	try {
		const existing = await env.DB
			.prepare('SELECT id FROM quote_snapshots WHERE id = ? AND case_id = ?')
			.bind(snapshotId, caseId)
			.first();

		if (!existing) {
			return jsonResponse({ error: 'Snapshot not found' }, 404, request);
		}

		await env.DB
			.prepare('DELETE FROM quote_snapshots WHERE id = ? AND case_id = ?')
			.bind(snapshotId, caseId)
			.run();

		return jsonResponse({ ok: true }, 200, request);
	} catch (err) {
		console.error('Delete snapshot error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}
