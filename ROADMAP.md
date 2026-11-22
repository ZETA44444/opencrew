# Hoja de ruta de OpenCrew

Objetivo: tener todas las funciones de Grok Bot (ver [docs/ANALISIS-GROKBOT.md](docs/ANALISIS-GROKBOT.md)), pero open source y con **un modelo de IA distinto por bot**.

Reglas para cada tarea:
- Se hace **una tarea cada vez**, en orden, de arriba abajo.
- Cada tarea se prueba en el navegador, se marca con `[x]`, se hace commit y se publica en GitHub Pages.
- Si una tarea no se puede hacer en el navegador (sin servidor), se deja para la Fase 7 con una nota.

---

## Fase 0 — Publicar la app en GitHub

- [x] App 100 % en el navegador: sin servidor, las claves se guardan solo en tu navegador
- [x] Publicación en GitHub Pages con `npm run deploy`
- [x] Exportar / importar todos tus datos (copia de seguridad en un archivo .json)

## Fase 1 — Chat de calidad

- [x] Respuestas en streaming (el texto aparece palabra a palabra)
- [x] Botón «Parar ahora» para detener un bot que está trabajando
- [x] Reintentar la última respuesta y editar el último mensaje
- [x] Cola de mensajes («Queue»): escribir mientras el bot trabaja y que lo haga después
- [x] Guardar archivos y datos grandes en IndexedDB (sin el límite de 5 MB)
- [x] Versión móvil pulida e instalable (PWA)

## Fase 2 — Trabajo en equipo

- [x] Chats de grupo: 2–6 bots en una conversación, con @menciones
- [x] El jefe de gabinete puede crear y configurar bots nuevos (herramienta `create_bot`)
- [x] Skills: biblioteca compartida de procesos guardados («cómo hacer X»)
- [x] Bot principal proactivo: al abrir la app propone tareas que puede hacer por ti
- [x] Más plantillas de bots (correo, SEO, redes, ventas, finanzas, soporte)

## Fase 3 — Rutinas avanzadas

- [x] Historial de ejecuciones de cada rutina con su resultado
- [x] Notificaciones del navegador cuando una rutina termina
- [x] Crear rutinas hablando («todos los lunes a las 9 hazme un resumen…»)
- [x] Recuperar rutinas que no se ejecutaron porque la app estaba cerrada

## Fase 4 — Herramientas

- [x] Búsqueda en internet (Gemini con Google Search, Claude con web search, o Tavily)
- [x] Ejecutar código JavaScript en un sandbox (cálculos, datos)
- [x] Páginas y dashboards: los artefactos HTML se ven dentro de la app
- [x] Generar imágenes (Gemini / OpenAI)
- [x] Voz: dictar mensajes y escuchar las respuestas
- [x] Adjuntar archivos e imágenes al chat

## Fase 5 — Apps conectadas

- [x] Conectores MCP remotos (pegar la URL de un servidor MCP)
- [x] GitHub (con token personal): issues, PRs, repos
- [ ] ⏸ Gmail y Google Calendar (con tu propio Client ID de Google) — **necesita que hagas esto primero**:
  1. Entra en https://console.cloud.google.com, crea un proyecto y activa **Gmail API** y **Google Calendar API**.
  2. En «Pantalla de consentimiento de OAuth» elige *Externo*, pon un nombre y añade tu correo como usuario de prueba.
  3. En «Credenciales» → «Crear credenciales» → **ID de cliente de OAuth** → tipo *Aplicación web*. En «Orígenes de JavaScript autorizados» añade `https://zeta44444.github.io` (y `http://localhost:5173` si lo usas en local).
  4. Copia el **Client ID** (acaba en `.apps.googleusercontent.com`; no es secreto) y pásamelo. Con eso implemento el inicio de sesión con Google y las herramientas de correo y calendario.
- [ ] ⏸ Notion — **la API de Notion no admite conexiones directas desde el navegador** (bloquea CORS). Dos caminos:
  - Usar un servidor MCP de Notion que permita navegador y conectarlo en «Apps conectadas» (ya funciona).
  - O esperar a la Fase 7 (servidor opcional), que hará de puente con tu token de integración de Notion.

## Fase 6 — Seguridad y control

- [x] Aprobaciones: «permitir una vez / siempre / denegar» antes de acciones sensibles
- [x] Uso y coste estimado por bot y por modelo
- [x] Límite de gasto mensual por bot

## Fase 7 — Fiabilidad y control del gasto (en el navegador)

> Primero lo que hace que todo lo demás funcione bien y no gaste de más.

- [x] Delegación de verdad: el bot principal es «coordinador», reparte a los especialistas y no hace él las tareas (decisión obligatoria en su primer paso)
- [x] Cambio automático de modelo si el elegido está saturado, retirado o sin clave (primero el más barato del mismo proveedor, luego otros proveedores)
- [ ] **Bot «Tesorero» incluido desde el inicio**: vigila tu gasto por bot y modelo, límites, avisos y errores de cuota; recomienda modelos más baratos.
      Detecta lo que cada proveedor deja ver con una clave normal (OpenRouter: saldo y límite de la clave; Gemini/Claude/OpenAI: errores de cuota y límites de uso). Google, Anthropic y OpenAI no muestran tu plan de suscripción a una API key normal, así que eso se estima.
- [ ] **Modelo «Automático» (enrutamiento inteligente)**: opción por bot para que elija solo el modelo más barato que sirve para cada tarea, entre las claves que tienes
- [ ] Panel de salud de modelos: qué modelos fallan o se saturan y cuál se usó en su lugar

## Fase 8 — Proyectos y memoria compartida

> Base para la memoria entre bots y, más adelante, para las salas multijugador.

- [ ] Proyectos: agrupan bots, chats, archivos y rutinas
- [ ] Memoria del proyecto: lo que le cuentas a un bot lo saben los demás bots del mismo proyecto
- [ ] Memorias con permisos: individual, de proyecto o global; memorias privadas que solo ve un bot (p. ej. las de compras no las ve el de correo)
- [ ] Memoria automática: al terminar una conversación el bot propone qué recordar y tú lo apruebas

## Fase 9 — Disparadores por eventos (sin gastar tokens esperando)

> Que los bots trabajen cuando pasa algo, no revisando cada X minutos.

- [ ] Vigilantes sin IA: comprueban cada poco si hay algo nuevo (GitHub, una web, un RSS, correo cuando haya Gmail) **sin usar el modelo**, y solo despiertan al bot si hay novedades
- [ ] Filtros: «solo si el correo es de X» o «solo issues con la etiqueta bug»
- [ ] Webhooks de verdad (aviso instantáneo de Gmail, Slack, GitHub) → necesitan el servidor de la Fase 11

## Fase 10 — Llamadas de voz en tiempo real

- [ ] Llamada en tiempo real con un bot (voz a voz, con tu clave de Gemini u OpenAI)
- [ ] Llamada de grupo con varios bots, cada uno con su voz; el coordinador reparte el trabajo
- [ ] Encargos por voz que se hacen en segundo plano y te avisan al terminar

## Fase 11 — Servidor opcional 24/7

> ⏸ **Pendiente de tu decisión**: necesita algo encendido siempre (tu Mac, un VPS, Railway/Render/Fly…).

- [ ] Servidor Node/Docker que reutiliza el mismo núcleo
- [ ] Rutinas y vigilantes siempre activos aunque cierres el navegador
- [ ] Webhooks (Gmail, Slack, GitHub) y conectores que no funcionan desde el navegador (Notion)
- [ ] Ordenador por bot en Docker (navegador y terminal)

## Fase 12 — Control de tu navegador y tu ordenador (con permisos)

- [ ] Extensión de navegador de OpenCrew: el bot puede leer y actuar en tus pestañas, pidiendo permiso por acción
- [ ] App de escritorio con acceso a archivos y terminal, con permisos por bot y por carpeta
- [ ] Registro de todo lo que ha hecho cada bot en tu equipo

## Fase 13 — Cuentas y salas multijugador (requiere servidor)

- [ ] Cuentas de usuario y sincronización entre dispositivos
- [ ] Salas de proyecto: invitar a otras personas y a sus bots para trabajar juntos
- [ ] Permisos por rol en la sala (quién puede usar qué bot, qué memoria ve cada uno)

## Fase 14 — Monetización

- [ ] Suscripción con créditos incluidos (sin necesidad de API keys propias); usar tus propias claves sigue siendo gratis
- [ ] Enrutamiento inteligente en el servidor para suscriptores: el modelo más barato que sirve para cada tarea
- [ ] Planes, límites por plan y panel de administración
