import { DurableObject } from 'cloudflare:workers';

const HUB_NAME = 'working-staff';

function getWorkingStaffHub(env) {
	return env.WORKING_STAFF_HUB.getByName(HUB_NAME);
}

export async function handleWorkingStaffSocket(request, env, auth) {
	const headers = new Headers(request.headers);
	headers.set('x-user-id', String(auth.session.user_id));

	const url = new URL(request.url);
	url.searchParams.set('user_id', String(auth.session.user_id));

	return getWorkingStaffHub(env).fetch(new Request(url.toString(), {
		method: request.method,
		headers,
	}));
}

export async function broadcastWorkingStaffUpdate(env, payload = {}) {
	if (!env.WORKING_STAFF_HUB) {
		return;
	}

	try {
		await getWorkingStaffHub(env).broadcastWorkingStaffUpdate({
			type: 'working-staff-updated',
			at: payload.at || new Date().toISOString(),
			...payload,
		});
	} catch (error) {
		console.error('working staff broadcast failed:', error);
	}
}

export class WorkingStaffHub extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair('ping', 'pong')
		);
	}

	async fetch(request) {
		if (request.method !== 'GET') {
			return new Response('Method Not Allowed', { status: 405 });
		}

		const upgradeHeader = request.headers.get('Upgrade');
		if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
			return new Response('Expected Upgrade: websocket', { status: 426 });
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);
		const userId =
			request.headers.get('x-user-id') ||
			new URL(request.url).searchParams.get('user_id') ||
			null;
		const connectionId = crypto.randomUUID();
		const attachment = { connectionId, userId };

		if (userId) {
			this.ctx.acceptWebSocket(server, [`user:${userId}`]);
		} else {
			this.ctx.acceptWebSocket(server);
		}

		server.serializeAttachment(attachment);
		server.send(JSON.stringify({
			type: 'working-staff-subscribed',
			at: new Date().toISOString(),
			connectionId,
		}));

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async broadcastWorkingStaffUpdate(payload = {}) {
		const message = JSON.stringify({
			type: 'working-staff-updated',
			at: payload.at || new Date().toISOString(),
			...payload,
		});
		const sockets = this.ctx.getWebSockets();
		let delivered = 0;

		for (const ws of sockets) {
			try {
				ws.send(message);
				delivered += 1;
			} catch (error) {
				console.warn('dropping working staff websocket:', error);
				try {
					ws.close(1011, 'Unable to deliver update');
				} catch {
					// Ignore close failures on stale sockets.
				}
			}
		}

		return {
			ok: true,
			delivered,
			connected: sockets.length,
		};
	}

	async webSocketMessage(ws, message) {
		if (message === 'refresh') {
			ws.send(JSON.stringify({
				type: 'working-staff-refetch',
				at: new Date().toISOString(),
			}));
		}
	}

	async webSocketClose(ws, code, reason) {
		try {
			ws.close(code, reason);
		} catch {
			// Ignore close handshake errors on already-closed sockets.
		}
	}

	async webSocketError(ws, error) {
		const attachment = ws.deserializeAttachment();
		console.error('working staff websocket error:', attachment, error);
		try {
			ws.close(1011, 'WebSocket error');
		} catch {
			// Ignore close failures on broken sockets.
		}
	}
}
