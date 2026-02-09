// customers.js - 客戶資料管理相關的 API 處理函數

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

// 創建新客戶
export async function handleCreateCustomer(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const body = await request.json();
		const {
			name,
			chinese_name,
			company,
			email,
			phone,
			address,
			project_name,
			project_address,
			contact_person,
			notes
		} = body;

		if (!name?.trim()) {
			return jsonResponse({ error: "Customer name is required" }, 400, request);
		}

		// 插入新客戶
		const result = await env.DB
			.prepare(`
				INSERT INTO customers (
					user_id, name, chinese_name, company, email, phone, address,
					project_name, project_address, contact_person, notes
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.bind(
				userId, name.trim(), chinese_name?.trim(), company?.trim(),
				email?.trim(), phone?.trim(), address?.trim(),
				project_name?.trim(), project_address?.trim(),
				contact_person?.trim(), notes?.trim()
			)
			.run();

		return jsonResponse({
			ok: true,
			message: "Customer created successfully",
			customerId: result.meta.last_row_id
		}, 201, request);

	} catch (err) {
		console.error('Create customer error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 獲取所有客戶（當前用戶的）
export async function handleGetCustomers(request, env) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const customers = await env.DB
			.prepare(`
				SELECT id, user_id, name, chinese_name, company, email, phone, address,
				       project_name, project_address, contact_person, notes, is_active,
				       created_at, updated_at
				FROM customers
				WHERE user_id = ?
				ORDER BY created_at DESC
			`)
			.bind(userId)
			.all();

		return jsonResponse({ customers: customers.results }, 200, request);

	} catch (err) {
		console.error('Get customers error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 根據 ID 獲取客戶
export async function handleGetCustomerById(request, env, customerId) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const customer = await env.DB
			.prepare(`
				SELECT id, user_id, name, chinese_name, company, email, phone, address,
				       project_name, project_address, contact_person, notes, is_active,
				       created_at, updated_at
				FROM customers
				WHERE id = ? AND user_id = ?
			`)
			.bind(customerId, userId)
			.first();

		if (!customer) {
			return jsonResponse({ error: "Customer not found" }, 404, request);
		}

		return jsonResponse({ customer }, 200, request);

	} catch (err) {
		console.error('Get customer by ID error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 更新客戶
export async function handleUpdateCustomer(request, env, customerId) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		const body = await request.json();
		const {
			name,
			chinese_name,
			company,
			email,
			phone,
			address,
			project_name,
			project_address,
			contact_person,
			notes,
			is_active
		} = body;

		if (!name?.trim()) {
			return jsonResponse({ error: "Customer name is required" }, 400, request);
		}

		// 更新客戶
		await env.DB
			.prepare(`
				UPDATE customers
				SET name = ?, chinese_name = ?, company = ?, email = ?, phone = ?, address = ?,
				    project_name = ?, project_address = ?, contact_person = ?, notes = ?,
				    is_active = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
				WHERE id = ? AND user_id = ?
			`)
			.bind(
				name.trim(), chinese_name?.trim(), company?.trim(),
				email?.trim(), phone?.trim(), address?.trim(),
				project_name?.trim(), project_address?.trim(),
				contact_person?.trim(), notes?.trim(),
				is_active ? 1 : 0, customerId, userId
			)
			.run();

		return jsonResponse({ ok: true, message: "Customer updated successfully" }, 200, request);

	} catch (err) {
		console.error('Update customer error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}

// 刪除客戶
export async function handleDeleteCustomer(request, env, customerId) {
	const userId = await getCurrentUserId(request, env);
	if (!userId) return jsonResponse({ error: "Not logged in" }, 401, request);

	try {
		// 檢查是否有相關的報價配置
		const quoteCount = await env.DB
			.prepare("SELECT COUNT(*) as count FROM quote_configurations WHERE customer_id = ?")
			.bind(customerId)
			.first();

		if (quoteCount.count > 0) {
			return jsonResponse({
				error: "Cannot delete customer with existing quote configurations",
				quoteCount: quoteCount.count
			}, 400, request);
		}

		// 刪除客戶
		await env.DB
			.prepare("DELETE FROM customers WHERE id = ? AND user_id = ?")
			.bind(customerId, userId)
			.run();

		return jsonResponse({ ok: true, message: "Customer deleted successfully" }, 200, request);

	} catch (err) {
		console.error('Delete customer error:', err);
		return jsonResponse({ error: 'Internal Server Error', detail: err?.message ?? String(err) }, 500, request);
	}
}