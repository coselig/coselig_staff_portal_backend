import { jsonResponse } from './utils.js';

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function ensureSmartHomeAssessmentFormsTable(env) {
	await env.DB.batch([
		env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS smart_home_assessment_forms (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name TEXT NOT NULL UNIQUE,
				form_data TEXT NOT NULL,
				created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))),
				updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours')))
			)
		`),
		env.DB.prepare(`
			CREATE INDEX IF NOT EXISTS idx_smart_home_assessment_forms_user_id
			ON smart_home_assessment_forms(user_id)
		`),
	]);
}

export async function handleGetSmartHomeAssessmentForms(request, env) {
	try {
		await ensureSmartHomeAssessmentFormsTable(env);
		const forms = await env.DB
			.prepare(`
				SELECT
					shaf.id,
					shaf.user_id,
					shaf.name,
					shaf.form_data,
					shaf.created_at,
					shaf.updated_at,
					u.chinese_name,
					u.name AS user_name
				FROM smart_home_assessment_forms shaf
				LEFT JOIN users u ON shaf.user_id = u.id
				ORDER BY shaf.updated_at DESC, shaf.id DESC
			`)
			.all();

		return jsonResponse({ forms: forms.results }, 200, request);
	} catch (err) {
		console.error('Get smart home assessment forms error:', err);
		return jsonResponse(
			{ error: 'Internal Server Error', detail: err?.message ?? String(err) },
			500,
			request,
		);
	}
}

export async function handleLoadSmartHomeAssessmentForm(request, env) {
	try {
		await ensureSmartHomeAssessmentFormsTable(env);
		const url = new URL(request.url);
		const name = url.searchParams.get('name')?.trim();

		if (!name) {
			return jsonResponse({ error: 'Form name is required' }, 400, request);
		}

		const form = await env.DB
			.prepare(
				'SELECT id, user_id, name, form_data, created_at, updated_at FROM smart_home_assessment_forms WHERE name = ?',
			)
			.bind(name)
			.first();

		if (!form) {
			return jsonResponse({ error: 'Form not found' }, 404, request);
		}

		return jsonResponse(
			{
				form: {
					id: form.id,
					userId: form.user_id,
					name: form.name,
					formData: JSON.parse(form.form_data),
					createdAt: form.created_at,
					updatedAt: form.updated_at,
				},
			},
			200,
			request,
		);
	} catch (err) {
		console.error('Load smart home assessment form error:', err);
		return jsonResponse(
			{ error: 'Internal Server Error', detail: err?.message ?? String(err) },
			500,
			request,
		);
	}
}

export async function handleSaveSmartHomeAssessmentForm(request, env, auth) {
	try {
		await ensureSmartHomeAssessmentFormsTable(env);
		const body = await request.json().catch(() => null);
		const name = body?.name?.trim();
		const formData = body?.formData;

		if (!name) {
			return jsonResponse({ error: 'Missing required field: name' }, 400, request);
		}
		if (!isPlainObject(formData)) {
			return jsonResponse(
				{ error: 'Missing required field: formData (must be a JSON object)' },
				400,
				request,
			);
		}

		const existing = await env.DB
			.prepare('SELECT id FROM smart_home_assessment_forms WHERE name = ?')
			.bind(name)
			.first();

		if (existing) {
			await env.DB
				.prepare(`
					UPDATE smart_home_assessment_forms
					SET form_data = ?, updated_at = strftime('%Y-%m-%d %H:%M:%S', datetime('now', '+8 hours'))
					WHERE name = ?
				`)
				.bind(JSON.stringify(formData), name)
				.run();
		} else {
			await env.DB
				.prepare(`
					INSERT INTO smart_home_assessment_forms (user_id, name, form_data)
					VALUES (?, ?, ?)
				`)
				.bind(auth.session.user_id, name, JSON.stringify(formData))
				.run();
		}

		const savedForm = await env.DB
			.prepare('SELECT id, name FROM smart_home_assessment_forms WHERE name = ?')
			.bind(name)
			.first();

		return jsonResponse(
			{
				ok: true,
				message: 'Smart home assessment form saved successfully',
				formId: savedForm?.id ?? existing?.id ?? null,
				name: savedForm?.name ?? name,
			},
			200,
			request,
		);
	} catch (err) {
		console.error('Save smart home assessment form error:', err);
		return jsonResponse(
			{ error: 'Internal Server Error', detail: err?.message ?? String(err) },
			500,
			request,
		);
	}
}

export async function handleDeleteSmartHomeAssessmentForm(request, env) {
	try {
		await ensureSmartHomeAssessmentFormsTable(env);
		const url = new URL(request.url);
		const name = url.searchParams.get('name')?.trim();

		if (!name) {
			return jsonResponse({ error: 'Form name is required' }, 400, request);
		}

		const result = await env.DB
			.prepare('DELETE FROM smart_home_assessment_forms WHERE name = ?')
			.bind(name)
			.run();

		if (result.changes === 0) {
			return jsonResponse({ error: 'Form not found' }, 404, request);
		}

		return jsonResponse(
			{ ok: true, message: 'Smart home assessment form deleted successfully' },
			200,
			request,
		);
	} catch (err) {
		console.error('Delete smart home assessment form error:', err);
		return jsonResponse(
			{ error: 'Internal Server Error', detail: err?.message ?? String(err) },
			500,
			request,
		);
	}
}
