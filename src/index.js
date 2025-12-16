export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type"
		};

		// 處理 preflight OPTIONS
		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		async function hashPassword(password) {
			const enc = new TextEncoder();
			const data = enc.encode(password);
			const hashBuffer = await crypto.subtle.digest('SHA-256', data);
			return Array.from(new Uint8Array(hashBuffer))
				.map(b => b.toString(16).padStart(2, '0'))
				.join('');
		}

		if (url.pathname === "/api/login" && request.method === "POST") {
			const { username, password } = await request.json();

			const user = await env.D1.prepare("SELECT * FROM users WHERE username=?").get(username);
			if (!user) return new Response(JSON.stringify({ error: "帳號不存在" }), {
				status: 401,
				headers: corsHeaders
			});

			const valid = await hashPassword(password) === user.password_hash;
			if (!valid) return new Response(JSON.stringify({ error: "密碼錯誤" }), {
				status: 401,
				headers: corsHeaders
			});

			const session_id = crypto.randomUUID();
			const expires_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

			await env.D1.prepare("INSERT INTO sessions(id, user_id, expires_at) VALUES(?, ?, ?)")
				.run(session_id, user.id, expires_at);

			return new Response(JSON.stringify({ user: { id: user.id, username: user.username, role: user.role } }), {
				status: 200,
				headers: { ...corsHeaders, "Set-Cookie": `session_id=${session_id}; HttpOnly; Secure; SameSite=Lax; Path=/` }
			});
		}

		return new Response("Worker is running", { headers: corsHeaders });
	}
};
