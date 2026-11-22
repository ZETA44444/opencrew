// The app talks to its engine through `api`: in this browser by default, or on your own
// server when you connect one in Ajustes → Servidor (then this browser is just the screen).
import { localApi } from './localApi.js';
import { remoteApi, remoteConfig } from './remote.js';

export const api = remoteConfig() ? remoteApi : localApi;
export const serverMode = !!remoteConfig();
