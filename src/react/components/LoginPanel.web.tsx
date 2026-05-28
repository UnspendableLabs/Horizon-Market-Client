import type { CSSProperties } from "react";
import type { Addresses } from "../context.js";
import { useLoginPanel } from "../hooks/useLoginPanel.js";
import { cx } from "../internal/format.js";
import * as ws from "../internal/styles.web.js";
import { webTokens } from "../theme.js";

export interface LoginPanelClassNames {
  root?: string;
  label?: string;
  input?: string;
  button?: string;
  status?: string;
  address?: string;
  error?: string;
}

export interface LoginPanelProps {
  /**
   * Platform-specific function to obtain the wallet private key.
   * Typically wraps a Web3Auth provider on the web.
   * The `email` argument is the value entered in the form (if provided).
   */
  getPrivateKey: (email: string) => Promise<string>;
  /**
   * When true (default), the component probes `getPrivateKey('')` on mount
   * to detect an existing session (e.g. after a Web3Auth redirect callback).
   */
  autoDetectSession?: boolean;
  emailLabel?: string;
  connectLabel?: string;
  onSuccess?: (addresses: Addresses) => void;
  onError?: (error: Error) => void;
  className?: string;
  classNames?: LoginPanelClassNames;
  style?: CSSProperties;
}

const rootStyle: CSSProperties = { ...ws.cardRoot, maxWidth: 420 };

const addressStyle: CSSProperties = {
  fontFamily: "monospace",
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
  wordBreak: "break-all",
};

export function LoginPanel({
  getPrivateKey,
  autoDetectSession = true,
  emailLabel = "Email",
  connectLabel = "Connect with Web3Auth",
  onSuccess,
  onError,
  className,
  classNames,
  style,
}: LoginPanelProps) {
  const { email, setEmail, phase, error, addresses, connect } = useLoginPanel({
    getPrivateKey,
    autoDetectSession,
    onSuccess,
    onError,
  });

  const root: CSSProperties = { ...rootStyle, ...style };

  if (phase === "success" && addresses) {
    return (
      <div className={cx(classNames?.root, className)} style={root}>
        <div
          className={classNames?.status}
          style={{ color: webTokens.success }}
        >
          ✅ Connected
        </div>
        <div className={classNames?.address} style={addressStyle}>
          {addresses.p2wpkh}
        </div>
        {addresses.p2tr && (
          <div className={classNames?.address} style={addressStyle}>
            {addresses.p2tr}
          </div>
        )}
      </div>
    );
  }

  const disabled = phase === "verifying" || !email;

  return (
    <div className={cx(classNames?.root, className)} style={root}>
      <label className={classNames?.label} style={ws.label}>
        {emailLabel}
        <input
          className={classNames?.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={phase === "verifying"}
          placeholder="you@example.com"
          style={ws.input}
        />
      </label>
      <button
        type="button"
        className={classNames?.button}
        disabled={disabled}
        onClick={connect}
        style={ws.withDisabled(ws.primaryButton, disabled)}
      >
        {phase === "verifying" ? "Verifying…" : connectLabel}
      </button>
      {phase === "error" && error && (
        <div className={classNames?.error} style={ws.errorText}>
          ✗ {error.message}
        </div>
      )}
    </div>
  );
}
