# Auditoría de OpenCrew antes de salir al mercado

Fecha: 23 nov 2026 · Alcance: app web (`src/`), servidor (`server/`), Puente (`bridge/`), extensión
(`extension/`), app de escritorio (`desktop/`) y despliegue (VPS Hostinger, Caddy, GitHub Pages).
Método: [docs/AUDITORIA_PROMPT.md](AUDITORIA_PROMPT.md). Todo lo marcado como «comprobado» se ha
verificado en el código o en el servidor, no supuesto.

**Resumen.** OpenCrew funciona muy bien para **una persona en su propio servidor**. Para venderlo a
desconocidos faltan tres cosas que hoy bloquean el lanzamiento:

1. **No es multiusuario**: el servidor tiene un solo token que lo abre todo (claves, chats, ordenadores).
2. **Hay agujeros que con usuarios desconocidos serían críticos**: el servidor corre como administrador
   con acceso a Docker, y los bots pueden llegar a servicios internos (SSRF).
3. **La versión gratis no puede basarse en las suscripciones de otros** (Claude/ChatGPT): las condiciones
   de Anthropic no permiten que un producto de terceros ofrezca iniciar sesión con Claude.

---

## 1. Seguridad

### Críticos (bloquean el lanzamiento)

**C1 · Un solo token para todo, sin cuentas ni aislamiento** — `server/index.mjs` (`authorized()`, RPC
`/api/rpc`). Cualquiera con el token ve y usa todas las claves de API, chats, memoria, ordenadores y el
navegador/escritorio emparejados. *Caso:* con dos clientes en el mismo servidor, el cliente B lee las
claves del cliente A. *Arreglo:* cuentas de usuario y un motor aislado por usuario (ver §4).

**C2 · El servidor corre como root y con el socket de Docker** — comprobado: `id` en el contenedor →
`uid=0(root)`; `server/compose.yml` monta `/var/run/docker.sock`. *Caso:* cualquier fallo que permita
ejecutar código en el proceso Node (dependencia, error en un parser, inyección) da control total del VPS
(Docker = root del host). *Arreglo:* ejecutar Node como usuario sin privilegios y poner un
**docker-socket-proxy** que solo permita crear/borrar los contenedores de OpenCrew (sin `--privileged`,
sin montar rutas del host), sistema de archivos de solo lectura y `no-new-privileges`.

**C3 · SSRF: los bots pueden llegar a direcciones internas** — `src/core/tools.js:75` (`isPrivateHost`)
solo mira cómo está *escrito* el nombre. Comprobado desde el contenedor: `http://puente:8790/health`
responde. No cubre nombres internos de Docker (`puente`, `opencrew`, `caddy`), IPv6 (`[::ffff:127.0.0.1]`),
IPs en decimal (`http://2130706433`), dominios que resuelven a IPs privadas (`127.0.0.1.nip.io`) ni
redirecciones. Además, los vigilantes web/RSS (`src/core/watchers.js:32`) y los conectores MCP
(`src/core/mcp.js:27`) no comprueban nada. *Caso:* una web con instrucciones escondidas hace que el bot
lea `http://opencrew:8787/...` o servicios futuros sin contraseña. *Arreglo:* resolver el DNS y rechazar
cualquier IP privada/loopback/link-local/ULA (también tras cada redirección), bloquear nombres internos,
y aplicarlo a fetch_url, vigilantes, RSS, imágenes y MCP en el servidor.

**C4 · Las suscripciones de terceros no pueden ser un producto** — `bridge/`. Anthropic no permite que
productos de terceros ofrezcan iniciar sesión con Claude sin su aprobación; con OpenAI (Codex) el uso
dentro de otro producto no está claramente permitido. *Arreglo:* el Puente queda **solo en la edición
autoalojada (open source) para uso personal**, con aviso claro; **nunca** en la versión alojada que
vendemos. La versión gratis se basa en claves propias y modelos gratuitos (§3).

### Altos

**H1 · Token y claves en `localStorage` de un origen compartido** — `src/remote.js` (`oc.server`). La app
vive en `zeta44444.github.io`, el **mismo origen** que cualquier otra web publicada en esa cuenta de
GitHub: una de ellas podría leer el token. Tampoco hay CSP. *Arreglo:* dominio propio
(p. ej. `app.opencrew…`), sesión con cookie `HttpOnly; Secure; SameSite=Strict` en la versión alojada y
CSP estricta.

**H2 · Claves de API sin cifrar en disco y en copias** — comprobado: `server/data/db.json` (root, 644) y
`backups/` contienen las claves en claro. *Arreglo:* cifrar los secretos (AES-256-GCM, clave maestra
fuera del disco de datos) y copias cifradas fuera del servidor.

**H3 · «Permitir siempre» vale para todos los bots** — `src/core/approvals.js` (`settings().always[tool]`).
*Caso:* permites siempre «Enviar correo» a tu bot de confianza y otro bot (o uno manipulado por una web)
también puede enviar sin preguntar. *Arreglo:* permisos «siempre» por bot y por herramienta, revocables.

**H4 · Inyección de instrucciones desde lo que leen los bots** — web, correo, issues, webhooks,
pestañas. Las aprobaciones lo frenan, pero con «siempre» o en rutinas automáticas un texto malicioso
puede llevar al bot a enviar/escribir. *Arreglo:* marcar el contenido externo como no confiable en el
prompt, y exigir aprobación para acciones que envían o borran si en esa tarea se ha leído contenido
externo (aunque haya «siempre»).

**H5 · Sin límites de uso por usuario** — RPC sin límite de peticiones; ordenadores de bots sin cuota
por usuario. *Caso:* un usuario gratis crea 50 bots con ordenador y tumba el servidor. *Arreglo:* límites
por plan (peticiones, mensajes, ordenadores simultáneos, almacenamiento) y por IP.

**H6 · Los ordenadores de los bots salen a internet sin control** — `server/computer.mjs:46`. *Caso:*
alguien usa su bot para enviar spam o minar criptomonedas desde la IP del servidor (y la IP acaba en
listas negras). *Arreglo:* en la versión alojada, solo para planes de pago, con proxy de salida,
límites de tiempo/CPU y red separada por usuario (`icc=false`).

### Medios

- **M1 · Google Gmail/Calendar**: los permisos de Gmail son «restringidos»; para usuarios ajenos Google
  exige verificar la app y una **auditoría de seguridad anual (CASA)**, con coste. *Arreglo:* en el
  lanzamiento, Gmail vía pasarela (Composio ya está verificado) o pasar la verificación más adelante.
- **M2 · Sin cabeceras de seguridad en la app** (GitHub Pages no permite ponerlas). Se resuelve con H1.
- **M3 · Copias solo en el mismo disco** (`server/data/backups`). Un fallo del VPS lo pierde todo.
- **M4 · Clave de webhook en la URL** (`?k=`). Aceptable; preferir firma HMAC cuando el servicio la tenga.
- **M5 · Extensión y app de escritorio no distribuibles tal cual**: la extensión necesita ficha en Chrome
  Web Store y política de privacidad; la app de escritorio requiere Node y no está firmada (macOS avisa).

### Lo que ya está bien (comprobado)

Markdown con DOMPurify; archivos HTML de los bots en iframe `sandbox` sin `allow-same-origin`;
`run_javascript` en contenedores sin red ni privilegios; tokens comparados en tiempo constante;
emparejamientos de extensión/escritorio con códigos propios y revocables; la extensión no escribe
contraseñas ni tarjetas y bloquea bancos; la app de escritorio protege claves/.env y no sale de sus
carpetas; aprobaciones por acción y registro de actividad.

---

## 2. Utilidad y experiencia de usuario

Recorrido de un usuario nuevo que no sabe qué es una API key:

1. **No entiende qué hacer al entrar.** Ve 5 bots «demo» que responden «no estoy conectado a ningún
   modelo». *Arreglo:* bienvenida guiada: «¿Para qué quieres tu equipo?» → plantilla de equipo → primera
   tarea útil en menos de 3 minutos, con la versión gratis ya funcionando (modelo gratuito incluido).
2. **Demasiada jerga visible**: API key, MCP, webhook, token, Puente, servidor, vigilante, enrutador…
   *Arreglo:* modo «Básico» por defecto (chat, equipo, tareas programadas, apps) y «Avanzado» aparte.
3. **Conectar el servidor es técnico** (URL + token). En la versión alojada desaparece: se entra con
   cuenta.
4. **Ajustes es una página enorme.** *Arreglo:* dividir en Cuenta, Modelos, Apps, Privacidad y Avanzado.
5. **Diálogos nativos del navegador** (`confirm`, `alert`) para cosas importantes. *Arreglo:* diálogos
   propios con explicación.
6. **Solo en español.** *Arreglo:* inglés y español desde el lanzamiento.
7. **Falta la web de producto**: qué es, ejemplos, precios, privacidad, contacto.
8. **Errores técnicos** («401», «429»…) llegan al usuario. *Arreglo:* mensajes con qué hacer.
9. **Lo que más valor da** (equipo que trabaja solo con rutinas y vigilantes, el ordenador del bot y
   la vista en directo, el enrutador al modelo barato) está escondido en paneles laterales.
   *Arreglo:* ponerlo en la bienvenida y en las plantillas.

---

## 3. Modelo de negocio

### Qué cuesta cada usuario (estimación con precios de catálogo)

Una tarea típica con herramientas: ~3 pasos de ~15.000 tokens de entrada y ~800 de salida.

| Modelo (entrada / salida por millón) | Coste por tarea | 10 tareas/día (30 días) | 50 tareas/día |
|---|---|---|---|
| Gemini Flash-Lite (0,10 $ / 0,40 $) | ~0,005 $ | ~1,5 $/mes | ~7 $/mes |
| Gemini Flash (0,30 $ / 2,50 $) | ~0,02 $ | ~6 $/mes | ~30 $/mes |
| Claude Haiku (1 $ / 5 $) | ~0,06 $ | ~18 $/mes | ~90 $/mes |
| Claude Sonnet (3 $ / 15 $) | ~0,17 $ | ~50 $/mes | ~250 $/mes |

Con **caché de prompts** (el prompt del sistema y las herramientas se repiten), la entrada baja hasta un
~75-90 %, y el enrutador manda la mayoría de tareas a Flash-Lite/Flash. **Conclusión:** un plan de pago
es rentable si el modelo por defecto es barato, Sonnet/Opus consumen créditos de forma proporcional y
hay un tope mensual de créditos.

Servidor: un VPS de 8 GB aguanta cientos de usuarios de chat/rutinas, pero **pocos ordenadores de bot a
la vez** (1,5 GB cada uno) → los ordenadores solo en planes de pago, con límite de uso simultáneo.

### Competencia (precios públicos, fuentes de terceros)

Lindy: ~30-300 $/mes por créditos · Relevance AI: Pro ~19 $/mes (anual), Team ~234-349 $/mes ·
Manus: desde ~20 $/mes con créditos diarios.

### Propuesta

| Plan | Precio | Qué incluye |
|---|---|---|
| **Autoalojado** | Gratis (open source) | Todo, en tu propio servidor, con tus claves; el Puente para tus suscripciones solo aquí (uso personal) |
| **Gratis (alojado)** | 0 € | Tus propias claves de API + un modelo gratuito con límite diario; 3 bots, rutinas y vigilantes básicos; sin ordenador de bot |
| **Pro** | 15 €/mes | Sin claves: créditos incluidos (~6 $ de modelos a precio de coste), enrutador al modelo más barato, bots ilimitados, rutinas, vigilantes, webhooks, ordenador de bot con horas incluidas, vista en directo |
| **Equipo** | 39 €/mes por espacio | Todo Pro con más créditos y horas de ordenador, salas multijugador y permisos por rol |
| **Recargas** | desde 5 € | Créditos extra (con margen del ~20-30 %) |

Tus propias claves siguen siendo gratis en cualquier plan (sin margen sobre ellas).

**Cobro desde España:** usar un **Merchant of Record** (Paddle o Lemon Squeezy, ~5 % + 0,50 $ por cobro):
ellos son el vendedor legal y gestionan el IVA de cada país de la UE. Stripe es más barato pero el IVA y
la facturación los llevas tú. Recomendado empezar con Paddle.

### Legal mínimo para lanzar (RGPD, España/UE)

Condiciones de uso, política de privacidad, lista de subencargados (OpenAI, Anthropic, Google,
Hostinger, Paddle…), exportar y borrar la cuenta, datos alojados en la UE, aviso de que se habla con IA,
edad mínima y uso aceptable (sin spam ni abuso de los ordenadores de los bots). Revisión con un asesor
antes de cobrar.

---

## 4. Arquitectura recomendada para la versión alojada

Reutilizar el motor actual (que ya funciona y está probado) en lugar de reescribirlo:

- **Pasarela** (nueva): cuentas (correo con enlace mágico y passkeys), planes, cobros, límites, y
  enruta cada petición al motor de su usuario.
- **Un motor aislado por usuario**: el mismo `server/index.mjs` con su propia carpeta de datos cifrada,
  sin acceso a Docker; se duerme si no se usa y un planificador lo despierta para sus rutinas y
  vigilantes.
- **Servicio de ordenadores** separado (solo de pago), con red y cuotas por usuario.
- **Proveedor de IA de OpenCrew** para planes de pago: claves nuestras en la pasarela, nunca en el motor
  del usuario; el motor pide créditos y la pasarela mide y descuenta.
