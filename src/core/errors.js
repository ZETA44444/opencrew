// Errors a person can understand: what happened and what to do, with the technical detail apart.
export function humanizeError(e, providerLabel = 'El modelo') {
  const msg = String(e?.message || e || '');
  const status = Number(e?.status ?? (msg.match(/\b(4\d\d|5\d\d)\b/) || [])[1] ?? NaN);
  const p = providerLabel.replace(/\s*\(.*\)$/, '');
  const detail = msg.replace(/\s*→.*$/s, '').slice(0, 300);
  if (e?.budget) return { title: 'Se ha alcanzado el límite de gasto', hint: msg, detail: '' };
  if (/Falta la API key|sin clave/i.test(msg)) return { title: 'Este bot aún no tiene con qué pensar', hint: `Añade una clave de ${p} en Ajustes (la de Gemini es gratis) o cambia el bot a «Automático».`, detail: '' };
  if (status === 401 || status === 403) return { title: `${p} no acepta la clave`, hint: 'Revisa la clave en Ajustes (cópiala entera, sin espacios) o elige otro modelo para este bot.', detail };
  if (status === 429) return { title: `${p} ha llegado a su límite de uso`, hint: 'Es la cuota de tu clave o de tu plan. Espera unos minutos o cambia este bot a «Automático» para que use otro modelo.', detail };
  if (status === 404) return { title: 'Ese modelo ya no está disponible', hint: 'Elige otro modelo en el selector de abajo (o «Automático»).', detail };
  if ([500, 502, 503, 504, 529].includes(status)) return { title: `${p} está saturado ahora mismo`, hint: 'No es culpa tuya. Vuelve a intentarlo en un rato, o activa en el bot «Si el modelo falla, probar otro».', detail };
  if (status === 0 || /sin respuesta|failed to fetch|network|conexión/i.test(msg)) return { title: `No hay conexión con ${p}`, hint: 'Revisa tu conexión a internet y vuelve a intentarlo.', detail };
  return { title: 'Algo ha fallado', hint: 'Vuelve a intentarlo. Si se repite, prueba con otro modelo.', detail: msg.slice(0, 300) };
}

export function errorMarkdown(e, providerLabel) {
  const h = humanizeError(e, providerLabel);
  return `⚠️ **${h.title}**\n\n${h.hint}${h.detail ? `\n\n_Detalle técnico: ${h.detail.replace(/([_*`\\])/g, '\\$1')}_` : ''}`;
}
