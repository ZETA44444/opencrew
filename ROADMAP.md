# Hoja de ruta de OpenCrew — lanzamiento al mercado

Objetivo: pasar de una herramienta personal a un **producto** con dos vertientes:

- **Gratis**: el usuario trae sus propias claves de API y tiene un modelo gratuito con límite diario
  (y la edición **autoalojada** open source, donde puede usar el Puente con sus suscripciones, solo
  para uso personal).
- **De pago**: OpenCrew pone el proveedor de IA (créditos incluidos, enrutado al modelo más barato).

Base: [docs/AUDITORIA.md](docs/AUDITORIA.md) (seguridad, experiencia y modelo económico) y
[docs/AUDITORIA_PROMPT.md](docs/AUDITORIA_PROMPT.md) (cómo repetir la auditoría antes de cada lanzamiento).
Lo hecho en la etapa personal (Fases 0-12) está en [docs/ROADMAP-fase-personal.md](docs/ROADMAP-fase-personal.md).

Reglas: una tarea cada vez y en orden; cada cambio se prueba (en local y en el servidor), se hace commit,
se publica y se marca `[x]`. Lo que necesite algo del usuario (cuentas, pagos, dominio, abogado) se
marca con ⏸ y sus pasos.

---

## Fase A — Seguridad que bloquea el lanzamiento (y protege ya tu servidor)

- [x] A1 · SSRF: resolver DNS y bloquear IPs internas en fetch_url, vigilantes, RSS e imágenes (también tras redirecciones), y nombres internos de Docker (C3)
- [x] A2 · Servidor sin root y Docker solo a través de un proxy que únicamente permite los contenedores de OpenCrew (C2)
- [x] A3 · Claves y tokens cifrados en disco y en las copias (H2)
- [x] A4 · «Permitir siempre» por bot y no global; revocar desde Ajustes (H3)
- [x] A5 · Contenido externo marcado como no confiable; enviar/borrar exige permiso si la tarea leyó contenido externo (H4)
- [x] A6 · Límites de peticiones por IP y por usuario en el servidor (H5)
- [ ] A7 · Copias de seguridad cifradas fuera del servidor (M3) ⏸ elegir dónde (p. ej. un bucket de almacenamiento)

## Fase B — Producto multiusuario

- [ ] B1 · Dominio propio para la app y el servidor (H1) ⏸ comprar dominio — mientras tanto la app ya se sirve desde el servidor (mismo origen, CSP estricta)
- [x] B2 · Pasarela con cuentas (correo y contraseña, invitaciones, administrador con código del servidor), sesiones con cookie segura, CSRF y CSP. Pendiente: enlace mágico y recuperar contraseña por correo ⏸ elegir proveedor de correo
- [x] B3 · Un motor aislado por usuario (contenedor propio sin privilegios, volumen y clave de cifrado propios). Pendiente: dormir motores sin uso y despertarlos para rutinas
- [x] B4 · Ordenadores de bots aislados: red propia sin comunicación entre ellos, cortafuegos (sin acceso interno, al servidor ni a metadatos; correo bloqueado), límites por usuario y en total, clave del lanzador por usuario (H6)
- [x] B5 · Exportar y borrar la cuenta (RGPD) y panel básico de usuarios e invitaciones (el administrador también puede borrar usuarios)
- [x] B6 · El Puente solo para el administrador del servidor (pasa por la pasarela); los demás usuarios no pueden abrirlo

## Fase C — Experiencia para un usuario nuevo

- [ ] C1 · Bienvenida guiada: para qué lo quieres → plantilla de equipo → primera tarea útil en < 3 min
- [ ] C2 · Modo Básico por defecto y Avanzado aparte (sin jerga: MCP, webhooks, tokens…)
- [ ] C3 · Ajustes divididos (Cuenta, Modelos, Apps, Privacidad, Avanzado) y diálogos propios en lugar de `confirm`/`alert`
- [ ] C4 · Mensajes de error que dicen qué hacer (nada de «401» o «429»)
- [ ] C5 · Inglés y español
- [ ] C6 · Web de producto: qué es, ejemplos, precios, privacidad y contacto

## Fase D — Planes, créditos y cobro

- [ ] D1 · Planes y límites (Gratis, Pro, Equipo) aplicados en la pasarela
- [ ] D2 · Proveedor de IA de OpenCrew para planes de pago: claves solo en la pasarela, créditos medidos por llamada, caché de prompts y enrutado al modelo más barato
- [ ] D3 · Modelo gratuito con límite diario para la versión Gratis
- [ ] D4 · Cobro con Merchant of Record (Paddle o Lemon Squeezy): suscripciones, recargas y facturas ⏸ crear cuenta de empresa
- [ ] D5 · Panel de consumo y alertas de presupuesto para el usuario

## Fase E — Legal y cumplimiento

- [ ] E1 · Condiciones de uso, política de privacidad, subencargados y uso aceptable ⏸ revisión con asesor
- [ ] E2 · Aviso de IA, edad mínima y consentimiento mínimo de cookies (sin rastreadores)
- [ ] E3 · Gmail/Calendar para usuarios ajenos: verificación de Google (CASA) o, de inicio, vía pasarela (Composio) ⏸
- [ ] E4 · Revisión de condiciones de OpenAI, Anthropic y Google para cada función ofrecida

## Fase F — Distribución

- [ ] F1 · Extensión en la Chrome Web Store (ficha, privacidad, permisos justificados) ⏸ cuenta de desarrollador (5 $)
- [ ] F2 · App de escritorio empaquetada y firmada (sin necesitar Node) ⏸ cuenta de Apple Developer (99 $/año)
- [ ] F3 · Documentación, ayuda, página de estado y analítica respetuosa con la privacidad

## Fase G — Después del lanzamiento

- [ ] G1 · Salas multijugador: invitar a personas y a sus bots, permisos por rol
- [ ] G2 · «Conectar» con un botón a servidores MCP oficiales (OAuth)
- [ ] G3 · Plantillas de equipos compartibles (marketplace)
