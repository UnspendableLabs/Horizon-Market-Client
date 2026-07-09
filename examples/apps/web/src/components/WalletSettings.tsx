import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useHorizonMarket } from "@unspendablelabs/horizon-market-client/react";

/**
 * Wallet-derivation settings on the web wallet page:
 *   - a switch to opt into the Horizon Wallet (BIP39) derivation instead of the
 *     default single-key model that matches horizon.market;
 *   - when on, a "reveal recovery phrase" panel (12 words) so the wallet can be
 *     re-imported into the Horizon Wallet extension / XVerse and reach the SAME
 *     addresses the app shows.
 *
 * 12 words (not 24): Horizon Wallet only imports 12-word phrases, and XVerse
 * accepts 12 too — so 12 is the one length that works everywhere. Driven through
 * the SDK context (setDerivationMode); the app persists the choice.
 */
export function WalletSettings() {
  const { derivationMode, setDerivationMode, exportMnemonic } =
    useHorizonMarket();

  const bip39 = derivationMode === "horizon-wallet";
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-hide the phrase whenever the mode changes (the revealed words would
  // otherwise be stale — a different wallet).
  useEffect(() => {
    setRevealed(null);
    setCopied(false);
  }, [derivationMode]);

  const words = revealed ? revealed.trim().split(/\s+/) : [];

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
        borderRadius: 14,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      <h2
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--color-foreground)",
          margin: 0,
        }}
      >
        Address derivation
      </h2>

      {/* Mode switch */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <Switch
          checked={bip39}
          onChange={(on) =>
            setDerivationMode(on ? "horizon-wallet" : "horizon-market")
          }
          label="Use BIP39 derivation"
        />
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)", lineHeight: 1.5 }}>
        {bip39
          ? "On — addresses follow the Horizon Wallet / XVerse convention (BIP84 + BIP86). Reveal the 12-word recovery phrase below to import this wallet elsewhere."
          : "Off — addresses match horizon.market (one key backs both address types). Turn on to get a 12-word recovery phrase compatible with Horizon Wallet / XVerse."}
      </p>

      {bip39 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={() => {
              if (revealed) {
                setRevealed(null);
                setCopied(false);
              } else {
                setRevealed(exportMnemonic());
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              alignSelf: "flex-start",
              padding: "10px 16px",
              borderRadius: 10,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-foreground)",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
            {revealed ? "Hide recovery phrase" : "Reveal recovery phrase (12 words)"}
          </button>

          {revealed && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                }}
              >
                {words.map((w, i) => (
                  <div
                    key={`${i}-${w}`}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "var(--color-background, #0b0b15)",
                      border: "1px solid var(--color-border)",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--color-muted)", width: 18, textAlign: "right" }}>
                      {i + 1}
                    </span>
                    <span style={{ color: "var(--color-foreground)", fontWeight: 600 }}>{w}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(revealed)
                    .then(() => setCopied(true))
                    .catch(() => {});
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  alignSelf: "flex-start",
                  padding: "8px 14px",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--color-foreground)",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copied" : "Copy"}
              </button>

              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "var(--color-muted)",
                  lineHeight: 1.5,
                }}
              >
                Import these 12 words into Horizon Wallet or XVerse to reach the
                same addresses shown here.
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "var(--color-error, #f87171)",
                  lineHeight: 1.5,
                }}
              >
                Anyone with this phrase controls the funds on these addresses.
                Never share it. Store it offline.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Minimal accessible on/off switch styled with the app's theme vars. */
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        cursor: "pointer",
        background: "transparent",
        border: "none",
        padding: 0,
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 44,
          height: 26,
          borderRadius: 999,
          flexShrink: 0,
          background: checked ? "var(--color-primary)" : "var(--color-border)",
          position: "relative",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.15s",
          }}
        />
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-foreground)" }}>
        {label}
      </span>
    </button>
  );
}
