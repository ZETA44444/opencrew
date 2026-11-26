# Tus 11 tareas, paso a paso

Hazlas en orden. Marca cada casilla al terminar y **avísame**: en cada tarea tienes la frase que me puedes enviar.
No hace falta ser autónomo para las tareas 1 a 8.

> **Nunca pegues en el chat** claves, contraseñas, códigos de verificación ni datos bancarios.
> Si me mandas una captura, comprueba antes que no se vea ninguno.

Los botones de estas webs cambian a veces de nombre (suelen estar en inglés). Si algo no coincide, mándame una captura.
Los precios son orientativos: mira el precio final antes de pagar.

---

## Antes de empezar: cómo guardar una clave en tu servidor
Lo usarás en las tareas 2, 4, 5, 7 y 11.

1. En tu Mac pulsa **⌘ + Espacio**, escribe `Terminal` y pulsa **Enter**.
2. Copia este comando y pégalo en la Terminal (**⌘ + V**). Cambia solo la última palabra por el nombre que te diga la tarea:

```bash
ssh -t opencrew '~/opencrew/server/poner-clave.sh OC_AI_ANTHROPIC_KEY'
```

3. Pulsa **Enter**. Saldrá «Pega el valor de…».
4. Copia la clave en la web del proveedor, vuelve a la Terminal, pega con **⌘ + V** y pulsa **Enter**.
   **No se ve nada al pegar: es normal.**
5. Debe salir **«Guardado (… caracteres)»**. Si sale un error, copia solo el mensaje de error (sin la clave) y envíamelo.
6. Al acabar, copia cualquier otra palabra para que la clave no se quede en el portapapeles.

---

## ☐ 1. La app y las sesiones antiguas (2 minutos, gratis)
1. Abre https://2-25-19-252.sslip.io
2. Escribe tu correo y contraseña y pulsa **Entrar**.
3. Si sale «Han cambiado las condiciones», ábrelas, léelas, marca la casilla y pulsa **Aceptar y seguir**.
4. Decide qué hacer con las sesiones antiguas de Claude y ChatGPT del Puente. Siguen en el servidor y nada las usa.
   Recomiendo borrarlas (tus cuentas de Claude y ChatGPT no se borran).

**Envíame:** «Borra las sesiones del Puente» o «Déjalas».

## ☐ 2. Avisos al móvil si el servidor falla (5 minutos, gratis)
1. Instala la app **ntfy** desde la App Store o Google Play (web: https://ntfy.sh).
2. Inventa un nombre largo e imposible de adivinar, solo con letras, números y guiones. No uses tu nombre ni «opencrew» solo.
   Quien lo sepa puede leer tus avisos, así que **no me lo envíes**.
3. En ntfy pulsa **+** (suscribirse a un tema), escribe ese nombre y confirma. Deja el servidor que viene puesto.
4. Permite las notificaciones cuando el móvil te lo pida.
5. Guarda en tu servidor, con el comando de arriba y el nombre `ALERT_URL`. El valor es `https://ntfy.sh/` seguido de tu nombre, todo junto.

**Envíame:** «Avisos guardados». Te mando uno de prueba.

## ☐ 3. Dominio (15 minutos; unos 10–20 € al año)
**Comprarlo**
1. Abre https://www.hostinger.com/domain-name-search
2. Escribe el nombre que quieres y elige la terminación (`.com`, `.es`…). Antes, busca ese nombre en internet para no usar la marca de otra empresa.
3. Añádelo al carrito, entra con tu cuenta de Hostinger y paga. Mira el **precio de renovación**, que suele ser mayor que el del primer año. No necesitas contratar hosting ni extras.
4. Si Hostinger te pide verificar el correo del titular, hazlo (si no, pueden suspender el dominio).

**Apuntarlo a tu servidor**

5. Entra en https://hpanel.hostinger.com → **Domain portfolio (Dominios)** → **Manage (Administrar)** junto a tu dominio → **DNS / Nameservers** en el menú lateral.
6. Borra los registros de tipo **A**, **AAAA** o **CNAME** cuyo nombre sea `@` o `www`. **No borres los demás** (en especial MX y TXT).
7. Añade un registro: Tipo `A` · Nombre `@` · Apunta a `2.25.19.252` · TTL el que venga.
8. Añade otro: Tipo `A` · Nombre `www` · Apunta a `2.25.19.252`.
9. Puede tardar hasta 24 horas en funcionar. Es normal que tu dominio aún no abra la app: eso lo configuro yo.

**Envíame:** el nombre del dominio.

## ☐ 4. Correo de la app con Resend (20 minutos; hay plan gratuito) — después de la 3
1. Crea tu cuenta en https://resend.com/signup y confirma tu correo.
2. Abre https://resend.com/domains → **Add Domain**.
3. Escribe tu dominio. En **Region** elige **eu-west-1 (Ireland)** y confirma.
4. En la pestaña **Records** verás varios registros. Deja esa pestaña abierta.
5. En otra pestaña abre el DNS de Hostinger (tarea 3, paso 5).
6. Crea en Hostinger cada registro de Resend, **uno por uno**, copiando y pegando: Tipo, Nombre, Valor y, en el MX, la Prioridad.
   - Muchos van en el subdominio `send`, no en `@`. Respeta el nombre que ponga Resend.
   - Si el nombre incluye tu dominio al final, en Hostinger escribe solo la parte de delante.
   - No borres registros que ya tuvieras.
7. Vuelve a Resend y pulsa **Verify**. Suele tardar unos 15 minutos y puede llegar a 72 horas. Espera hasta que ponga **Verified**.
8. Abre https://resend.com/api-keys → **Create API Key** → nombre `OpenCrew` → permiso **Sending access** → tu dominio → **Add**.
9. Copia la clave (solo se ve una vez) y guárdala con el nombre `RESEND_API_KEY`.
10. Consigue un **buzón de soporte** que puedas leer. Resend solo envía; para recibir en `soporte@tudominio` necesitas contratar o activar un correo en Hostinger (si añades sus registros, no borres los de Resend). Para empezar vale otro buzón tuyo, pero ten en cuenta que esa dirección será pública.

**Envíame:** «Dominio verificado y clave guardada», la dirección de envío (p. ej. `hola@tudominio.com`) y el correo de soporte.

## ☐ 5. Cuentas de IA de la empresa (30–45 minutos; desde unos 5 $ cada una)
Empieza por **Anthropic**; las otras tres pueden esperar. Es pago por uso y es distinto de tus suscripciones a Claude o ChatGPT.
Los saldos pueden caducar y no devolverse: carga poco.

### 5a. Anthropic (Claude)
1. Entra en https://platform.claude.com y crea la cuenta (o inicia sesión).
2. Ve a **Settings → Billing** → **Buy credits**. Pon la cantidad mínima o unos 5–10 $ y confirma.
3. En esa página, en **Auto-reload**, compruébalo y déjalo **desactivado**.
4. Si ves un apartado **Limits** con límite de gasto mensual, ponlo en 20 $.
5. Ve a **API keys** → **Create key** → nombre `OpenCrew` → copia la clave.
6. Guárdala con el nombre `OC_AI_ANTHROPIC_KEY`.

### 5b. Google (Gemini)
1. Entra en https://aistudio.google.com/apikey con tu cuenta de Google y acepta las condiciones.
2. Pulsa **Create API key** (si te pide proyecto, crea uno llamado `OpenCrew`).
3. En esa página pulsa **Set up billing** → crea o enlaza una cuenta de facturación → añade el método de pago.
4. Si te pide saldo por adelantado (prepago), el mínimo es de unos 5 $. Deja la recarga automática desactivada.
5. Abre https://aistudio.google.com/spend → elige el proyecto → **Monthly spend cap** → **Edit spend cap** → 20 $. Puede pasarse un poco, porque el gasto se cuenta con unos minutos de retraso.
6. Comprueba que la clave aparece como **de pago**, no gratuita. Cópiala y guárdala con el nombre `OC_AI_GEMINI_KEY`.

### 5c. OpenAI
1. Entra en https://platform.openai.com/api-keys y crea la cuenta o inicia sesión (puede pedirte verificar el teléfono).
2. **Settings → Billing**: añade método de pago y 5–10 $ de saldo. Desactiva **auto recharge**.
3. Revisa https://platform.openai.com/settings/organization/limits y, si te deja poner un presupuesto o aviso mensual, ponlo en 20 $. Un aviso no siempre corta el gasto.
4. Vuelve a **API keys** → **Create new secret key** → nombre `OpenCrew` → copia la clave.
5. Guárdala con el nombre `OC_AI_OPENAI_KEY`.

### 5d. xAI (Grok)
1. Entra en https://console.x.ai y crea la cuenta y el equipo.
2. En **Billing**, añade 5–10 $ de saldo, sin recarga automática. Si hay límite de gasto, ponlo.
3. En **API Keys** → crear clave → nombre `OpenCrew` → copia la clave.
4. Guárdala con el nombre `OC_AI_XAI_KEY`.
5. No la usaré con clientes hasta que resuelvas su contrato de datos (tarea 6).

**Envíame:** «He guardado las claves de: …». Después compruebo que funcionan y hago el examen de calidad de los modelos, que gasta parte de ese saldo.

## ☐ 6. Contratos de protección de datos (45 minutos, gratis)
Un «DPA» es el contrato que dice cómo trata los datos de tus clientes cada proveedor.

1. Crea en tu Mac una carpeta privada `Contratos OpenCrew` (**no** dentro de la carpeta del proyecto, que es pública en GitHub).
2. Abre cada enlace:
   - Anthropic: https://www.anthropic.com/legal/data-processing-addendum
   - Google Cloud: https://cloud.google.com/terms/data-processing-addendum
   - OpenAI: https://openai.com/policies/data-processing-addendum
   - xAI: https://x.ai/legal/data-processing-addendum
   - Hostinger: https://www.hostinger.com/legal/dpa
   - Resend: https://resend.com/legal/dpa
3. En cada uno busca si dice que **ya forma parte de las condiciones** que aceptaste o si hay que **firmarlo** (suele haber un botón o formulario). Si hay que firmarlo, revísalo con tu asesor si tienes dudas y fírmalo tú.
4. Guarda un PDF de cada uno: **⌘ + P** → **PDF** → **Guardar como PDF**, en tu carpeta. Anota la fecha.
5. Para xAI, si no queda claro que cubre a clientes de la Unión Europea, escribe a su soporte desde su web:
   > We are an EU-based business using the xAI API with end users in the EU. Does your Data Processing Addendum cover this use, including international transfers under the GDPR? How can we execute it?

**Envíame:** qué contratos tienes resueltos y cuáles no. No me envíes los documentos firmados.

## ☐ 7. Copias de seguridad con Backblaze (20 minutos; de pago según uso)
1. Crea la cuenta en https://secure.backblaze.com/user_signup.htm . **Importante:** antes de crearla, elige región **EU Central** (después no se puede cambiar).
2. Confirma tu correo y activa la verificación en dos pasos. Guarda tus códigos de recuperación.
3. Menú **B2 Cloud Storage → Buckets → Create a Bucket**.
4. Nombre único y sin datos personales (p. ej. `opencrew-copias-` y unos números). Files: **Private**. Crea el bucket.
5. Anota el nombre del bucket y el **Endpoint** que muestra (algo como `s3.eu-central-…backblazeb2.com`).
6. Menú **Application Keys → Add a New Application Key**. Nombre `opencrew-copias`; acceso **solo a ese bucket**; **Read and Write**; marca «Allow List All Bucket Names» si aparece.
7. Verás `keyID` y `applicationKey` (la segunda **solo una vez**). Guarda cada una con los nombres `BACKUP_KEY_ID` y `BACKUP_APP_KEY` (ejecuta el comando dos veces).
8. Lee https://www.backblaze.com/company/policy/privacy y pide su contrato de datos desde su soporte.

**Envíame:** el nombre del bucket y el Endpoint. Las copias todavía no están programadas: las monto yo entonces, y te explicaré cómo guardar aparte la clave maestra para poder recuperarlas.

## ☐ 8. Gente para la beta (a tu ritmo)
1. Haz una lista privada de 20–50 personas mayores de 18 que usarían OpenCrew en su trabajo: autónomos, tiendas, agencias, comerciales…
2. Envíales un mensaje como este:
   > Estoy preparando OpenCrew, un equipo de bots de inteligencia artificial que ayuda a investigar, redactar y automatizar tareas. Busco gente para probar la versión beta y darme su opinión. ¿Te apetece?
3. A quien diga que sí, anota su correo y para qué lo quiere.
4. **No los invites todavía**: primero deben estar listos el correo y la IA de la empresa. Te diré cuándo.
5. Cuando toque: app → **Ajustes → Cuenta y datos** → escribe para quién es → **Crear invitación** → **Copiar enlace** → envíaselo. Cada enlace vale una vez y dura 14 días.

**Envíame:** cuántas personas tienes y para qué lo quieren (sin nombres ni correos).

---

## ☐ 9. Alta de autónomo (solo cuando vayas a cobrar)
**Habla antes con una gestoría**: puede hacerlo por ti y decirte el epígrafe, el IVA, las cuotas y las ayudas que te correspondan. Necesitas certificado digital o Cl@ve.

1. Consigue **Cl@ve** o el certificado digital si no los tienes.
2. Decide con la gestoría el nombre de la actividad, el epígrafe y la fecha de inicio.
3. **Primero Hacienda:** https://sede.agenciatributaria.gob.es → busca **Modelo 036** → alta en el censo. Se presenta antes o el mismo día de empezar. Guarda el justificante.
4. **Después Seguridad Social:** https://portal.seg-social.gob.es → **Import@ss** → alta como trabajo autónomo, con la misma fecha. Guarda el justificante.
5. Si cumples los requisitos, **pide la tarifa plana al hacer el alta** (suele rondar los 80 €/mes el primer año; confirma la cifra actual).
6. Pregunta a la gestoría qué declaraciones tendrás que presentar y cómo facturar los pagos de Paddle.

**Envíame:** nombre o razón social, NIF, dirección fiscal y correo de contacto. **Se publicarán** en los textos legales. No me envíes datos bancarios, el número de la Seguridad Social ni documentos.

## ☐ 10. Revisión legal con un asesor (orientativo: 300–800 €)
1. Busca un asesor o despacho con experiencia en protección de datos, comercio electrónico y consumo. Pide presupuesto cerrado a dos o tres.
2. Envíale estos enlaces:
   - https://2-25-19-252.sslip.io/legal/condiciones.html
   - https://2-25-19-252.sslip.io/legal/privacidad.html
   - https://2-25-19-252.sslip.io/legal/uso-aceptable.html
3. Cuéntale: es un servicio de bots de IA, para mayores de 18, con plan de 15 €/mes, datos en un servidor en Francia, y proveedores de IA fuera de la UE. Dale la lista de la tarea 6.
4. Pídele: revisar los tres textos; reembolsos y desistimiento de 14 días; Ley de IA; el **registro de actividades de tratamiento**; qué hacer ante una **brecha de datos**; y si necesitas aviso legal o evaluación de impacto.
5. Guías oficiales: https://www.aepd.es/guias-y-herramientas/guias

**Envíame:** sus cambios por escrito.

## ☐ 11. Cobros con Paddle — después de la 9, la 10 y mi página pública
**No empieces hasta que te avise de que la página de precios está lista.**

1. Crea la cuenta en https://login.paddle.com/signup como vendedor. Mira las comisiones en https://www.paddle.com/pricing
2. Activa la verificación en dos pasos.
3. Completa los datos del negocio, tu identidad y la cuenta donde cobrarás. **Estos datos solo los introduces tú.**
4. Envía tu web a revisión. Debe mostrar producto, precios, condiciones, privacidad y reembolsos. Si la rechazan, envíame el motivo.
5. En **Catalog → Products** crea:
   - `OpenCrew Pro`: precio recurrente **mensual**, 15 €.
   - `OpenCrew Fundador`: recurrente **mensual**, 9 €.
   - `Recarga de créditos`: pago **único**, 5 €. Antes de crearla, confirmaremos cuántos créditos da.
6. En cada precio, indica que el importe **incluye impuestos** y copia su identificador (`pri_…`).
7. En **Developer tools → Authentication** crea una clave de API y guárdala con el nombre `PADDLE_API_KEY`.
8. El aviso automático de pagos (webhook) lo configuramos juntos cuando tenga programado el cobro.
9. Acepta o descarga su contrato de datos: https://www.paddle.com/legal/data-processing-addendum

**Envíame:** «Cuenta aprobada» y los tres identificadores `pri_…` (no son secretos).
