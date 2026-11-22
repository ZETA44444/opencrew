# Servidor de OpenCrew

Ejecuta el mismo motor que la app web, pero **24/7**: tus rutinas y vigilantes siguen funcionando
aunque cierres el navegador, y tus bots, chats y claves viven en un solo sitio para todos tus dispositivos.

- Sin dependencias: Node 22 + Docker. HTTPS automático con Caddy.
- Datos en `server/data/db.json` (con copias diarias en `server/data/backups/`, se guardan 7).
- Acceso protegido con un token secreto (`OPENCREW_TOKEN`).
- `run_javascript` se ejecuta en contenedores desechables sin red, sin privilegios y con poca memoria.

## Instalar (Ubuntu con Docker)

```bash
git clone https://github.com/ZETA44444/opencrew.git ~/opencrew
cd ~/opencrew/server
printf 'OPENCREW_TOKEN=%s\nOPENCREW_HOST=%s\n' "$(openssl rand -hex 32)" "TU-IP-CON-GUIONES.sslip.io" > .env
chmod 600 .env
docker pull node:22-alpine
docker compose up -d --build
```

Sin dominio propio puedes usar `sslip.io`: para la IP `1.2.3.4` la dirección es `1-2-3-4.sslip.io`.

## Conectar la app

En la app: **Ajustes → Servidor**, pon `https://TU-HOST` y el token (`grep TOKEN ~/opencrew/server/.env`),
pulsa **Probar** y luego **Conectar**. La primera vez puedes subir los bots y claves de tu navegador.

## Actualizar

```bash
~/opencrew/server/update.sh
```

## Google sin caducar (opcional)

1. En Google Cloud → Credenciales → tu «ID de cliente de OAuth» (aplicación web):
   añade en **URIs de redireccionamiento autorizados**: `https://TU-HOST/oauth/google/callback`.
2. Copia el **Secreto del cliente** de esa misma pantalla.
3. En tu Mac (te pedirá pegarlo; no se muestra):
   `ssh -t opencrew 'read -rsp "Secreto: " S; echo; sed -i "/^GOOGLE_CLIENT_SECRET=/d" ~/opencrew/server/.env; echo "GOOGLE_CLIENT_SECRET=$S" >> ~/opencrew/server/.env; ~/opencrew/server/update.sh >/dev/null && echo Listo'`
4. En «Pantalla de consentimiento de OAuth», pulsa **Publicar aplicación** (estado «En producción»). En modo «Prueba» Google corta la sesión a los 7 días.
5. En la app: Apps conectadas → **Conectar con Google (sin caducar)**.

## Webhooks

Crea un vigilante de tipo **Webhook** en el panel de un bot: te da una dirección `https://TU-HOST/hooks/…` y una clave.
En GitHub: Settings → Webhooks → Payload URL = esa dirección, Content type `application/json`, Secret = la clave.
