# Lo que tienes que hacer tú para sacar el MVP

**Regla de oro:** nunca pegues en el chat una clave, contraseña o código secreto. Las claves se guardan
directamente en tu servidor (ver «Cómo guardar una clave»). A mí solo me das datos que no son secretos.

## Cómo guardar una clave en el servidor

En la app **Terminal** de tu Mac, pega este comando cambiando el nombre del final por el que toque:

```bash
ssh -t opencrew '~/opencrew/server/poner-clave.sh OC_AI_ANTHROPIC_KEY'
```

Te pedirá el valor. Pégalo y pulsa Enter. **No se verá nada al pegar: es normal.** Al terminar dirá «Guardado».

---

## Bloque A · Ya puedes hacerlo (no hace falta ser autónomo)

### A1. Dominio (unos 10–20 € al año)
1. Entra en https://www.hostinger.com/domain-name-search , busca un nombre y cómpralo.
2. En https://hpanel.hostinger.com → **Dominios** → tu dominio → **DNS / Servidores de nombres**.
3. Crea dos registros de tipo **A**: nombre `@` con valor `2.25.19.252`, y nombre `www` con el mismo valor.
   Si ya hay otros registros A o AAAA en `@` o `www`, bórralos.

**Me das:** el nombre del dominio.

### A2. Correo de la app, con Resend (hay plan gratuito) — después de A1
1. Crea la cuenta: https://resend.com/signup
2. En https://resend.com/domains → **Add Domain** → tu dominio. Si te deja elegir región, elige la de Europa.
3. Resend te enseña unos registros DNS. Cópialos tal cual en el DNS de Hostinger (mismo sitio que en A1).
4. Vuelve a Resend, pulsa **Verify** y espera a que ponga «Verified» (puede tardar unas horas).
5. En https://resend.com/api-keys crea una clave con permiso **Sending access** y guárdala en el servidor con
   el nombre `RESEND_API_KEY`.

**Me das:** «dominio verificado y clave guardada», y desde qué dirección quieres enviar (p. ej. `hola@tudominio.com`).
Aparte, decide un **correo de soporte** que tú puedas leer. Resend solo envía: para recibir necesitas un buzón.

### A3. Cuentas de IA de la empresa
En las cuatro: usa **saldo de prepago pequeño** (5–10 $ para empezar), **desactiva la recarga automática** o ponle
tope, y pon un **límite de gasto mensual** si la plataforma lo ofrece. Cada clave se enseña **una sola vez**.
Se puede empezar solo con Anthropic y añadir las demás después.

| Proveedor | Dónde | Pasos | Nombre al guardarla |
|---|---|---|---|
| Anthropic (Claude) | https://platform.claude.com | Cuenta → Billing: añade saldo → Limits: límite mensual → API keys: Create key | `OC_AI_ANTHROPIC_KEY` |
| Google (Gemini) | https://aistudio.google.com/apikey y https://console.cloud.google.com/billing | Activa la facturación en un proyecto → crea la clave en ese proyecto → en Facturación → «Presupuestos y alertas», crea un aviso (**avisa, no corta el gasto**) | `OC_AI_GEMINI_KEY` |
| OpenAI | https://platform.openai.com/api-keys y https://platform.openai.com/settings/organization/limits | Añade saldo en Billing → revisa los límites → Create new secret key | `OC_AI_OPENAI_KEY` |
| xAI (Grok) | https://console.x.ai | Crea el equipo → añade saldo → límite de gasto → API Keys | `OC_AI_XAI_KEY` |

**Me das:** qué proveedores has dejado guardados. Con eso compruebo que funcionan y paso el examen de
calidad de los modelos (gasta de ese saldo, entre céntimos y unos pocos dólares; te diré el gasto).

### A4. Contratos de protección de datos (RGPD)
Abre cada enlace, comprueba si ya va incluido en las condiciones o si hay que firmarlo, y **guarda un PDF**.

- Anthropic: https://www.anthropic.com/legal/data-processing-addendum
- Google Cloud: https://cloud.google.com/terms/data-processing-addendum
- OpenAI: https://openai.com/policies/data-processing-addendum
- xAI: https://x.ai/legal/data-processing-addendum (confirma por escrito que cubre a clientes de la UE; hasta entonces no lo uso con clientes)
- Hostinger: https://www.hostinger.com/legal/dpa
- Resend: https://resend.com/legal/dpa
- Paddle (cuando abras la cuenta): https://www.paddle.com/legal/data-processing-addendum

**Me das:** la lista de los que ya tienes y cualquiera que no puedas firmar. No me envíes los documentos firmados.

### A5. Copias de seguridad fuera del servidor, con Backblaze B2
1. Crea la cuenta eligiendo región **EU Central**: https://secure.backblaze.com/user_signup.htm
2. **B2 Cloud Storage** → **Buckets** → **Create a Bucket**: tipo **Private**.
3. **Application Keys** → **Add a New Application Key**, limitada solo a ese bucket.
4. Guarda `keyID` como `BACKUP_KEY_ID` y `applicationKey` como `BACKUP_APP_KEY`.
5. Revisa su política de privacidad (https://www.backblaze.com/company/policy/privacy) y pídeles el contrato de datos.

**Me das:** el nombre del bucket y su «Endpoint» (no son secretos).
Además tendrás que guardar **fuera del servidor** la clave maestra de cifrado: sin ella las copias no sirven.
Te daré el paso cuando monte las copias.

### A6. Avisos al móvil si el servidor falla (gratis)
1. Instala la app **ntfy** en el móvil (https://ntfy.sh).
2. Suscríbete a un tema con un nombre largo e inventado, imposible de adivinar. Funciona como una contraseña.
3. Guarda en el servidor `ALERT_URL` con el valor `https://ntfy.sh/ese-nombre`.

**Me das:** «avisos guardados». Te mando uno de prueba.

### A7. En la app
- Entra en https://2-25-19-252.sslip.io y acepta las condiciones si te las pide.
- Decide si **borro las sesiones antiguas del Puente** (tu Claude y ChatGPT), que siguen en el servidor sin usarse.
  Recomendado: borrarlas.

**Me das:** «borra las sesiones» o «déjalas».

---

## Bloque B · Cuando quieras empezar a cobrar

### B1. Alta como autónomo (o sociedad)
Habla antes con una gestoría: ella te dice el momento, el epígrafe y la cuota.
- Hacienda, alta censal (modelo 036): https://sede.agenciatributaria.gob.es
- Seguridad Social, alta de autónomo (Import@ss): https://portal.seg-social.gob.es

**Me das:** nombre o razón social, NIF, dirección fiscal y correo de contacto. Estos datos **se publican** en
los textos legales. No me des números de cuenta ni de la Seguridad Social.

### B2. Revisión legal
1. Contrata a un asesor de protección de datos y consumo (orientativo: 300–800 €).
2. Envíale los tres textos: https://2-25-19-252.sslip.io/legal/condiciones.html ,
   https://2-25-19-252.sslip.io/legal/privacidad.html y https://2-25-19-252.sslip.io/legal/uso-aceptable.html
3. Pídele también el registro de actividades de tratamiento y qué hacer ante una brecha de datos.
   Guías oficiales: https://www.aepd.es/guias-y-herramientas/guias

**Me das:** sus cambios por escrito.

### B3. Paddle (cobros) — después de B1 y de que esté la página pública (la hago yo)
1. Crea la cuenta: https://login.paddle.com/signup . Comisiones: https://www.paddle.com/pricing
2. Completa la verificación del negocio, la identidad y la cuenta de cobro. **Esto solo lo haces tú.**
3. Envía tu web a aprobación: piden precios, condiciones, privacidad y reembolsos visibles.
4. Crea los productos **Pro** (15 €/mes), **Fundador** (9 €/mes) y la **recarga** de créditos (5 €), con IVA incluido.
5. En las herramientas de desarrollador crea una clave de API y guárdala como `PADDLE_API_KEY`.
   El aviso automático (webhook) lo configuramos juntos cuando lo programe; su secreto será `PADDLE_WEBHOOK_SECRET`.

**Me das:** «cuenta aprobada» y los identificadores de los tres precios (empiezan por `pri_`; no son secretos).

---

## Bloque C · Para lanzar

### C1. Beta cerrada
Busca 20–50 personas mayores de 18 que lo usarían para su trabajo. Apunta su correo y para qué lo quieren,
o pídeles que se apunten a la lista de espera. Las invitas en **Ajustes → Cuenta**.

**Me das:** cuántas tienes y lo que te vayan contando. No hace falta que me pases sus correos.

---

## Orden recomendado

1. A7 (2 minutos) y A6.
2. A1 dominio → A2 correo.
3. A3 cuentas de IA (al menos Anthropic) y A4 contratos.
4. A5 copias.
5. C1: ve apuntando gente.
6. B1 → B2 → B3.

No hace falta terminarlo todo: **avísame cada vez que acabes un punto** y hago mi parte.
No contrates nada que supere lo que quieras gastar: los precios de esta lista son orientativos.
