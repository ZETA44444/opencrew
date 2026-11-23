// Basic mode (default for new users): only chat, team, tasks, apps and keys. Advanced mode shows
// everything technical (MCP, webhooks, server, bridge, delegation, per-bot tools…).
// Existing users who never went through the welcome keep Advanced, so nothing they use disappears.
export const isAdvanced = (settings) => (settings?.uiMode ? settings.uiMode === 'advanced' : !settings?.onboarded);
