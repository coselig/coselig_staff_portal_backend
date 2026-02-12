/**
 * Cloudflare Worker - 完整登入 + Session 範例
 */

import { corsHeaders, jsonResponse, generateSessionId, setCookie } from './utils.js';
import { handleLogin, handleMe, handleLogout, handleRegister, handleGoogleLogin } from './auth.js';
import { handleEmployees, handleWorkingStaff } from './employees.js';
import { handleManualPunch, handleEmployeeManualPunch, checkIn, checkOut, getToday, getMonth, updatePeriodName } from './attendance.js';
import { handleSaveConfiguration, handleLoadConfiguration, handleGetConfigurations, handleDeleteConfiguration } from './discovery.js';
import { handleSaveQuoteConfiguration, handleLoadQuoteConfiguration, handleGetQuoteConfigurations, handleDeleteQuoteConfiguration, handleGetModuleOptions, handleAddModuleOption, handleUpdateModuleOption, handleDeleteModuleOption, handleGetFixtureTypeOptions, handleAddFixtureTypeOption, handleUpdateFixtureTypeOption, handleDeleteFixtureTypeOption } from './quote.js';
import { handleGetCurrentUser, handleGetAllUsers, handleGetUserById, handleUpdateCurrentUser, handleUpdateThemeMode } from './users.js';
import { handleCreateCustomer, handleGetCustomers, handleGetCustomerById, handleUpdateCustomer, handleDeleteCustomer } from './customers.js';
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
		"/api/configurations": handleGetConfigurations,
		"/api/configurations/load": handleLoadConfiguration,
		"/api/quote-configurations": handleGetQuoteConfigurations,
		"/api/quote-configurations/load": handleLoadQuoteConfiguration,
		"/api/module-options": handleGetModuleOptions,
		"/api/fixture-type-options": handleGetFixtureTypeOptions,
		"/api/users/me": handleGetCurrentUser,
		"/api/users": handleGetAllUsers,
		"/api/customers": handleGetCustomers,
	},
	POST: {
		"/api/login": handleLogin,
		"/api/logout": handleLogout,
		"/api/register": handleRegister,
		"/api/google-login": handleGoogleLogin,
		"/api/manual-punch": handleManualPunch,
		"/api/employee-manual-punch": handleEmployeeManualPunch,
		"/api/devtools/manual-punch": async (req, env) => {
			const mod = await import('./attendance.js');
			return mod.devManualPunch(req, env);
		},
		"/api/simple-punch": handleSimplePunch,
		"/api/configurations": handleSaveConfiguration,
		"/api/quote-configurations": handleSaveQuoteConfiguration,
		"/api/module-options": handleAddModuleOption,
		"/api/fixture-type-options": handleAddFixtureTypeOption,
		"/api/customers": handleCreateCustomer,
	},
	PUT: {
		"/api/attendance/period": updatePeriodName,
		"/api/users/me": handleUpdateCurrentUser,
		"/api/users/theme-mode": handleUpdateThemeMode,
		"/api/module-options": handleUpdateModuleOption,
		"/api/fixture-type-options": handleUpdateFixtureTypeOption,
	},
	DELETE: {
		"/api/configurations": handleDeleteConfiguration,
		"/api/quote-configurations": handleDeleteQuoteConfiguration,
		"/api/module-options": handleDeleteModuleOption,
		"/api/fixture-type-options": handleDeleteFixtureTypeOption,
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
		if (request.method === 'GET' && url.pathname === '/api/devtools/attendance') {
			const mod = await import('./attendance.js');
			return mod.devGetAttendance(request, env);
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

			// 處理動態路由 /api/users/:id
			const userIdMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
			if (userIdMatch && request.method === 'GET') {
				return await handleGetUserById(request, env, userIdMatch[1]);
			}

			// 處理動態路由 /api/customers/:id
			const customerIdMatch = url.pathname.match(/^\/api\/customers\/(\d+)$/);
			if (customerIdMatch) {
				if (request.method === 'GET') {
					return await handleGetCustomerById(request, env, customerIdMatch[1]);
				} else if (request.method === 'PUT') {
					return await handleUpdateCustomer(request, env, customerIdMatch[1]);
				} else if (request.method === 'DELETE') {
					return await handleDeleteCustomer(request, env, customerIdMatch[1]);
				}
			}

			// 如果不是 API 路由，嘗試服務靜態文件
			let assetRequest = request;
			if (url.pathname === '/') {
				// 對於根路徑，返回 index.html
				const newUrl = new URL(request.url);
				newUrl.pathname = '/index.html';
				assetRequest = new Request(newUrl, request);
			}

			// 對於 version.json，使用較短的緩存時間
			const isVersionFile = url.pathname === '/version.json';

			try {
				const response = await getAssetFromKV(
					{ request: assetRequest },
					{
						ASSET_NAMESPACE: env.STATIC_ASSETS,
						cacheControl: {
							browserTTL: isVersionFile ? 60 : 60 * 60 * 24 * 30, // version.json 1分鐘，其他文件 30天
							edgeTTL: isVersionFile ? 60 : 60 * 60 * 24 * 30,
							bypassCache: false,
						},
					}
				);

				// 為 version.json 添加 no-cache 頭
				if (isVersionFile) {
					const newHeaders = new Headers(response.headers);
					newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
					newHeaders.set('Pragma', 'no-cache');
					newHeaders.set('Expires', '0');
					return new Response(response.body, {
						status: response.status,
						statusText: response.statusText,
						headers: newHeaders,
					});
				}

				return response;
			} catch (e) {
				// SPA fallback: 如果找不到文件且不是 API 路由，返回 index.html
				// 這樣前端路由（Flutter Router）就能接管並顯示正確的頁面
				if (!url.pathname.startsWith('/api/')) {
					try {
						const indexUrl = new URL(request.url);
						indexUrl.pathname = '/index.html';
						const indexRequest = new Request(indexUrl, request);
						const response = await getAssetFromKV(
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
						return response;
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