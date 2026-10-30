import type { DrQuiroApi } from '../shared/ipc';

declare global {
  interface Window {
    drquiro: DrQuiroApi;
  }
}

export const api: DrQuiroApi = window.drquiro;
