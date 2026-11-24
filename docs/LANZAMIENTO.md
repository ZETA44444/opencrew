# OpenCrew: qué no se puede hacer, cuánto cuesta y el MVP para salir ya

Revisión del 24 nov 2026. Complementa [AUDITORIA.md](AUDITORIA.md) (seguridad y experiencia). Lo legal está
comprobado en los textos oficiales de Anthropic y Google y en guías de terceros. **No es asesoría legal:**
antes de cobrar, un asesor tiene que revisar las condiciones y la privacidad.

---

## 1. Lo que hoy choca con las condiciones de las IAs o con la ley

### 🔴 Bloquea el lanzamiento

**1. El Puente con la suscripción de Claude.** Anthropic lo prohíbe expresamente desde 2026:
- Su página legal dice que el acceso con suscripción (Free, Pro, Max) es solo para «el uso normal de Claude
  Code y las apps de Anthropic».
- Prohíbe «enrutar peticiones a través de las credenciales de un plan» y «guardar o intermediar» sesiones
  de Claude.ai.
- Su política de uso prohíbe los servicios que dan acceso a Claude «a través de suscripciones de consumo».
- Lo vigilan desde enero de 2026 y cierran cuentas.

  Usar tu Claude Max para mover a los bots de OpenCrew, aunque sea solo para ti, es justo eso: **arriesgas
  tu cuenta.** Publicarlo en el código abierto anima a otros a incumplirlo.
  → **Propuesta:** quitar el modo Claude del Puente.

**2. El Puente con ChatGPT.** OpenAI no da permiso general. Sus condiciones prohíben compartir o revender el
acceso a una cuenta. La vía legal es su programa oficial «Sign in with ChatGPT» (16 apps socias en octubre
de 2026), que exige ser socio.
→ **Propuesta:** retirarlo también y, más adelante, solicitar el programa oficial.

**3. La clave gratis de Gemini.** La bienvenida la recomienda hoy, pero las condiciones de la API de Gemini
(marzo de 2026) dicen:
- *«Solo puedes usar Servicios de pago cuando ofrezcas apps a usuarios del Espacio Económico Europeo, Suiza o
  Reino Unido»*: un plan gratis de OpenCrew en España no puede basarse en la capa gratuita de Gemini.
- La API es solo para **mayores de 18 años** y **«con fines profesionales o de negocio, no de consumo»**.

  → **Propuestas:**
  - En la versión alojada, la bienvenida deja de empujar la clave gratis.
  - El público objetivo pasa a ser **profesionales y pequeñas empresas, mayores de 18**, lo que además
    simplifica la parte legal.

**4. Saltarse los bloqueos de las webs.** Las políticas de Anthropic y OpenAI prohíben que los agentes
«eludan las protecciones o condiciones de otras plataformas».
- Wallapop, Idealista y similares bloquean bots a propósito.
- Ya he quitado del ordenador de los bots la opción que ocultaba que el navegador está automatizado.
- Se mantienen el cursor visible y el aviso de bloqueo, con el que el bot se detiene en vez de insistir.
- Regla para el producto: si una web bloquea bots, el bot **para y avisa**. Usar tu propio navegador (la
  extensión) solo es razonable para webs donde tú tienes cuenta, actuando tú y con permiso en cada paso.
  El uso aceptable debe decir que el usuario responde de respetar las condiciones de cada web.

**5. Aviso de IA (Ley de IA de la UE, art. 50, vigente desde el 2 ago 2026, y política de Anthropic).** Hay
que decir claramente, desde la primera interacción, que se habla con IA. Multas de hasta 15 M€ o el 3 % de
la facturación.
- **Dentro de la app:** es evidente, pero hay que ponerlo por escrito (registro y cabecera del chat).
- **Hacia fuera:** cuando un bot escribe a **otras personas** (correos, mensajes), tú lo apruebas y lo envías
  como tuyo, o el mensaje indica que lo ha redactado una IA. Las imágenes generadas se marcan como IA.

**6. Gmail y Calendar para otros usuarios.** Leer correo usa permisos «restringidos» de Google.
- A partir de 100 usuarios, Google exige una auditoría de seguridad anual (CASA), de unos 10.000 $ o más.
- **Propuesta:** en la versión alojada, Gmail y Calendar pasan por Composio u otra pasarela que ya está
  verificada; la conexión directa queda para tu servidor y la autoalojada.

### 🟠 Obligatorio antes de cobrar (RGPD y consumo)

- **Condiciones y aceptación:** condiciones de uso, política de privacidad y uso aceptable, aceptados al
  registrarse. Casilla «tengo 18 años o más».
- **Subencargados y contratos de tratamiento (DPA):**
  - Anthropic y OpenAI: el API de pago no entrena con tus datos.
  - Google: solo con servicios de pago.
  - Hostinger: el servidor está en Francia, así que dentro de la UE.
  - Paddle y el proveedor de correo.
- **Derecho de desistimiento de 14 días** para consumidores. El vendedor de registro (Paddle) gestiona IVA,
  facturas y reembolsos. Tú tienes que darte de alta (autónomo o sociedad).
- **Sin rastreadores ni analítica invasiva:** no hace falta banner de cookies, solo la sesión.
- **Registro de actividades de tratamiento:** qué datos se guardan, para qué y cuánto tiempo, y qué hace
  cada bot. Exportar y borrar la cuenta ya está hecho (B5).

### 🟢 Ya está bien

- El API de pago de Anthropic, OpenAI y Google permite construir y vender productos encima, siempre que se
  cumpla su política de uso.
- Las claves propias del usuario (BYOK) se usan solo para él y no se revenden.
- Hecho: datos cifrados, motor aislado por usuario, permisos por acción, contenido externo marcado como no
  fiable, correo saliente bloqueado en los ordenadores de los bots, y exportar y borrar la cuenta.
- La licencia MIT del código abierto es correcta.

---

## 2. Revisión económica (precios de noviembre de 2026; confirmar en las webs oficiales)

### Coste de la IA por usuario

Una tarea típica con herramientas: ~45.000 tokens de entrada y ~2.400 de salida.

| Modelo (entrada / salida por millón) | Por tarea | 10 tareas/día | 50 tareas/día |
|---|---|---|---|
| **Claude Haiku 5.5** (0,10 $ / 0,50 $, hasta 100.000 tokens) | ~0,006 $ | **~1,8 $/mes** | ~9 $/mes |
| Gemini 3.1 Flash-Lite (0,25 $ / 1,50 $) | ~0,015 $ | ~4,5 $/mes | ~22 $/mes |
| Gemini 3.8 Flash (0,75 $ / 3,75 $; **sube a 1,50 $ / 7,50 $ el 1 de diciembre**) | ~0,04–0,08 $ | ~12–24 $/mes | — |
| Claude Sonnet 5.5 (2 $ / 10 $) | ~0,11 $ | ~34 $/mes | ~170 $/mes |
| Grok 4 Fast (0,20 $ / 0,50 $) | ~0,010 $ | ~3 $/mes | ~15 $/mes |
| Grok 4.3 (1,25 $ / 2,50 $) | ~0,06 $ | ~18 $/mes | — |
| Grok 4.7 (2 $ / 6 $; el doble por encima de 200.000 tokens) | ~0,10 $ | ~30 $/mes | — |
| Gemini 3.1 Flash-Lite (0,25 $ / 1,50 $) · 3.1 Pro (2 $ / 12 $) | ~0,015 $ · ~0,12 $ | ~4,5 · ~36 $/mes | — |

**El plan de pago funciona por API con cuatro proveedores** (Claude, Gemini, Grok y OpenAI). El enrutador
(«Automático») elige en cada paso, entre todos sus modelos, el más barato que alcanza la calidad mínima de esa
tarea. Así baja el coste para OpenCrew sin empeorar el resultado para el usuario. Con Gemini solo se puede usar
el servicio de pago (la capa gratis está prohibida para apps en la UE). En xAI hay que confirmar por escrito su
contrato de tratamiento de datos para clientes europeos antes de usarlo con ellos.

**Conclusiones:**
- **Claude Haiku 5.5 es el mejor modelo por defecto:** el más barato y bueno con herramientas. Sonnet queda
  solo para tareas difíciles y gasta más créditos.
- La **caché de prompts** abarata aún más la entrada repetida (instrucciones y herramientas).
- **Ojo:** el modelo «Automático» usa hoy Gemini Flash, que va a subir de precio. Hay que pasarlo a Haiku 5.5.

### Costes fijos al mes

| Concepto | Coste |
|---|---|
| Servidor Hostinger KVM 2 (8 GB, en Francia) | ~9 € |
| Dominio | ~1 € |
| Correo de la app (verificar cuenta y recuperar contraseña; p. ej. Resend, gratis hasta 3.000 al mes) | 0 € |
| Copias fuera del servidor | 1–3 € |
| Cuota de autónomo (tarifa plana el primer año; confirmar con un gestor) | ~80 € |
| **Total** | **~95 €/mes** |

Pagos únicos:
- Revisión legal: 300–800 €.
- Más adelante, si hace falta: Chrome Web Store 5 $ y Apple Developer 99 $ al año.

### Qué deja un usuario Pro a 15 €/mes (IVA incluido)

| Concepto | € |
|---|---|
| Precio | 15,00 |
| − IVA 21 % | −2,60 |
| − Paddle (5 % + 0,50 $) | −1,20 |
| − IA (uso normal con Haiku; tope de créditos incluido 5 €) | −1,70 a −5,00 |
| − Parte del servidor | −0,30 |
| **Margen** | **≈ 6 a 9 €** |

**Punto de equilibrio: unos 12–16 usuarios Pro.**

El límite real es el servidor:
- Un KVM 2 aguanta ~40 usuarios activos.
- Pero solo ~3 ordenadores de bot a la vez. Por eso el ordenador va con horas incluidas y cola.

---

## 3. El MVP: qué sale al mercado ya

**Para quién:** profesionales, autónomos y pequeñas empresas de habla hispana o inglesa, mayores de 18 años.
Lo quieren para investigar, redactar, prospectar, vigilar webs y automatizar rutinas sin programar.

**Promesa:** «Tu equipo de bots con IA que trabaja por ti, sin configurar nada y con un precio fijo».

| | **Gratis (prueba)** | **Pro — 15 €/mes** | **Autoalojado** |
|---|---|---|---|
| IA | 7 días con 1 € de créditos, luego solo tus claves de API (de pago) | Créditos incluidos (~5 € de IA a precio de coste) + tus claves sin recargo | Tus claves |
| Bots | 3 | Ilimitados | Ilimitados |
| Rutinas y vigilantes | Básicos | Sí | Sí |
| Ordenador de bot | No | 20 horas/mes (beta) | Sí |
| Apps | GitHub y Notion con tu token; resto vía Composio | Igual | Todo, Gmail directo incluido |
| Recargas | — | Desde 5 € | — |

**Fuera del MVP** (después):
- el Puente;
- la conexión directa a Gmail y Calendar en la versión alojada;
- el plan Equipo y las salas multijugador;
- la extensión en la Chrome Web Store y la app de escritorio firmada;
- la web de producto completa (de momento basta una página con precios y textos legales, que Paddle exige
  para aprobarte).

**Cómo se lanza:**
1. **Beta cerrada:** 20–50 personas con invitación y precio de fundador (9 €/mes para siempre).
2. Medir activación, tareas por usuario y coste real de IA.
3. Ajustar precio y créditos.
4. Abrir el registro.

---

## 4. Decisiones que tienes que tomar tú

1. **El Puente:** ¿lo retiramos (recomendado) o lo dejamos solo en tu copia privada, sabiendo que arriesgas
   tu cuenta de Claude?
2. **Público:** ¿profesionales y empresas mayores de 18 (recomendado)?
3. **Precio:** ¿15 €/mes, con 9 € para fundadores?
4. **Alta fiscal:** autónomo o sociedad (habla con un gestor) y cuenta en Paddle (o en Stripe Managed Payments).
5. **Dominio** y **proveedor de correo** (B1 y el correo de B2).
