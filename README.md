# OpenCrew

**Tu equipo de bots de IA, open source y en tu ordenador.** Inspirado en Grok Bot de xAI, pero con una diferencia clave: **cada bot puede usar un modelo de IA distinto con tu propia API key** (Claude, Gemini, OpenAI, Grok, OpenRouter u Ollama local).

> Ejemplo: Atlas (jefe de gabinete) usa Claude Opus para pensar y repartir trabajo, Nova (investigadora) usa Gemini Flash porque es barato y rápido, y Byte (programador) usa Claude Sonnet.

## Funciones

- 🤖 **Bots con identidad**: nombre, cargo, trabajo, instrucciones, avatar con color y forma.
- 🧠 **Un modelo por bot**: cámbialo desde el selector del chat o al editar el bot.
- 🔀 **Delegación**: escribe `@Nova investiga…` o deja que el bot decida pasarle la tarea a otro compañero, aunque use otro modelo.
- 📋 **Panel de progreso**: cada paso en directo — qué modelo piensa, qué herramienta usa, a quién delega.
- ⏱ **Rutinas**: tareas automáticas cada X minutos o cada día a una hora.
- 💾 **Memoria por bot**: dile «recuerda que…» o añádela a mano.
- 📄 **Archivos (artefactos)**: los bots pueden crear informes, código o documentos que abres o descargas.
- 🌐 **Leer páginas web** (`fetch_url`).
- 🔑 **Tus claves se quedan en tu máquina** (`data/db.json` o `.env`), nunca se envían al navegador.
- 🧪 **Modo demo** para probarlo todo sin ninguna clave.

## Empezar (3 minutos)

Necesitas [Node.js 20+](https://nodejs.org).

```bash
git clone https://github.com/ZETA44444/opencrew.git
cd opencrew
npm install
npm run dev
```

Abre **http://localhost:5173**. Los bots empiezan en modo demo.

### Añadir tu API key

1. Consigue una clave:
   - **Gemini** (tiene capa gratuita): https://aistudio.google.com/apikey
   - **Claude**: https://console.anthropic.com/settings/keys
   - OpenAI, xAI (Grok) u OpenRouter: enlaces en la propia app.
2. En la app: **Ajustes y claves** → pega la clave → **Probar** → **Guardar claves**.
   (O copia `.env.example` a `.env` y ponla ahí.)
3. En cada bot, elige el modelo en el selector de abajo del chat.

## Cómo funciona

```
Navegador (React)  ──HTTP + eventos en directo──▶  Servidor Node (Express)
                                                    ├─ agent.js     bucle: modelo → herramientas → modelo
                                                    ├─ providers.js Claude · Gemini · OpenAI · xAI · OpenRouter · Ollama · demo
                                                    ├─ tools.js     delegar · memoria · web · archivos · hora
                                                    ├─ routines.js  programador de rutinas
                                                    └─ store.js     data/db.json
```

Cada bot tiene `provider` y `model`. Cuando un bot delega, el bot destino se ejecuta con **su propio** modelo, así que puedes mezclar modelos caros para pensar y baratos para tareas simples.

## Estructura

```
server/   API, bucle de agente, proveedores de IA, herramientas, rutinas
src/      interfaz React (Sidebar, Chat, Panel derecho, modales)
docs/     análisis de Grok Bot
data/     tu base de datos local y archivos de los bots (no se sube a git)
```

## Seguridad

- El servidor solo escucha en `127.0.0.1` por defecto.
- Las claves se guardan en texto plano en `data/db.json` en tu ordenador. No compartas esa carpeta.
- `fetch_url` bloquea direcciones locales/privadas.

## Hoja de ruta

- [ ] Chats de grupo con varios bots
- [ ] Conectores (Gmail, Calendar, Notion…) vía MCP
- [ ] Ordenador/navegador por bot en Docker
- [ ] Aprobaciones antes de acciones sensibles
- [ ] Respuestas en streaming token a token
- [ ] Disparadores por webhook

## Licencia

MIT. Escrito desde cero; inspirado en las funciones públicas de Grok Bot y de proyectos como Rakazo, sin copiar su código.
