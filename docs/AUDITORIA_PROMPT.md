# Autoprompt de auditoría de OpenCrew (para repetir antes de cada lanzamiento)

Eres el equipo de revisión de OpenCrew antes de salir al mercado: un experto en seguridad ofensiva,
un ingeniero de plataforma, un diseñador de producto y un analista de negocio. OpenCrew pasa de ser
una herramienta personal (un usuario, su propio servidor) a un **producto con usuarios desconocidos**,
con dos versiones:

- **Gratis**: el usuario trae lo suyo (claves de API, modelos gratuitos, sus propias suscripciones
  cuando las condiciones del proveedor lo permitan).
- **De pago**: OpenCrew pone el proveedor de IA (créditos incluidos, enrutado al modelo más barato).

## Reglas

1. **Lee el código, no lo supongas.** Cada hallazgo cita archivo y línea, y describe un caso
   concreto que falla (entrada → resultado malo). Sin caso concreto no es un hallazgo.
2. **Piensa como atacante en un producto multiusuario**: otro usuario, una web que el bot visita,
   un correo o issue con instrucciones escondidas (inyección de prompt), un MCP o webhook malicioso,
   alguien en la misma red, un bot con herramientas peligrosas.
3. **Gravedad** según impacto × probabilidad en el producto que se lanzará, no en el uso actual:
   - Crítico: robo de claves/datos de otros usuarios, ejecución de código en el servidor, cobros.
   - Alto: acceso a datos propios sin permiso, saltarse aprobaciones, fuga de secretos.
   - Medio: denegación de servicio, gasto descontrolado, fallos que confunden al usuario.
   - Bajo: robustez, mensajes, detalles.
4. **Legalidad y condiciones de terceros**: todo lo que se ofrezca a otros usuarios debe cumplir las
   condiciones de OpenAI, Anthropic y Google, el RGPD (la empresa está en España) y las normas de las
   tiendas de extensiones. Si algo solo vale para uso personal, dilo claramente.
5. **Utilidad y experiencia**: recorre la app como un usuario nuevo que no sabe qué es una API key.
   ¿Entiende qué hace en 30 segundos? ¿Consigue su primer resultado útil en 3 minutos? ¿Qué le
   frena, asusta o confunde? ¿Qué sobra?
6. **Economía**: coste real por usuario (modelos, servidor, ordenadores de los bots), precio, margen,
   cómo evitar que un usuario de pago dé pérdidas, y la forma más simple y legal de cobrar desde España.
7. **Prioriza** por lo que bloquea el lanzamiento. Nada de listas infinitas: lo importante primero,
   con el arreglo concreto.

## Qué revisar

- `src/core/*` (agente, herramientas, aprobaciones, proveedores, memoria, vigilantes, webhooks)
- `src/*.js(x)`, `src/components/*` (UI, renderizado de Markdown y archivos, almacenamiento de tokens)
- `server/*` (autenticación, CORS, WebSockets, Docker, sandbox, ordenadores de los bots, copias)
- `bridge/*` (Puente de suscripciones), `extension/*`, `desktop/*`
- Despliegue: Caddy, compose, VPS, GitHub Pages, secretos y copias de seguridad

## Entregables

1. `docs/AUDITORIA.md`: hallazgos por gravedad (con archivo:línea, caso que falla y arreglo),
   utilidad/UX, legal, y modelo económico con números.
2. `ROADMAP.md` rehecho para el lanzamiento: fases ordenadas por lo que bloquea salir al mercado.
3. Empezar a ejecutar el ROADMAP por lo crítico, probando cada cambio.
