# Hoja de ruta de OpenCrew — MVP para salir al mercado

**Objetivo inmediato:** lanzar un MVP de pago para **profesionales y pequeñas empresas (mayores de 18)**:
plan **Pro a 15 €/mes** con créditos de IA incluidos (Claude Haiku 5.5 por defecto), prueba gratis de 7 días
y tus propias claves sin recargo. El código abierto autoalojado sigue disponible.

Por qué y con qué números: [docs/LANZAMIENTO.md](docs/LANZAMIENTO.md) (condiciones de las IAs, ley y economía).
Seguridad y experiencia: [docs/AUDITORIA.md](docs/AUDITORIA.md). Etapa personal: [docs/ROADMAP-fase-personal.md](docs/ROADMAP-fase-personal.md).

Reglas: una tarea cada vez y en orden; cada cambio se prueba (en local y en el servidor), se hace commit,
se publica y se marca `[x]`. Lo que necesite algo del usuario (cuentas, pagos, dominio, asesor) va con ⏸.

---

## Fase M — MVP (en este orden)

### M1 · Cumplir las condiciones de las IAs y la ley (sin esto no se lanza)

- [x] M1.1 · Puente retirado (Anthropic prohíbe usar suscripciones en otras apps; ChatGPT solo con el programa oficial «Sign in with ChatGPT», más adelante). Los bots que lo usaban pasan a «Automático»
- [x] M1.2 · Ordenador de los bots sin ocultar que está automatizado; si una web bloquea bots, el bot para y avisa
- [x] M1.3 · Versión alojada: la bienvenida no recomienda la clave gratis de Gemini (prohibida para apps en la UE); usa los créditos del plan o una clave de pago
- [x] M1.4 · Registro: casilla de 18+, aceptar condiciones, privacidad y uso aceptable; aviso «hablas con bots de IA»
- [x] M1.5 · Mensajes a terceros: lo que un bot envía en tu nombre requiere tu aprobación; opción de firma «redactado con IA»; imágenes generadas marcadas como IA
- [x] M1.6 · Versión alojada: Gmail/Calendar directos solo para el administrador; el resto vía Composio (evita la auditoría CASA de Google)
- [ ] M1.7 · Textos legales: condiciones, privacidad, subencargados, uso aceptable (respetar las condiciones de cada web, sin spam), desistimiento y reembolsos. Borradores hechos en `public/legal/` (enlazados al registrarse y en Ajustes) ⏸ completar titular y contacto, y revisión con asesor

### M2 · Cobrar

- [ ] M2.1 · Proveedor de IA de OpenCrew: clave de Anthropic solo en la pasarela, «Automático» con Haiku 5.5 por defecto y Sonnet para tareas difíciles, caché de prompts ⏸ clave de API de empresa
- [ ] M2.2 · Créditos medidos por llamada en la pasarela, tope mensual, recargas y alertas (reutiliza el panel de Uso y coste)
- [ ] M2.3 · Planes en la pasarela: Prueba (7 días, 1 € de créditos), Pro (15 €, fundadores 9 €), límites de bots y de horas de ordenador
- [ ] M2.4 · Cobro con Paddle (o Stripe Managed Payments): alta, suscripción, cancelación y facturas ⏸ alta de autónomo/sociedad y cuenta en Paddle

### M3 · Cuentas listas para desconocidos

- [ ] M3.1 · Dominio propio (B1) ⏸ comprar dominio
- [ ] M3.2 · Correo: verificar la cuenta y recuperar la contraseña ⏸ elegir proveedor (p. ej. Resend)
- [ ] M3.3 · Registro abierto con lista de espera e invitaciones de fundador
- [ ] M3.4 · Dormir los motores sin uso y despertarlos para sus rutinas (B3) y cola para los ordenadores de los bots
- [ ] M3.5 · Copias cifradas fuera del servidor (A7) ⏸ elegir destino

### M4 · Lanzar

- [ ] M4.1 · Página pública mínima: qué es, precio, preguntas frecuentes, textos legales y contacto (Paddle la exige)
- [ ] M4.2 · Beta cerrada con 20–50 personas: medir activación, tareas por usuario y coste real de IA
- [ ] M4.3 · Ajustar precio y créditos con esos datos y abrir el registro

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

- [x] C1 · Bienvenida guiada: para qué lo quieres → con qué piensan (clave gratis de Gemini paso a paso, suscripciones o demo) → equipo de plantillas → primera tarea en un clic
- [x] C2 · Modo Básico por defecto para usuarios nuevos (Ajustes de 9 a 5 secciones, editor de bots con opciones avanzadas plegadas, sin Skills/Puente/Ollama) y Avanzado con un interruptor; los usuarios existentes siguen en Avanzado
- [x] C3 · Ajustes divididos (Cuenta, Modelos, Apps, Privacidad, Avanzado) y diálogos propios en lugar de `confirm`/`alert`
- [x] C4 · Errores de los modelos explicados: qué ha pasado y qué hacer, con el detalle técnico aparte
- [x] C5 · Inglés y español (selector en Ajustes → Preferencias y en la bienvenida; textos nuevos: `node scripts/i18n-extract.mjs` y traducir en `src/i18n/en.json`)
- [ ] C6 · Web de producto completa (después del MVP; la página mínima es M4.1)

## Fase D — Planes, créditos y cobro (sustituida por M2; queda como referencia)

- [ ] D1 · Planes y límites (Gratis, Pro, Equipo) aplicados en la pasarela
- [ ] D2 · Proveedor de IA de OpenCrew para planes de pago: claves solo en la pasarela, créditos medidos por llamada, caché de prompts y enrutado al modelo más barato
- [ ] D3 · Modelo gratuito con límite diario para la versión Gratis
- [ ] D4 · Cobro con Merchant of Record (Paddle o Lemon Squeezy): suscripciones, recargas y facturas ⏸ crear cuenta de empresa
- [ ] D5 · Panel de consumo y alertas de presupuesto para el usuario

## Fase E — Legal y cumplimiento (lo urgente está en M1)

- [ ] E1 · Condiciones de uso, política de privacidad, subencargados y uso aceptable ⏸ revisión con asesor
- [ ] E2 · Aviso de IA, edad mínima y consentimiento mínimo de cookies (sin rastreadores)
- [ ] E3 · Gmail/Calendar para usuarios ajenos: verificación de Google (CASA) o, de inicio, vía pasarela (Composio) ⏸
- [ ] E4 · Revisión de condiciones de OpenAI, Anthropic y Google para cada función ofrecida

## Fase F — Distribución (después del MVP)

- [ ] F1 · Extensión en la Chrome Web Store (ficha, privacidad, permisos justificados) ⏸ cuenta de desarrollador (5 $)
- [ ] F2 · App de escritorio empaquetada y firmada (sin necesitar Node) ⏸ cuenta de Apple Developer (99 $/año)
- [ ] F3 · Documentación, ayuda, página de estado y analítica respetuosa con la privacidad

## Fase G — Después del lanzamiento

- [ ] G1 · Salas multijugador: invitar a personas y a sus bots, permisos por rol
- [ ] G2 · «Conectar» con un botón a servidores MCP oficiales (OAuth)
- [ ] G3 · Plantillas de equipos compartibles (marketplace)
