# Estado de OpenCrew (para retomar en cualquier sesión)

Última actualización: 24 nov 2026. Qué sigue: ver [ROADMAP.md](../ROADMAP.md) — **Fase M (MVP)** primero.
Legal (condiciones de las IAs, RGPD, Ley de IA) y economía del MVP: [LANZAMIENTO.md](LANZAMIENTO.md).
Auditoría y modelo de negocio: [AUDITORIA.md](AUDITORIA.md). Cómo repetir la auditoría: [AUDITORIA_PROMPT.md](AUDITORIA_PROMPT.md).

## Dónde está todo

- Código: este repositorio (`github.com/ZETA44444/opencrew`, rama `main`).
- App publicada: GitHub Pages (`https://zeta44444.github.io/opencrew/`, modo local/autoalojado) y servida por el
  propio servidor en `https://2-25-19-252.sslip.io` (modo alojado con cuentas). Falta dominio propio (B1).
- Servidor: VPS Hostinger KVM 2 (Ubuntu 24.04, IP 2.25.19.252). Acceso: `ssh opencrew` (usuario `opencrew`,
  clave `~/.ssh/opencrew_hostinger`). Carpeta: `~/opencrew/server`. Secretos en `~/opencrew/server/.env`
  (OPENCREW_TOKEN, OPENCREW_SECRET_KEY = clave maestra de cifrado, LAUNCHER_KEY, GATEWAY_SETUP_CODE, OPENCREW_HOST).
  Nunca imprimir secretos en el chat; usar `… | pbcopy` si el usuario los necesita.

## Servicios en el servidor (`server/compose.yml`)

| Servicio | Qué hace |
|---|---|
| `caddy` | HTTPS, sirve la app (`server/web`, rama gh-pages) con CSP; `/api`, `/hooks`, `/oauth` → `gateway` |
| `gateway` (`gateway/`) | Cuentas (18+ y condiciones aceptadas), sesiones (cookie), invitaciones, admin, planes y créditos; enruta a motores; IA de OpenCrew en `/ai/` (interna: claves de empresa `OC_AI_*_KEY` en `server/ai.env`, solo la pasarela, con `server/poner-clave.sh`, cobra el coste real de cada llamada) |
| `opencrew` (`server/index.mjs`) | Motor del dueño (usuario `owner`), sin privilegios, datos cifrados en `server/data` |
| `opencrew-engine-<id>` | Motor aislado por usuario, creado por el lanzador (volumen `opencrew-data-<id>`) |
| `launcher` (`server/launcher.mjs`) | Único con Docker: ordenadores de bots, sandbox, motores por usuario (operaciones fijas) |
| red `opencrew-pcs` | Ordenadores de bots: sin comunicación entre ellos; cortafuegos `server/firewall.sh` (servicio `opencrew-firewall`) |

Otros: `extension/` (extensión Chrome/Brave), `desktop/` (OpenCrew Escritorio para Mac), `server/computer/`
(imagen del ordenador de los bots).

## Cómo publicar un cambio

1. `npx vite build` y probar (en local: `npx vite --port 5175 --strictPort`, perfil `?perfil=prueba`; servidor
   local: `OPENCREW_TOKEN=local-test-token-0123456789abcdef OPENCREW_DATA=<tmp> node server/index.mjs`).
2. Commit (con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), `git push`.
3. `node scripts/deploy.mjs` (GitHub Pages + zips de extensión y escritorio).
4. Servidor: `ssh opencrew '~/opencrew/server/update.sh'` (si `update.sh` cambió, ejecutarlo dos veces).

## Hecho recientemente (etapa de lanzamiento)

- Fase A (seguridad): A1–A6 hechas (SSRF, sin root + lanzador, datos cifrados, permisos por bot, contenido
  externo no confiable, límites). A7 (copias fuera) pendiente de elegir destino.
- Fase B (multiusuario): app servida por el servidor con CSP; pasarela con cuentas e invitaciones; motor aislado
  por usuario; exportar/borrar cuenta (B5); ordenadores aislados con cortafuegos y
  límites (B4). Cuenta de administrador ya creada por el usuario. Pendiente: B1 (dominio), B3 (dormir motores).

## Pendiente que necesita al usuario

- Dominio propio (B1); proveedor de correo (recuperar contraseña / enlace mágico); destino de copias (A7);
  cuenta de cobro Paddle/Lemon Squeezy (D4); asesor legal (E1); instalar extensión y app de escritorio; Composio; credenciales de Gemini con créditos de AI Pro.

## Reglas de trabajo con el usuario

- Habla en español, claro y sin jerga; explica cada cosa en pasos cortos.
- Avanza solo por el ROADMAP, probando cada cambio en local y en el servidor antes de publicar.
- Nunca introducir claves, contraseñas ni crear cuentas por el usuario; nunca mostrar secretos en el chat.
- El Puente (suscripciones de Claude/ChatGPT) se retiró el 24 nov 2026: Anthropic prohíbe usar suscripciones en
  otras apps. No volver a añadirlo; ChatGPT solo con el programa oficial «Sign in with ChatGPT».
- Los bots no eluden bloqueos anti-bots de las webs: si una web los bloquea, paran y avisan.
