const COOKIE_NAME = '__Host-europa_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodePayload(value) {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

function decodePayload(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
}

async function hmacSign(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function hmacVerify(value, signature, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return crypto.subtle.verify('HMAC', key, base64UrlDecode(signature), encoder.encode(value));
}

function parseCookies(header) {
  const cookies = {};
  for (const item of (header || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

function cookieHeader(value) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export async function createSessionCookie(secret) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');

  const now = Math.floor(Date.now() / 1000);
  const payload = { sid: crypto.randomUUID(), iat: now, exp: now + COOKIE_MAX_AGE };
  const encodedPayload = encodePayload(payload);
  const signature = await hmacSign(encodedPayload, secret);

  return {
    payload,
    header: cookieHeader(`${encodedPayload}.${signature}`),
  };
}

export async function readSession(request, secret) {
  if (!secret) return null;
  const value = parseCookies(request.headers.get('Cookie'))[COOKIE_NAME];
  if (!value) return null;

  const [encodedPayload, signature] = value.split('.');
  if (!encodedPayload || !signature) return null;

  try {
    if (!(await hmacVerify(encodedPayload, signature, secret))) return null;
    const payload = decodePayload(encodedPayload);
    const now = Math.floor(Date.now() / 1000);
    if (!payload?.sid || !Number.isInteger(payload.exp) || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function isValidInvite(candidate, expected) {
  if (!candidate || !expected) return false;
  const [candidateHash, expectedHash] = await Promise.all([digest(candidate), digest(expected)]);
  return timingSafeEqual(candidateHash, expectedHash);
}

export async function requirePersistedSession(request, env) {
  if (!env.DB || !env.SESSION_SECRET) {
    return { response: json({ error: 'La función no está configurada todavía.' }, 503) };
  }
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return { response: json({ error: 'Sesión no válida' }, 401) };

  const row = await env.DB.prepare(
    'SELECT session_id FROM sessions WHERE session_id = ? AND expires_at > ?',
  ).bind(session.sid, new Date().toISOString()).first();

  if (!row) {
    return { response: json({ error: 'La sesión aún no ha sido activada. Vuelve a cargar la página.' }, 428) };
  }

  return { session };
}

export { COOKIE_NAME, COOKIE_MAX_AGE, cookieHeader, json };
