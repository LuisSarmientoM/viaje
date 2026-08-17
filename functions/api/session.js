import {
  createSessionCookie,
  isValidInvite,
  json,
  readSession,
} from '../lib/auth.js';

async function createBootstrapResponse(invite, env) {
  if (!(await isValidInvite(invite, env.INVITE_TOKEN))) {
    return json({ error: 'Token de invitación incorrecto.' }, 401);
  }

  const created = await createSessionCookie(env.SESSION_SECRET);
  return json(
    { canPersist: false, bootstrap: true, reloadRequired: true },
    200,
    { 'Set-Cookie': created.header },
  );
}

export const onRequestGet = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET || !env.INVITE_TOKEN || env.SESSION_SECRET.length < 32 || env.INVITE_TOKEN.length < 32) {
    return json({ error: 'La función no está configurada todavía.' }, 503);
  }

  const currentSession = await readSession(request, env.SESSION_SECRET);
  if (currentSession) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO sessions (session_id, first_seen_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    ).bind(
      currentSession.sid,
      new Date(currentSession.iat * 1000).toISOString(),
      now,
      new Date(currentSession.exp * 1000).toISOString(),
    ).run();

    return json({ canPersist: true, session: true });
  }

  const invite = new URL(request.url).searchParams.get('invite');
  if (!invite) return json({ error: 'Se necesita un token de invitación para activar este viaje.' }, 401);
  return createBootstrapResponse(invite, env);
};

export const onRequestPost = async ({ request, env }) => {
  if (!env.DB || !env.SESSION_SECRET || !env.INVITE_TOKEN || env.SESSION_SECRET.length < 32 || env.INVITE_TOKEN.length < 32) {
    return json({ error: 'La función no está configurada todavía.' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Solicitud inválida.' }, 400); }
  return createBootstrapResponse(String(body?.invite || ''), env);
};
