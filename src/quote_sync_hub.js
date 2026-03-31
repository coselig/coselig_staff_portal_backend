import { DurableObject } from 'cloudflare:workers';

const HUB_NAME = 'quote-sync';

function getQuoteSyncHub(env) {
	return env.QUOTE_SYNC_HUB.getByName(HUB_NAME);
}

function normalizeQuoteId(value) {
	const parsed = Number.parseInt(String(value ?? '').trim(), 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null;
	}

	return parsed;
}

function normalizeUserIds(values = []) {
	return [...new Set(
		values
			.filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
			.map((value) => String(value))
		)];
}

function normalizeUserRole(value) {
	const normalized = String(value ?? '').trim();
	return normalized || null;
}

function canAccessQuote(quote, userId, userRole) {
	if (!quote || !userId || !userRole) {
		return false;
	}

	if (userRole === 'customer') {
		return Number(quote.customer_user_id) === Number(userId);
	}

	return true;
}

async function loadAccessibleQuote(env, quoteId, userId, userRole) {
	const normalizedQuoteId = normalizeQuoteId(quoteId);
	if (!normalizedQuoteId) {
		return null;
	}

	const quote = await env.DB
		.prepare('SELECT id, name, user_id, customer_user_id FROM quote_configurations WHERE id = ?')
		.bind(normalizedQuoteId)
		.first();

	if (!canAccessQuote(quote, userId, userRole)) {
		return null;
	}

	return quote;
}

export async function handleQuoteSyncSocket(request, env, auth) {
	const headers = new Headers(request.headers);
	headers.set('x-user-id', String(auth.session.user_id));
	headers.set('x-user-role', String(auth.user.role));

	const url = new URL(request.url);
	url.searchParams.set('user_id', String(auth.session.user_id));
	url.searchParams.set('user_role', String(auth.user.role));

	return getQuoteSyncHub(env).fetch(new Request(url.toString(), {
		method: request.method,
		headers,
	}));
}

export async function broadcastQuoteConfigurationsUpdate(env, payload = {}) {
	if (!env.QUOTE_SYNC_HUB) {
		return;
	}

	try {
			await getQuoteSyncHub(env).broadcastQuoteConfigurationsUpdate({
				type: 'quote-configurations-updated',
				at: payload.at || new Date().toISOString(),
				action: payload.action || 'updated',
				quoteId: normalizeQuoteId(payload.quoteId),
				quoteName: payload.quoteName || null,
				userIds: normalizeUserIds(payload.userIds),
			});
	} catch (error) {
		console.error('quote configurations broadcast failed:', error);
	}
}

export class QuoteSyncHub extends DurableObject {
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
		const userRole =
			normalizeUserRole(request.headers.get('x-user-role')) ||
			normalizeUserRole(new URL(request.url).searchParams.get('user_role')) ||
			null;
		const connectionId = crypto.randomUUID();
		const attachment = {
			connectionId,
			userId,
			userRole,
			activeQuoteId: null,
		};

		if (userId) {
			this.ctx.acceptWebSocket(server, [`user:${userId}`]);
		} else {
			this.ctx.acceptWebSocket(server);
		}

		server.serializeAttachment(attachment);
		server.send(JSON.stringify({
			type: 'quote-sync-subscribed',
			at: new Date().toISOString(),
			connectionId,
		}));

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async broadcastQuoteConfigurationsUpdate(payload = {}) {
		const sockets = this.ctx.getWebSockets();
		const targetUserIds = normalizeUserIds(payload.userIds);
		const message = JSON.stringify({
			type: 'quote-configurations-updated',
			action: payload.action || 'updated',
			quoteId: normalizeQuoteId(payload.quoteId),
			quoteName: payload.quoteName || null,
			at: payload.at || new Date().toISOString(),
		});
		let delivered = 0;

		for (const ws of sockets) {
			const attachment = ws.deserializeAttachment() || {};
			if (
				targetUserIds.length > 0 &&
				!targetUserIds.includes(String(attachment.userId ?? ''))
			) {
				continue;
			}

			try {
				ws.send(message);
				delivered += 1;
			} catch (error) {
				console.warn('dropping quote config websocket:', error);
				try {
					ws.close(1011, 'Unable to deliver quote config update');
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
		if (typeof message !== 'string') {
			return;
		}

		let payload;
		try {
			payload = JSON.parse(message);
		} catch {
			return;
		}

		if (!payload || typeof payload !== 'object') {
			return;
		}

		const attachment = ws.deserializeAttachment() || {};
		const type = payload.type;

		if (type === 'subscribe-quote-form') {
			const activeQuoteId = normalizeQuoteId(payload.quoteId);
			const quote = await loadAccessibleQuote(
				this.env,
				activeQuoteId,
				attachment.userId,
				attachment.userRole,
			);

			if (!quote) {
				ws.serializeAttachment({
					...attachment,
					activeQuoteId: null,
				});
				ws.send(JSON.stringify({
					type: 'quote-form-access-denied',
					quoteId: activeQuoteId,
					at: new Date().toISOString(),
				}));
				return;
			}

			ws.serializeAttachment({
				...attachment,
				activeQuoteId: quote.id,
			});

			ws.send(JSON.stringify({
				type: 'quote-form-subscribed',
				quoteId: quote.id,
				quoteName: quote.name,
				at: new Date().toISOString(),
			}));
			return;
		}

		if (type === 'unsubscribe-quote-form') {
			ws.serializeAttachment({
				...attachment,
				activeQuoteId: null,
			});
			return;
		}

		if (type === 'quote-form-snapshot') {
			const requestedQuoteId =
				normalizeQuoteId(payload.quoteId) ||
				normalizeQuoteId(attachment.activeQuoteId);

			if (!requestedQuoteId || !payload.quoteData) {
				return;
			}

			const quote = await loadAccessibleQuote(
				this.env,
				requestedQuoteId,
				attachment.userId,
				attachment.userRole,
			);

			if (!quote) {
				ws.serializeAttachment({
					...attachment,
					activeQuoteId: null,
				});
				ws.send(JSON.stringify({
					type: 'quote-form-access-denied',
					quoteId: requestedQuoteId,
					at: new Date().toISOString(),
				}));
				return;
			}

			ws.serializeAttachment({
				...attachment,
				activeQuoteId: quote.id,
			});

			const broadcastMessage = JSON.stringify({
				type: 'quote-form-snapshot',
				quoteId: quote.id,
				quoteName: quote.name,
				quoteData: payload.quoteData,
				sourceUserId: attachment.userId || null,
				at: new Date().toISOString(),
			});

			for (const target of this.ctx.getWebSockets()) {
				const targetAttachment = target.deserializeAttachment() || {};
				if (
					targetAttachment.connectionId === attachment.connectionId ||
					normalizeQuoteId(targetAttachment.activeQuoteId) !== quote.id
				) {
					continue;
				}

				if (!canAccessQuote(quote, targetAttachment.userId, targetAttachment.userRole)) {
					target.serializeAttachment({
						...targetAttachment,
						activeQuoteId: null,
					});
					try {
						target.send(JSON.stringify({
							type: 'quote-form-access-denied',
							quoteId: quote.id,
							at: new Date().toISOString(),
						}));
					} catch {
						// Ignore delivery failures on stale sockets.
					}
					continue;
				}

				try {
					target.send(broadcastMessage);
				} catch (error) {
					console.warn('dropping quote form websocket:', error);
					try {
						target.close(1011, 'Unable to deliver quote form update');
					} catch {
						// Ignore close failures on stale sockets.
					}
				}
			}
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
		console.error('quote sync websocket error:', attachment, error);
		try {
			ws.close(1011, 'WebSocket error');
		} catch {
			// Ignore close failures on broken sockets.
		}
	}
}
