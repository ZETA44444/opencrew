async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  state: () => req('GET', '/api/state'),
  messages: (botId) => req('GET', `/api/bots/${botId}/messages`),
  clear: (botId) => req('DELETE', `/api/bots/${botId}/messages`),
  chat: (botId, text) => req('POST', `/api/bots/${botId}/chat`, { text }),
  createBot: (bot) => req('POST', '/api/bots', bot),
  updateBot: (id, patch) => req('PATCH', `/api/bots/${id}`, patch),
  deleteBot: (id) => req('DELETE', `/api/bots/${id}`),
  artifacts: (botId) => req('GET', `/api/bots/${botId}/artifacts`),
  deleteArtifact: (botId, name) => req('DELETE', `/api/bots/${botId}/artifacts/${encodeURIComponent(name)}`),
  saveKeys: (keys) => req('PUT', '/api/settings/keys', keys),
  testProvider: (provider, model) => req('POST', '/api/settings/test', { provider, model }),
  createRoutine: (r) => req('POST', '/api/routines', r),
  updateRoutine: (id, patch) => req('PATCH', `/api/routines/${id}`, patch),
  deleteRoutine: (id) => req('DELETE', `/api/routines/${id}`),
  runRoutine: (id) => req('POST', `/api/routines/${id}/run`),
};
