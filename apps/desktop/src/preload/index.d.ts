import type { IdeSyncApi } from './index.js';

declare global {
  interface Window {
    ideSync: IdeSyncApi;
  }
}
