/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HORIZON_MARKET_URL?: string;
  /** Ord API base URL — ordinals only load in the Sell form when this is set. */
  readonly VITE_ORD_API_URL?: string;
  readonly VITE_WEB3AUTH_CLIENT_ID: string;
  readonly VITE_WEB3AUTH_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
