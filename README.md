# Planificador de viaje a Europa

Aplicación estática de una sola página con respaldo compartido opcional mediante Cloudflare Pages Functions y D1.

<img width="1920" height="1440" alt="859shots_so" src="https://github.com/user-attachments/assets/2d4748db-07ac-48b6-8389-ea0088726461" />


## Comportamiento de la sesión

1. Sin cookie válida, la aplicación funciona únicamente con `localStorage`.
2. El primer acceso puede activarse desde el botón **Activar respaldo**, introduciendo el token privado. También se admite un enlace de invitación:

   `https://TU_PROYECTO.pages.dev/?invite=TU_INVITE_TOKEN`

3. El servidor responde con una cookie `__Host-europa_session` firmada, `HttpOnly`, `Secure` y `SameSite=Lax`.
4. La aplicación elimina el token de invitación de la URL y recarga la página.
5. En esa segunda carga, ya con la cookie, se crea la sesión en D1 y se habilita la sincronización.

El token de invitación no se guarda en el navegador ni en D1. La cookie contiene un identificador firmado; el secreto de firma nunca se envía al cliente. La activación mediante botón evita dejar el token en el historial o en la URL.

## Configuración local

Requisitos: Node.js y Wrangler.

```bash
cp .dev.vars.example .dev.vars
npx wrangler d1 create viaje
npx wrangler r2 bucket create viaje-images
```

Copia el `database_id` que devuelva Wrangler dentro de `wrangler.jsonc`, reemplazando:

```json
"REEMPLAZAR_CON_D1_DATABASE_ID"
```

Aplica la migración localmente:

```bash
npx wrangler d1 migrations apply viaje --local
```

Para probar Pages Functions localmente:

```bash
npx wrangler pages dev . --persist-to=./.wrangler/state
```

Abre la URL que indique Wrangler y añade `?invite=` con el mismo valor de `INVITE_TOKEN` de `.dev.vars`.

## Despliegue en Cloudflare Pages

1. Crea el proyecto Pages conectado a este repositorio o usa Wrangler.
2. Configura `database_id` en `wrangler.jsonc` y crea el bucket privado `viaje-images` si todavía no existe:

   ```bash
   npx wrangler r2 bucket create viaje-images
   ```

3. Crea la base de datos remota y aplica la migración:

   ```bash
   npx wrangler d1 migrations apply viaje --remote
   ```

4. Guarda los secretos en Pages; no los incluyas en el repositorio:

   ```bash
   printf '%s' 'un-secreto-aleatorio-de-al-menos-32-caracteres' | npx wrangler pages secret put SESSION_SECRET --project-name=viaje
   printf '%s' 'un-token-de-invitacion-largo-y-aleatorio' | npx wrangler pages secret put INVITE_TOKEN --project-name=viaje
   ```

5. Despliega el contenido del proyecto:

   ```bash
   npx wrangler pages deploy . --project-name=viaje
   ```

Comparte el enlace con `?invite=...` únicamente con las personas que deban acceder al viaje. Después del primer acceso, el parámetro se elimina automáticamente de la barra del navegador.

## Notas

- D1 almacena el viaje como un documento JSON versionado; la tabla de sesiones mantiene el control de acceso.
- R2 almacena las portadas en el bucket privado `viaje-images`. Tanto la subida como la lectura pasan por Pages Functions y exigen una sesión persistida.
- Al reemplazar o eliminar una portada, el objeto anterior puede quedar sin referencia en R2. No hay limpieza automática de huérfanos; debe añadirse solo si el volumen lo justifica.
- Las actualizaciones tienen control optimista de versiones. Si los dos dispositivos guardan a la vez, se conserva la versión remota y se muestra un aviso.
- `SESSION_SECRET` e `INVITE_TOKEN` deben ser secretos diferentes y aleatorios.
- Para revocar el acceso, cambia `SESSION_SECRET` y vuelve a desplegar; las cookies anteriores dejarán de ser válidas.
