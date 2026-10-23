// noVNC client for live screens (task sandbox, cloud computers, the skill recorder). Loaded on demand.
const NOVNC = "https://cdn.jsdelivr.net/gh/novnc/noVNC@v1.5.0/core/rfb.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type RFBClient = any;
let RFB: any = null;

/** The noVNC RFB class; throws if it cannot be loaded. */
export async function loadRFB(): Promise<any> {
  RFB = RFB || (await import(/* @vite-ignore */ NOVNC)).default;
  return RFB;
}

/** ws:// or wss:// URL for a path on this host. */
export const wsUrl = (path: string) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
