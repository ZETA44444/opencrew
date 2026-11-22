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

## Úsala ya (sin instalar nada)

👉 **https://zeta44444.github.io/opencrew/**

Funciona entera en tu navegador. Los bots empiezan en modo demo; para que piensen de verdad:

1. Consigue una clave:
   - **Gemini** (tiene capa gratuita): https://aistudio.google.com/apikey
   - **Claude**: https://console.anthropic.com/settings/keys
   - OpenAI, xAI (Grok) u OpenRouter: enlaces en la propia app.
2. En la app: **Ajustes y claves** → pega la clave → **Probar** → **Guardar claves**.
3. En cada bot, elige el modelo en el selector de debajo del chat.

Tus claves, bots y chats se guardan **solo en tu navegador**. Usa **Ajustes → Descargar copia** para no perderlos.

¿Quieres otro equipo separado (por ejemplo, trabajo y personal)? Abre la app con `?perfil=trabajo` al final de la dirección: cada perfil tiene sus propios bots, chats y claves.

## Desarrollo local

```bash
git clone https://github.com/ZETA44444/opencrew.git
cd opencrew
npm install
npm run dev        # http://localhost:5173
npm run deploy     # publica en GitHub Pages
```

## Cómo funciona

```
Tu navegador
 ├─ src/components   interfaz (Sidebar, Chat, Panel derecho, modales)
 ├─ src/api.js       "backend" dentro del navegador
 └─ src/core
     ├─ agent.js      bucle: modelo → herramientas → modelo
     ├─ providers.js  Claude · Gemini · OpenAI · xAI · OpenRouter · Ollama · demo (llamadas directas)
     ├─ tools.js      delegar · memoria · leer webs · archivos · hora
     ├─ routines.js   rutinas (se ejecutan mientras la app está abierta)
     └─ store.js      base de datos en localStorage
```

Cada bot tiene `provider` y `model`. Cuando un bot delega, el bot destino se ejecuta con **su propio** modelo, así que puedes mezclar modelos caros para pensar y baratos para tareas simples.

## Seguridad y privacidad

- No hay servidor de OpenCrew: tus claves solo viajan de tu navegador al proveedor de IA que elijas.
- Las webs que bloquean la lectura directa se leen a través de `r.jina.ai` (se puede desactivar en Ajustes).
- Los archivos que crean los bots se abren siempre como texto plano, nunca como código ejecutable.

## Hoja de ruta

Ver [ROADMAP.md](ROADMAP.md).

## Licencia

MIT. Escrito desde cero; inspirado en las funciones públicas de Grok Bot y de proyectos como Rakazo, sin copiar su código.
