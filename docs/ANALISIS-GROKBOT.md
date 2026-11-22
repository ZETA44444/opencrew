# Análisis de Grok Bot (Grokbot)

> Fecha del análisis: 22 nov 2026. Fuentes: artículos de MindStudio, Lindy, AI Maker (Substack), la web no oficial grok-bots.com y el README de Rakazo. Ninguna es documentación oficial de xAI, así que precios y detalles de modelos pueden haber cambiado. El vídeo "Aprende a usar GrokBOT en 15 minutos" no se pudo leer automáticamente (YouTube no devuelve la descripción ni la transcripción a herramientas), así que este análisis se basa en las fuentes escritas.

## 1. Qué es

Grok Bot es una app de xAI (hecha junto con Cursor) lanzada en beta el 11 de agosto de 2026. Sirve para tener un **equipo de "bots" con IA**, cada uno con un nombre, un trabajo concreto, su propia memoria y su propia conversación. Los bots trabajan en un **ordenador en la nube**, así que siguen trabajando aunque apagues el portátil o el móvil.

La idea no es programar, sino **delegar tareas repetitivas** a "compañeros" que siempre están encendidos: un bot para el correo, otro para investigar, otro para redes sociales, etc.

## 2. Funciones principales

| Función | Cómo funciona en Grok Bot |
|---|---|
| **Bots con identidad** | Nombre, cargo, descripción, color y forma del avatar. Se crean hablando: "quiero un bot que me ordene el correo". |
| **Un trabajo por bot** | Se recomienda que cada bot haga una sola cosa y que se pasen el trabajo entre ellos. |
| **Memoria por bot** | Cada bot recuerda tus preferencias, su rol y resúmenes de lo que ha hecho. La memoria no se mezcla entre bots. |
| **Delegación** | Si una tarea no es suya, el bot mira las descripciones de los demás y se la pasa al más adecuado. Puedes tener un "jefe de gabinete" que reparte el trabajo. |
| **Chats de grupo** | Grupos de 2 a 6 bots que se coordinan. |
| **Rutinas** | Instrucciones que se ejecutan solas: cada hora, cada día a las 7:00, o cuando llega un mensaje de Slack, GitHub o Teams. Hasta 50 por bot. Con historial de ejecuciones. |
| **Skills** | Procesos guardados ("cómo hacer X"). Se pueden crear grabándote haciendo la tarea (hasta 10 min). Biblioteca compartida entre bots. |
| **Ordenador en la nube** | Navegador, terminal y archivos. Puedes mirar la pantalla del bot en directo y tomar el control para iniciar sesión. Ese ordenador es compartido por todos tus bots. |
| **Apps conectadas (plugins)** | Gmail, Calendar, Drive, Slack, Notion, GitHub, Todoist, X, etc. Se basan en MCP. Se conectan una vez y sirven para todos los bots. |
| **Aprobaciones** | Para acciones sensibles (enviar, publicar, comprar, borrar) eliges "permitir una vez", "permitir siempre" o "denegar". Botón "Parar ahora". |
| **Email propio del bot** | Desde octubre un bot puede tener su propia dirección de correo. |
| **Voz** | Chat por voz y notas de voz en el móvil. |

### Limitaciones que señalan los usuarios

- **No puedes elegir el modelo**: Grok Bot decide qué modelo usar (Grok 4.6/4.7 y, según algunos, modelos de terceros para ciertas tareas). El selector muestra "Auto model".
- Poca visibilidad de lo que hace por dentro (comparado con Claude Code).
- El ordenador compartido no aísla a los bots: todos ven las mismas sesiones iniciadas.
- Es de pago (desde octubre va incluido en "The X Subscription" a partir de Premium, 30 $/mes) y es código cerrado.

## 3. Para qué se usa (casos típicos)

- **Asistente personal**: briefing a las 7:00 con correo + calendario + tareas; ordenar la bandeja de entrada y dejar borradores.
- **Contenido**: investigar en YouTube/X/web y guardar ideas en Notion; redactar posts para LinkedIn y X.
- **SEO y analítica**: informe semanal de Google Analytics y Search Console.
- **Ventas**: prospección y actualizar el CRM.
- **Programación**: rutinas que reaccionan a eventos de GitHub, reproducir bugs, analizar logs.
- **Operaciones**: vigilar canales de Slack y publicar resúmenes o alertas.

## 4. Análisis visual

Ninguna fuente publica capturas detalladas con colores exactos, así que esto combina lo descrito (layout tipo app de mensajería) con la estética conocida de Grok/xAI (negro, monocromo, minimalista).

```
┌──────────────┬───────────────────────────────────────┬──────────────────┐
│ ● Bots       │  [avatar] Nombre del bot · cargo       │ Progreso         │
│              │ ───────────────────────────────────── │  ✓ Paso 1        │
│ ◆ Jefe gab.  │                                       │  ✓ Paso 2        │
│ ● Investig.  │   burbujas de chat                    │  ◌ Ejecutando…   │
│ ■ Redactor   │                                       │──────────────────│
│ ▲ Programad. │                                       │ Plugins (3)      │
│              │                                       │──────────────────│
│ + Nuevo bot  │ ┌───────────────────────────────────┐ │ Artefactos       │
│              │ │ Message your Bot…   Auto model 🎤 ➤│ │  informe.md      │
│ ⚙ Ajustes    │ └───────────────────────────────────┘ │                  │
└──────────────┴───────────────────────────────────────┴──────────────────┘
```

- **Columna izquierda**: lista de bots como si fueran contactos de WhatsApp/Slack. Cada uno con avatar de color + forma.
- **Centro**: la conversación con el bot seleccionado. Caja de texto redondeada "Message your Bot…", selector de modelo ("Auto model"), micrófono y opción "Queue" para encolar mensajes.
- **Panel derecho**: lista de **Progreso** paso a paso con checks y pasos plegables ("Running command"), **Plugins conectados** y **Artefactos** (archivos que crea el bot).
- **Estética**: fondo casi negro, texto blanco, grises para lo secundario, sin colores llamativos salvo los avatares; bordes finos, esquinas redondeadas, mucho espacio.

## 5. Qué hace Rakazo (referencia, sin copiar código)

Rakazo (elie222/rakazo, licencia Apache-2.0) es una alternativa open source autoalojada: bots con memoria, rutinas, ordenador en Docker, chats de grupo, delegación y "cualquier modelo con tu propia clave". Es un monorepo grande (React, Electron, Expo, Hono, PostgreSQL, Prisma, workers…). Lo usamos solo como inspiración de funciones; **OpenCrew está escrito desde cero** y es mucho más pequeño para que sea fácil de probar y modificar.

## 6. Qué hace distinto OpenCrew

1. **Un modelo distinto por bot**: Claude, Gemini, OpenAI, Grok (xAI), OpenRouter u Ollama (local). Cambias el modelo de cada bot cuando quieras.
2. **Tu propia API key**, guardada solo en tu máquina.
3. Delegación entre bots que usan modelos diferentes (p. ej. el jefe en Claude Opus reparte a un investigador en Gemini Flash, más barato).
4. Panel de progreso que muestra cada paso y qué modelo lo hizo.
5. Rutinas programadas, memoria por bot y artefactos.
6. Un "modo demo" para probar todo sin ninguna clave.

## Fuentes

- https://www.mindstudio.ai/blog/grokbot-xai-agent-app
- https://www.mindstudio.ai/blog/grok-bot-setup-guide
- https://www.mindstudio.ai/blog/grok-bot-ai-agent-fleet
- https://aimaker.substack.com/p/grok-bot-ai-agent-team
- https://www.lindy.ai/blog/grok-bot
- https://grok-bots.com/ (no oficial)
- https://github.com/elie222/rakazo
