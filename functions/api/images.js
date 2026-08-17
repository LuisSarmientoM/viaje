import { json, requirePersistedSession } from "../lib/auth.js";
import {
  MAX_IMAGE_BYTES,
  detectImageType,
  hasSameOrigin,
  imageKey,
} from "../lib/images.js";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const onRequestPost = async ({ request, env }) => {
  const auth = await requirePersistedSession(request, env);
  if (auth.response) return auth.response;
  if (!env.IMAGES)
    return json({ error: "El almacenamiento de imágenes no está configurado." }, 503);
  if (!hasSameOrigin(request))
    return json({ error: "El origen de la solicitud no es válido." }, 403);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_IMAGE_BYTES)
    return json({ error: "La imagen supera el máximo de 5 MiB." }, 413);

  const declaredType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!ACCEPTED_TYPES.has(declaredType))
    return json({ error: "Usa una imagen JPEG, PNG o WebP." }, 415);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES)
    return json({ error: "La imagen supera el máximo de 5 MiB." }, 413);

  const detectedType = detectImageType(bytes);
  if (!detectedType || detectedType !== declaredType)
    return json({ error: "El contenido no coincide con una imagen JPEG, PNG o WebP válida." }, 415);

  const imageId = crypto.randomUUID();
  const key = imageKey(env, imageId);
  if (!key)
    return json({ error: "La configuración del viaje no es válida." }, 503);

  await env.IMAGES.put(key, bytes, {
    httpMetadata: { contentType: detectedType },
  });
  return json({ imageId }, 201);
};
