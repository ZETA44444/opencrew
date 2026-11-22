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
- [ ] El jefe de gabinete puede crear y configurar bots nuevos (herramienta `create_bot`)
- [ ] Skills: biblioteca compartida de procesos guardados («cómo hacer X»)
- [ ] Bot principal proactivo: al abrir la app propone tareas que puede hacer por ti
- [ ] Más plantillas de bots (correo, SEO, redes, ventas, finanzas, soporte)

## Fase 3 — Rutinas avanzadas

- [ ] Historial de ejecuciones de cada rutina con su resultado
- [ ] Notificaciones del navegador cuando una rutina termina
- [ ] Crear rutinas hablando («todos los lunes a las 9 hazme un resumen…»)
- [ ] Recuperar rutinas que no se ejecutaron porque la app estaba cerrada

## Fase 4 — Herramientas

- [ ] Búsqueda en internet (Gemini con Google Search, Claude con web search, o Tavily)
- [ ] Ejecutar código JavaScript en un sandbox (cálculos, datos)
- [ ] Páginas y dashboards: los artefactos HTML se ven dentro de la app
- [ ] Generar imágenes (Gemini / OpenAI)
- [ ] Voz: dictar mensajes y escuchar las respuestas
- [ ] Adjuntar archivos e imágenes al chat

## Fase 5 — Apps conectadas

- [ ] Conectores MCP remotos (pegar la URL de un servidor MCP)
- [ ] GitHub (con token personal): issues, PRs, repos
- [ ] Gmail y Google Calendar (con tu propio Client ID de Google)
- [ ] Notion

## Fase 6 — Seguridad y control

- [ ] Aprobaciones: «permitir una vez / siempre / denegar» antes de acciones sensibles
- [ ] Uso y coste estimado por bot y por modelo
- [ ] Límite de gasto mensual por bot

## Fase 7 — Servidor opcional 24/7 (para lo que el navegador no puede hacer)

- [ ] Servidor Node/Docker que reutiliza el mismo núcleo
- [ ] Rutinas siempre activas aunque cierres el navegador
- [ ] Disparadores por webhook (Slack, GitHub…)
- [ ] Ordenador por bot en Docker (navegador y terminal)
