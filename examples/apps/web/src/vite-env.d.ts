/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HORIZON_MARKET_URL?: string;
  readonly VITE_WEB3AUTH_CLIENT_ID: string;
  readonly VITE_WEB3AUTH_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
