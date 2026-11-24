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

- [x] M2.0 · Enrutador de calidad garantizada («Automático»): clasifica cada paso (conversación, redacción, investigación, código, razonamiento, imágenes; fácil/normal/difícil), descarta los modelos que no llegan a la calidad mínima de esa tarea y elige el más barato del resto para esa petición (contexto largo, caché). Aprende: si las respuestas de un modelo se reintentan o fallan, deja de usarse para ese tipo de tarea; «Reintentar» sube un nivel. Caché de prompts de Claude (hasta −80-90 % en lo repetido). Banco de pruebas `scripts/router-bench.mjs` y comprobación `scripts/router-check.mjs`
- [ ] M2.0b · Pasar el banco de pruebas con las claves de empresa (calibrar la calidad real de cada modelo) y repetirlo cada mes o cuando cambien precios y modelos ⏸ claves de empresa
- [ ] M2.0c · En la nube: el aprendizaje del enrutador se suma entre todos los usuarios en la pasarela (sin contenido, solo «tipo de tarea · modelo · bien/mal»), y un panel de ahorro (coste real frente a usar siempre el modelo grande)
- [ ] M2.1 · Proveedor de IA de OpenCrew por API con **cuatro proveedores**: Anthropic (Claude), Google (Gemini, servicio de pago), xAI (Grok) y OpenAI. Claves de empresa solo en la pasarela (nunca en el motor del usuario); el enrutador de M2.0 elige entre todos sus modelos el más barato que alcance la calidad de cada tarea ⏸ cuentas de empresa en los cuatro, con saldo y límite de gasto mensual
- [ ] M2.2 · Créditos medidos por llamada en la pasarela (tokens × precio real), tope mensual por usuario, aviso al 80 % y parada al 100 %, recargas; el panel de Uso y coste muestra créditos restantes
- [ ] M2.3 · Planes en la pasarela: Prueba (7 días, 1 € de créditos), Pro (15 €, fundadores 9 €); límites por plan (bots, rutinas, vigilantes, horas de ordenador de bot, tamaño de archivos)
- [ ] M2.4 · Bienvenida con créditos incluidos: el usuario nuevo empieza sin pegar ninguna clave (la clave propia pasa a ser opcional)
- [ ] M2.5 · Cobro con Paddle (o Stripe Managed Payments): pantalla de precios en la app, alta, cambio y cancelación de plan, facturas y portal de cliente ⏸ cuenta en Paddle (pide estar dado de alta)
- [ ] M2.6 · Avisos de Paddle (webhooks) en la pasarela: pago correcto, fallido, renovación, cancelación y reembolso → plan y créditos actualizados solos; al cancelar, el usuario vuelve a Prueba sin perder sus datos
- [ ] M2.7 · Precios con IVA incluido, desistimiento de 14 días y reembolsos explicados en la app y en las condiciones

### M3 · Cuentas listas para desconocidos

- [ ] M3.1 · Dominio propio (B1) y cambiar en todo el proyecto la dirección provisional (sslip.io) ⏸ comprar dominio
- [ ] M3.2 · Correo de la app: verificar la cuenta, recuperar la contraseña y avisos (créditos al 80 %, pago fallido) ⏸ elegir proveedor (p. ej. Resend) y configurar su DNS en el dominio
- [ ] M3.3 · Registro abierto con lista de espera, invitaciones de fundador y límite de altas por día (protección contra abusos)
- [ ] M3.4 · Si cambian las condiciones, pedir aceptarlas de nuevo al entrar (la versión aceptada ya se guarda)
- [ ] M3.5 · Dormir los motores sin uso y despertarlos para sus rutinas y vigilantes (B3)
- [ ] M3.6 · Cola y horas para los ordenadores de los bots (máx. 3 a la vez en el servidor actual), con aviso «en cola» al usuario
- [ ] M3.7 · Copias cifradas fuera del servidor y prueba real de restaurar una copia (A7) ⏸ elegir destino
- [ ] M3.8 · Vigilancia: aviso al administrador si el servidor cae, se llena el disco o falla un servicio; registro de errores sin datos personales
- [ ] M3.9 · Panel de administración: usuarios, plan, créditos gastados, coste real de IA por usuario y altas por día (sirve para medir la beta)
- [ ] M3.10 · Funciones a medio camino en la nube: extensión y app de escritorio visibles como «beta» (instalación manual) o escondidas hasta F1/F2; textos legales también en inglés

### M4 · Seguridad y cumplimiento antes de abrir

- [ ] M4.1 · Repetir la auditoría con docs/AUDITORIA_PROMPT.md sobre la versión con pagos y corregir lo crítico
- [ ] M4.2 · Actualizar dependencias y revisar avisos de seguridad (npm audit, imágenes de Docker)
- [ ] M4.3 · Prueba de carga con ~50 usuarios simulados: memoria del servidor, tiempos de respuesta y cuándo hace falta un servidor mayor
- [ ] M4.4 · Registro de actividades de tratamiento (RGPD), contratos de encargado firmados (Anthropic, Google, xAI, OpenAI, Hostinger, Paddle, proveedor de correo) y procedimiento ante una brecha de datos (avisar en 72 h) ⏸ aceptar los DPA en cada proveedor
- [ ] M4.5 · Textos legales definitivos: titular, NIF, dirección y contacto; revisión con asesor (M1.7) ⏸

### M5 · Lanzar

- [ ] M5.1 · Página pública mínima: qué es, ejemplos, precio, preguntas frecuentes, textos legales y contacto (Paddle la exige para aprobar la cuenta)
- [ ] M5.2 · Ayuda y soporte: correo de soporte, guía de inicio corta y respuestas a las dudas frecuentes dentro de la app
- [ ] M5.3 · Beta cerrada con 20–50 personas (precio de fundador): medir activación, tareas por usuario, retención a 7 días y coste real de IA
- [ ] M5.4 · Ajustar precio, créditos y límites con esos datos y abrir el registro

### Lo que tienes que hacer tú (en orden, cuando toque)

1. Darte de alta como autónomo o sociedad (aparcado por ahora; sin esto no se puede cobrar ni completar los textos legales).
2. Comprar el dominio y elegir proveedor de correo (M3.1, M3.2).
3. Crear las cuentas de empresa de API en Anthropic, Google Cloud (Gemini con facturación), xAI y OpenAI, con saldo y límite de gasto mensual; en xAI, pedir su contrato de tratamiento de datos (DPA) para clientes de la UE (M2.1).
4. Abrir la cuenta en Paddle con la página pública lista (M2.5, M5.1).
5. Elegir dónde guardar las copias (M3.7) y aceptar los contratos de encargado de cada proveedor (M4.4).
6. Revisión de los textos legales con un asesor (M4.5).
7. Buscar las 20–50 personas de la beta (M5.3).

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

- [ ] D1 · (ver M2) Planes y límites (Gratis, Pro, Equipo) aplicados en la pasarela
- [ ] D2 · (ver M2) Proveedor de IA de OpenCrew para planes de pago: claves solo en la pasarela, créditos medidos por llamada, caché de prompts y enrutado al modelo más barato
- [x] D3 · ~~Modelo gratuito con límite diario~~ descartado: la capa gratis de Gemini no se puede usar en apps en la UE; se sustituye por la Prueba de 7 días (M2.3)
- [ ] D4 · (ver M2) Cobro con Merchant of Record (Paddle o Lemon Squeezy): suscripciones, recargas y facturas ⏸ crear cuenta de empresa
- [ ] D5 · (ver M2) Panel de consumo y alertas de presupuesto para el usuario

## Fase E — Legal y cumplimiento (lo urgente está en M1)

- [ ] E1 · Condiciones de uso, política de privacidad, subencargados y uso aceptable ⏸ revisión con asesor
- [x] E2 · Aviso de IA, edad mínima y sin cookies de rastreo (hecho en M1.4)
- [x] E3 · Gmail/Calendar para usuarios ajenos: de inicio vía pasarela (M1.6); la verificación de Google (CASA) queda para cuando compense
- [x] E4 · Revisión de condiciones de OpenAI, Anthropic y Google (docs/LANZAMIENTO.md, aplicada en M1)

## Fase F — Distribución (después del MVP)

- [ ] F1 · Extensión en la Chrome Web Store (ficha, privacidad, permisos justificados) ⏸ cuenta de desarrollador (5 $)
- [ ] F2 · App de escritorio empaquetada y firmada (sin necesitar Node) ⏸ cuenta de Apple Developer (99 $/año)
- [ ] F3 · Documentación, ayuda, página de estado y analítica respetuosa con la privacidad

## Fase G — Después del lanzamiento

- [ ] G1 · Salas multijugador: invitar a personas y a sus bots, permisos por rol
- [ ] G2 · «Conectar» con un botón a servidores MCP oficiales (OAuth)
- [ ] G3 · Plantillas de equipos compartibles (marketplace)
