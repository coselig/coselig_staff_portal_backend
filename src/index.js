/**
 * Cloudflare Worker - 完整登入 + Session 範例
 */

import { corsHeaders, jsonResponse, generateSessionId, setCookie } from './utils.js';
import { handleLogin, handleMe, handleLogout, handleRegister } from './auth.js';
import { handleEmployees, handleWorkingStaff } from './employees.js';
import { handleManualPunch, checkIn, checkOut, getToday, getMonth } from './attendance.js';
import { handleGetDevices, handleAddDevice, handleDeleteDevice, handleUpdateDevice, handleSaveConfiguration, handleLoadConfiguration, handleGetConfigurations, handleDeleteConfiguration } from './discovery.js';
import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

// Handler functions
async function handleHealth(request, env) {
	return jsonResponse({ ok: true, message: "Worker is alive" }, 200, request);
}

// 簡單後門打卡函數
async function handleSimplePunch(request, env) {
	try {
		const body = await request.json();
		const { employeeId, type = 'in', note = 'API 自動打卡' } = body;

		if (!employeeId) {
			return jsonResponse({ error: "需要 employeeId" }, 400, request);
		}

		// 修正：使用 UTC+8 時區計算今天的日期和時間戳
		const now = new Date();
		const taipeiTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
		const today = taipeiTime.toISOString().slice(0, 10); // YYYY-MM-DD
		const timestamp = taipeiTime.toISOString().slice(0, 19).replace('T', ' '); // 精確到秒的時間戳

		// 直接插入打卡記錄到資料庫
		const query = `
			INSERT INTO attendance (
				user_id, 
				work_date,
				period,
				${type === 'in' ? 'check_in_time' : 'check_out_time'},
				updated_at
			) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(user_id, work_date, period) DO UPDATE SET
				${type === 'in' ? 'check_in_time' : 'check_out_time'} = ?,
				updated_at = ?
		`;

		await env.DB.prepare(query).bind(
			employeeId, today, note, timestamp, timestamp,
			timestamp, timestamp
		).run();

		return jsonResponse({
			success: true,
			message: `${employeeId} ${type === 'in' ? '上班' : '下班'}打卡成功`,
			timestamp: timestamp,
			date: today
		}, 200, request);

	} catch (error) {
		return jsonResponse({
			error: "打卡失敗",
			detail: error.message
		}, 500, request);
	}
}

// 路由表
const routes = {
	GET: {
		"/api/health": handleHealth,
		"/api/me": handleMe,
		"/api/employees": handleEmployees,
		"/api/working-staff": handleWorkingStaff,
		"/api/attendance/month": getMonth,
		"/api/devices": handleGetDevices,
		"/api/configurations": handleGetConfigurations,
		"/api/configurations/load": handleLoadConfiguration,
	},
	POST: {
		"/api/login": handleLogin,
		"/api/logout": handleLogout,
		"/api/register": handleRegister,
		"/api/manual-punch": handleManualPunch,
		"/api/simple-punch": handleSimplePunch,
		"/api/devices": handleAddDevice,
		"/api/configurations": handleSaveConfiguration,
	},
	PUT: {
		"/api/devices": handleUpdateDevice,
	},
	DELETE: {
		"/api/devices": handleDeleteDevice,
		"/api/configurations": handleDeleteConfiguration,
	},
};

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(request),
			});
		}
		if (request.method === 'POST' && url.pathname === '/api/attendance/check-in') {
			return checkIn(request, env);
		}
		if (request.method === 'POST' && url.pathname === '/api/attendance/check-out') {
			return checkOut(request, env);
		}
		if (request.method === 'GET' && url.pathname === '/api/attendance/today') {
			return getToday(request, env);
		}
		try {
			const methodRoutes = routes[request.method];
			const handler = methodRoutes && methodRoutes[url.pathname];
			if (handler) {
				return await handler(request, env);
			}
			// 如果不是 API 路由，嘗試服務靜態文件
			let assetRequest = request;
			if (url.pathname === '/') {
				// 對於根路徑，返回 index.html
				const newUrl = new URL(request.url);
				newUrl.pathname = '/index.html';
				assetRequest = new Request(newUrl, request);
			}
			try {
				return await getAssetFromKV(
					{ request: assetRequest },
					{
						ASSET_NAMESPACE: env.STATIC_ASSETS,
						cacheControl: {
							browserTTL: 60 * 60 * 24 * 30,
							edgeTTL: 60 * 60 * 24 * 30,
							bypassCache: false,
						},
					}
				);
			} catch (e) {
				// SPA fallback: 如果找不到文件且不是 API 路由，返回 index.html
				// 這樣前端路由（Flutter Router）就能接管並顯示正確的頁面
				if (!url.pathname.startsWith('/api/')) {
					try {
						const indexUrl = new URL(request.url);
						indexUrl.pathname = '/index.html';
						const indexRequest = new Request(indexUrl, request);
						return await getAssetFromKV(
							{ request: indexRequest },
							{
								ASSET_NAMESPACE: env.STATIC_ASSETS,
								cacheControl: {
									browserTTL: 60 * 60 * 24 * 30,
									edgeTTL: 60 * 60 * 24 * 30,
									bypassCache: false,
								},
							}
						);
					} catch (indexError) {
						// 如果連 index.html 都找不到，返回錯誤
						return jsonResponse({ error: "Not Found" }, 404, request);
					}
				}
				// 對於 API 路由，返回 404
				return jsonResponse({ error: "Not Found" }, 404, request);
			}
		} catch (err) {
			return jsonResponse({ error: "Internal Server Error", detail: err?.message ?? String(err) }, 500, request);
		}
	},
};