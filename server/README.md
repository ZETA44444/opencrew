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
