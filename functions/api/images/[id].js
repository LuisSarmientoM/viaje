import { json, requirePersistedSession } from "../../lib/auth.js";
import { imageKey } from "../../lib/images.js";

export const onRequestGet = async ({ request, env, params }) => {
  const auth = await requirePersistedSession(request, env);
  if (auth.response) return auth.response;
  if (!env.IMAGES)
    return json({ error: "El almacenamiento de imágenes no está configurado." }, 503);

  const key = imageKey(env, params.id);
  if (!key) return json({ error: "Identificador de imagen no válido." }, 400);

  const object = await env.IMAGES.get(key);
  if (!object) return json({ error: "Imagen no encontrada." }, 404);
  const contentType = object.httpMetadata?.contentType;
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType))
    return json({ error: "La imagen almacenada no es válida." }, 500);

  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
};
