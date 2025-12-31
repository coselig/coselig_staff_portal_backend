/**
 * Cloudflare Worker - 完整登入 + Session 範例
 */

import { corsHeaders, jsonResponse, generateSessionId, setCookie } from './utils.js';
import { handleLogin, handleMe, handleLogout, handleRegister } from './auth.js';
import { handleEmployees, handleWorkingStaff } from './employees.js';
import { handleManualPunch, checkIn, checkOut, getToday, getMonth } from './attendance.js';

// Handler functions
async function handleHealth(request, env) {
	return jsonResponse({ ok: true, message: "Worker is alive" }, 200, request);
}

// 路由表
const routes = {
	GET: {
		"/api/health": handleHealth,
		"/api/me": handleMe,
		"/api/employees": handleEmployees,
		"/api/working-staff": handleWorkingStaff,
		"/api/attendance/month": getMonth,
	},
	POST: {
		"/api/login": handleLogin,
		"/api/logout": handleLogout,
		"/api/register": handleRegister,
		"/api/manual-punch": handleManualPunch,
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
			return jsonResponse({ error: "Not Found" }, 404, request);
		} catch (err) {
			return jsonResponse({ error: "Internal Server Error", detail: err?.message ?? String(err) }, 500, request);
		}
	},
};