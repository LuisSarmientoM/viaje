import { json, requirePersistedSession } from "../lib/auth.js";
import { isValidState } from "../../state-validation.js";

const MAX_STATE_BYTES = 900_000;

async function getTrip(env) {
  return env.DB.prepare(
    "SELECT state_json, version, updated_at FROM trip_state WHERE trip_id = ?",
  )
    .bind(env.TRIP_ID || "default")
    .first();
}

function parseStoredState(value) {
  try {
    const state = JSON.parse(value);
    return isValidState(state) ? state : null;
  } catch {
    return null;
  }
}

export const onRequestGet = async ({ request, env }) => {
  const auth = await requirePersistedSession(request, env);
  if (auth.response) return auth.response;

  const row = await getTrip(env);
  if (!row) return json({ state: null, version: 0, updatedAt: null });
  const state = parseStoredState(row.state_json);
  if (!state) return json({ error: "El viaje guardado no es válido." }, 500);

  return json({ state, version: row.version, updatedAt: row.updated_at });
};

export const onRequestPut = async ({ request, env }) => {
  const auth = await requirePersistedSession(request, env);
  if (auth.response) return auth.response;

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_STATE_BYTES)
    return json({ error: "El viaje supera el tamaño permitido." }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "El cuerpo de la solicitud no es JSON válido." }, 400);
  }

  if (!isValidState(body?.state))
    return json({ error: "La estructura del viaje no es válida." }, 400);

  const stateJson = JSON.stringify(body.state);
  if (new TextEncoder().encode(stateJson).byteLength > MAX_STATE_BYTES) {
    return json({ error: "El viaje supera el tamaño permitido." }, 413);
  }

  const expectedVersion = Number.isInteger(body.expectedVersion)
    ? body.expectedVersion
    : 0;
  const current = await getTrip(env);
  if (current && current.version !== expectedVersion) {
    const currentState = parseStoredState(current.state_json);
    if (!currentState)
      return json({ error: "El viaje guardado no es válido." }, 500);
    return json(
      {
        error: "El viaje cambió en otro dispositivo.",
        conflict: true,
        state: currentState,
        version: current.version,
        updatedAt: current.updated_at,
      },
      409,
    );
  }

  const now = new Date().toISOString();
  if (!current) {
    try {
      await env.DB.prepare(
        `INSERT INTO trip_state (trip_id, state_json, version, updated_at)
         VALUES (?, ?, 1, ?)`,
      )
        .bind(env.TRIP_ID || "default", stateJson, now)
        .run();
    } catch (error) {
      const latest = await getTrip(env);
      if (latest) {
        const latestState = parseStoredState(latest.state_json);
        if (!latestState)
          return json({ error: "El viaje guardado no es válido." }, 500);
        return json(
          {
            error: "El viaje cambió en otro dispositivo.",
            conflict: true,
            state: latestState,
            version: latest.version,
            updatedAt: latest.updated_at,
          },
          409,
        );
      }
      throw error;
    }
    return json({ ok: true, version: 1, updatedAt: now });
  }

  const nextVersion = current.version + 1;
  const result = await env.DB.prepare(
    `UPDATE trip_state
     SET state_json = ?, version = ?, updated_at = ?
     WHERE trip_id = ? AND version = ?`,
  )
    .bind(
      stateJson,
      nextVersion,
      now,
      env.TRIP_ID || "default",
      expectedVersion,
    )
    .run();

  if (!result.meta || result.meta.changes !== 1) {
    const latest = await getTrip(env);
    const latestState = latest ? parseStoredState(latest.state_json) : null;
    if (latest && !latestState)
      return json({ error: "El viaje guardado no es válido." }, 500);
    return json(
      {
        error: "El viaje cambió en otro dispositivo.",
        conflict: true,
        state: latestState,
        version: latest?.version || 0,
        updatedAt: latest?.updated_at || null,
      },
      409,
    );
  }

  return json({ ok: true, version: nextVersion, updatedAt: now });
};
