/**
 * Cloudflare Worker - 完整登入 + Session 範例
 */

import { corsHeaders, jsonResponse } from './utils.js';
import { handleMe, handleLogout, handleGoogleLogin } from './auth.js';
import { handleEmployees, handleWorkingStaff } from './employees.js';
import { handleManualPunch, handleEmployeeManualPunch, checkIn, checkOut, getToday, getMonth, updatePeriodName } from './attendance.js';
import { handleSaveConfiguration, handleLoadConfiguration, handleGetConfigurations, handleDeleteConfiguration, handleGetDeviceConfigOptions, handleAddDeviceConfigOption, handleUpdateDeviceConfigOption, handleDeleteDeviceConfigOption, handleGetDeviceConfigs } from './discovery.js';
import { handleSaveQuoteConfiguration, handleLoadQuoteConfiguration, handleGetQuoteConfigurations, handleDeleteQuoteConfiguration, handleGetModuleOptions, handleAddModuleOption, handleUpdateModuleOption, handleDeleteModuleOption, handleGetFixtureTypeOptions, handleAddFixtureTypeOption, handleUpdateFixtureTypeOption, handleDeleteFixtureTypeOption, handleGetSwitchOptions, handleAddSwitchOption, handleUpdateSwitchOption, handleDeleteSwitchOption, handleGetPowerSupplyOptions, handleAddPowerSupplyOption, handleUpdatePowerSupplyOption, handleDeletePowerSupplyOption } from './quote.js';
import {
	handleDeleteSmartHomeAssessmentForm,
	handleGetSmartHomeAssessmentForms,
	handleLoadSmartHomeAssessmentForm,
	handleSaveSmartHomeAssessmentForm,
} from './smart_home_assessment_forms.js';
import { handleGetCurrentUser, handleGetAllUsers, handleGetUserById, handleUpdateCurrentUser, handleUpdateThemeMode, handleUpdateUiPreferences, handleUpdateUserRole, handleGetUserRelatedData, handleDeleteUser } from './users.js';
import { handleCreateCustomer, handleGetCustomers, handleGetCustomerById, handleUpdateCustomer, handleDeleteCustomer } from './customers.js';
import { handleGetCases, handleCreateCase, handleGetCaseById, handleUpdateCase, handleDeleteCase, handleGetSnapshots, handleGetSnapshotById, handleCreateSnapshot, handleDeleteSnapshot } from './project_cases.js';
import { requireAdmin, requireNonCustomer, requireSession, requireUser } from './session.js';
import { WorkingStaffHub, broadcastWorkingStaffUpdate, handleWorkingStaffSocket } from './working_staff_hub.js';
import { QuoteSyncHub, handleQuoteSyncSocket } from './quote_sync_hub.js';
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

		await broadcastWorkingStaffUpdate(env, {
			reason: type === 'in' ? 'simple-check-in' : 'simple-check-out',
			userId: String(employeeId),
			workDate: today,
			period: note,
		});

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

function withGuard(guard, handler) {
	return async (request, env) => {
		const auth = await guard(request, env);
		if (auth.response) {
			return auth.response;
		}

		return handler(request, env, auth);
	};
}

async function runWithGuard(guard, request, env, handler, ...args) {
	const auth = await guard(request, env);
	if (auth.response) {
		return auth.response;
	}

	return handler(request, env, ...args, auth);
}

// 路由表
const routes = {
	GET: {
		"/api/health": handleHealth,
		"/api/me": withGuard(requireSession, handleMe),
		"/api/employees": withGuard(requireAdmin, handleEmployees),
		"/api/working-staff": withGuard(requireSession, handleWorkingStaff),
		"/api/working-staff/ws": withGuard(requireSession, handleWorkingStaffSocket),
		"/api/quote-sync/ws": withGuard(requireUser, handleQuoteSyncSocket),
		"/api/attendance/month": withGuard(requireUser, getMonth),
		"/api/configurations": withGuard(requireSession, handleGetConfigurations),
		"/api/configurations/load": withGuard(requireSession, handleLoadConfiguration),
		"/api/quote-configurations": withGuard(requireUser, handleGetQuoteConfigurations),
		"/api/quote-configurations/load": withGuard(requireUser, handleLoadQuoteConfiguration),
		"/api/smart-home-assessment-forms": withGuard(requireNonCustomer, handleGetSmartHomeAssessmentForms),
		"/api/smart-home-assessment-forms/load": withGuard(requireNonCustomer, handleLoadSmartHomeAssessmentForm),
		"/api/module-options": handleGetModuleOptions,
		"/api/power-supply-options": handleGetPowerSupplyOptions,
		"/api/fixture-type-options": handleGetFixtureTypeOptions,
		"/api/switch-options": handleGetSwitchOptions,
		"/api/device-config-options": handleGetDeviceConfigOptions,
		"/api/device-configs": handleGetDeviceConfigs,
		"/api/users/me": withGuard(requireSession, handleGetCurrentUser),
		"/api/users": withGuard(requireAdmin, handleGetAllUsers),
		"/api/customers": withGuard(requireUser, handleGetCustomers),
		"/api/cases": withGuard(requireNonCustomer, handleGetCases),
	},
	POST: {
		"/api/logout": handleLogout,
		"/api/google-login": handleGoogleLogin,
		"/api/cases": withGuard(requireNonCustomer, handleCreateCase),
		"/api/manual-punch": withGuard(requireAdmin, handleManualPunch),
		"/api/employee-manual-punch": withGuard(requireSession, handleEmployeeManualPunch),
		"/api/devtools/manual-punch": async (req, env) => {
			const mod = await import('./attendance.js');
			return mod.devManualPunch(req, env);
		},
		"/api/simple-punch": handleSimplePunch,
		"/api/configurations": withGuard(requireSession, handleSaveConfiguration),
		"/api/quote-configurations": withGuard(requireSession, handleSaveQuoteConfiguration),
		"/api/smart-home-assessment-forms": withGuard(requireNonCustomer, handleSaveSmartHomeAssessmentForm),
		"/api/module-options": withGuard(requireNonCustomer, handleAddModuleOption),
		"/api/power-supply-options": withGuard(requireNonCustomer, handleAddPowerSupplyOption),
		"/api/fixture-type-options": withGuard(requireNonCustomer, handleAddFixtureTypeOption),
		"/api/switch-options": withGuard(requireNonCustomer, handleAddSwitchOption),
		"/api/device-config-options": withGuard(requireNonCustomer, handleAddDeviceConfigOption),
		"/api/customers": withGuard(requireSession, handleCreateCustomer),
	},
	PUT: {
		"/api/attendance/period": withGuard(requireSession, updatePeriodName),
		"/api/users/me": withGuard(requireSession, handleUpdateCurrentUser),
		"/api/users/theme-mode": withGuard(requireSession, handleUpdateThemeMode),
		"/api/users/ui-preferences": withGuard(requireSession, handleUpdateUiPreferences),
		"/api/module-options": withGuard(requireNonCustomer, handleUpdateModuleOption),
		"/api/power-supply-options": withGuard(requireNonCustomer, handleUpdatePowerSupplyOption),
		"/api/fixture-type-options": withGuard(requireNonCustomer, handleUpdateFixtureTypeOption),
		"/api/switch-options": withGuard(requireNonCustomer, handleUpdateSwitchOption),
		"/api/device-config-options": withGuard(requireNonCustomer, handleUpdateDeviceConfigOption),
	},
	DELETE: {
		"/api/configurations": withGuard(requireSession, handleDeleteConfiguration),
		"/api/quote-configurations": withGuard(requireUser, handleDeleteQuoteConfiguration),
		"/api/smart-home-assessment-forms": withGuard(requireNonCustomer, handleDeleteSmartHomeAssessmentForm),
		"/api/module-options": withGuard(requireNonCustomer, handleDeleteModuleOption),
		"/api/power-supply-options": withGuard(requireNonCustomer, handleDeletePowerSupplyOption),
		"/api/fixture-type-options": withGuard(requireNonCustomer, handleDeleteFixtureTypeOption),
		"/api/switch-options": withGuard(requireNonCustomer, handleDeleteSwitchOption),
		"/api/device-config-options": withGuard(requireNonCustomer, handleDeleteDeviceConfigOption),
	},
};

export { QuoteSyncHub, WorkingStaffHub };

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

			// 處理動態路由 /api/cases/:id
			const caseIdMatch = url.pathname.match(/^\/api\/cases\/(\d+)$/);
			if (caseIdMatch) {
				if (request.method === 'GET') {
					return await runWithGuard(requireNonCustomer, request, env, handleGetCaseById, caseIdMatch[1]);
				} else if (request.method === 'PUT') {
					return await runWithGuard(requireNonCustomer, request, env, handleUpdateCase, caseIdMatch[1]);
				} else if (request.method === 'DELETE') {
					return await runWithGuard(requireAdmin, request, env, handleDeleteCase, caseIdMatch[1]);
				}
			}

			// 處理動態路由 /api/cases/:id/snapshots
			const caseSnapshotsMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/snapshots$/);
			if (caseSnapshotsMatch) {
				if (request.method === 'GET') {
					return await runWithGuard(requireNonCustomer, request, env, handleGetSnapshots, caseSnapshotsMatch[1]);
				} else if (request.method === 'POST') {
					return await runWithGuard(requireNonCustomer, request, env, handleCreateSnapshot, caseSnapshotsMatch[1]);
				}
			}

			// 處理動態路由 /api/cases/:id/snapshots/:snapshotId
			const caseSnapshotItemMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/snapshots\/(\d+)$/);
			if (caseSnapshotItemMatch) {
				if (request.method === 'GET') {
					return await runWithGuard(requireNonCustomer, request, env, handleGetSnapshotById, caseSnapshotItemMatch[1], caseSnapshotItemMatch[2]);
				} else if (request.method === 'DELETE') {
					return await runWithGuard(requireNonCustomer, request, env, handleDeleteSnapshot, caseSnapshotItemMatch[1], caseSnapshotItemMatch[2]);
				}
			}

			// 處理動態路由 /api/users/:id
			const userIdMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
			if (userIdMatch) {
				if (request.method === 'GET') {
					return await runWithGuard(requireAdmin, request, env, handleGetUserById, userIdMatch[1]);
				} else if (request.method === 'PATCH') {
					return await runWithGuard(requireAdmin, request, env, handleUpdateUserRole, userIdMatch[1]);
				} else if (request.method === 'DELETE') {
					return await runWithGuard(requireAdmin, request, env, handleDeleteUser, userIdMatch[1]);
				}
			}

			// 處理動態路由 /api/users/:id/related-data
			const userRelatedMatch = url.pathname.match(/^\/api\/users\/(\d+)\/related-data$/);
			if (userRelatedMatch && request.method === 'GET') {
				return await runWithGuard(requireAdmin, request, env, handleGetUserRelatedData, userRelatedMatch[1]);
			}

			// 處理動態路由 /api/customers/:id
			const customerIdMatch = url.pathname.match(/^\/api\/customers\/(\d+)$/);
			if (customerIdMatch) {
				if (request.method === 'GET') {
					return await runWithGuard(requireSession, request, env, handleGetCustomerById, customerIdMatch[1]);
				} else if (request.method === 'PUT') {
					return await runWithGuard(requireSession, request, env, handleUpdateCustomer, customerIdMatch[1]);
				} else if (request.method === 'DELETE') {
					return await runWithGuard(requireSession, request, env, handleDeleteCustomer, customerIdMatch[1]);
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


			// 需要 no-cache 的檔案
			const noCacheFiles = [
				'/index.html',
				'/main.dart.js',
				'/flutter_service_worker.js',
				'/manifest.json',
				'/version.json',
			];
			const isNoCacheFile = noCacheFiles.includes(url.pathname);

			try {
				const response = await getAssetFromKV(
					{ request: assetRequest },
					{
						ASSET_NAMESPACE: env.STATIC_ASSETS,
						cacheControl: {
							browserTTL: isNoCacheFile ? 0 : 60 * 60 * 24 * 30,
							edgeTTL: isNoCacheFile ? 0 : 60 * 60 * 24 * 30,
							bypassCache: false,
						},
					}
				);

				if (isNoCacheFile) {
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
