import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Wallet, Copy, Check, LogOut } from "lucide-react";
import {
  useHorizonMarket,
  Modal,
  LoginPanel,
  SellOrderForm,
  WalletBalanceSummary,
  themeToCssVars,
} from "@unspendablelabs/horizon-market-client/react";
import { getPrivateKey, logout as web3authLogout } from "../lib/web3auth.js";
import { goToWallet } from "../lib/route.js";
import { cn } from "../lib/utils.js";

/* ── Logo SVG ──────────────────────────────────────────────── */

function HorizonLogo() {
  // Wordmark only — the standalone logomark (the stylized "H" that sat to the
  // left) is dropped to match the mobile header, which shows just "Horizon". The
  // viewBox is cropped to the wordmark's x-range (~108→375); the gradients use
  // userSpaceOnUse so their absolute coordinates still line up after cropping.
  return (
    <svg
      height="28"
      viewBox="108 0 267 76"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Horizon Market"
    >
      <path d="M111.528 13.04H123.17V32.4551H143.919V13.04H155.561V63.1301H143.919V41.8875H123.17V63.1301H111.528V13.04Z" fill="url(#hm-g3)" />
      <path d="M171.754 61.9022C168.758 60.3301 166.438 58.0997 164.783 55.2209C163.128 52.3322 162.296 48.9719 162.296 45.1301C162.296 41.2884 163.128 37.9183 164.783 35.0394C166.438 32.1507 168.768 29.9302 171.754 28.3581C174.741 26.786 178.227 26 182.202 26C186.177 26 189.595 26.786 192.61 28.3581C195.626 29.9302 197.966 32.1606 199.621 35.0394C201.276 37.9281 202.108 41.2884 202.108 45.1301C202.108 48.9719 201.276 52.342 199.621 55.2209C197.966 58.1095 195.626 60.3301 192.61 61.9022C189.595 63.4742 186.128 64.2603 182.202 64.2603C178.276 64.2603 174.751 63.4742 171.754 61.9022ZM189.007 52.509C190.779 50.5832 191.67 48.1269 191.67 45.1203C191.67 42.1137 190.779 39.6672 189.007 37.7709C187.235 35.8746 184.963 34.9215 182.212 34.9215C179.46 34.9215 177.12 35.8746 175.338 37.7709C173.566 39.6672 172.675 42.1235 172.675 45.1203C172.675 48.1171 173.566 50.5832 175.338 52.509C177.11 54.4348 179.402 55.3977 182.212 55.3977C185.022 55.3977 187.235 54.4348 189.007 52.509Z" fill="url(#hm-g4)" />
      <path d="M208.424 27.1103H218.656V32.0328H219.429C220.223 30.3428 221.427 28.9869 223.043 27.9553C224.658 26.9236 226.391 26.4028 228.261 26.4028C229.759 26.4028 231.111 26.7074 232.325 27.3166V36.6704C231.385 36.2479 230.376 35.9237 229.28 35.6879C228.183 35.4521 227.233 35.3342 226.44 35.3342C224.149 35.3342 222.308 36.1988 220.898 37.9379C219.498 39.677 218.793 41.927 218.793 44.688V63.1205H208.414V27.1103H208.424Z" fill="url(#hm-g5)" />
      <path d="M239.532 20.3994C238.367 19.2499 237.78 17.7859 237.78 15.9977C237.78 14.2094 238.367 12.7553 239.532 11.6057C240.698 10.4561 242.196 9.88623 244.017 9.88623C245.838 9.88623 247.336 10.4561 248.501 11.6057C249.667 12.7553 250.254 14.2192 250.254 15.9977C250.254 17.7761 249.667 19.2499 248.501 20.3994C247.336 21.549 245.838 22.1189 244.017 22.1189C242.196 22.1189 240.698 21.549 239.532 20.3994ZM238.837 27.1102H249.216V63.1303H238.837V27.1102Z" fill="url(#hm-g6)" />
      <path d="M254.688 58.0703L272.636 36.4739V35.6977H255.393V27.1201H287.363V32.2588L270.12 53.8551V54.5626H288.068V63.1402H254.698V58.0703H254.688Z" fill="url(#hm-g7)" />
      <path d="M301.727 61.9022C298.73 60.3301 296.41 58.0997 294.755 55.2209C293.1 52.3322 292.268 48.9719 292.268 45.1301C292.268 41.2884 293.1 37.9183 294.755 35.0394C296.41 32.1507 298.74 29.9302 301.727 28.3581C304.713 26.786 308.199 26 312.174 26C316.149 26 319.567 26.786 322.582 28.3581C325.598 29.9302 327.938 32.1606 329.593 35.0394C331.248 37.9281 332.08 41.2884 332.08 45.1301C332.08 48.9719 331.248 52.342 329.593 55.2209C327.938 58.1095 325.598 60.3301 322.582 61.9022C319.567 63.4742 316.101 64.2603 312.174 64.2603C308.248 64.2603 304.723 63.4742 301.727 61.9022ZM318.979 52.509C320.751 50.5832 321.643 48.1269 321.643 45.1203C321.643 42.1137 320.751 39.6672 318.979 37.7709C317.207 35.8746 314.935 34.9215 312.184 34.9215C309.433 34.9215 307.092 35.8746 305.31 37.7709C303.538 39.6672 302.647 42.1235 302.647 45.1203C302.647 48.1171 303.538 50.5832 305.31 52.509C307.083 54.4348 309.374 55.3977 312.184 55.3977C314.994 55.3977 317.207 54.4348 318.979 52.509Z" fill="url(#hm-g8)" />
      <path d="M338.396 27.1099H348.775V32.1798H349.48C352.143 28.1023 355.629 26.0586 359.927 26.0586C362.591 26.0586 364.95 26.7071 367.007 27.9942C369.063 29.2813 370.649 31.0696 371.775 33.3392C372.901 35.6187 373.459 38.1832 373.459 41.0424V63.13H363.08V42.5162C363.08 40.2662 362.473 38.4485 361.259 37.0631C360.045 35.6777 358.41 34.9899 356.354 34.9899C354.297 34.9899 352.466 35.7367 350.988 37.2399C349.519 38.7432 348.775 40.6199 348.775 42.8699V63.13H338.396V27.1099Z" fill="url(#hm-g9)" />
      <defs>
        <linearGradient id="hm-g3" x1="0.308814" y1="-0.154605" x2="369.805" y2="66.7316" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FACCCE" />
          <stop offset="0.33" stopColor="#F6A7A8" />
          <stop offset="0.66" stopColor="#A3A7D3" />
          <stop offset="1" stopColor="#CACEFA" stopOpacity="0.964706" />
        </linearGradient>
        <linearGradient id="hm-g4" x1="3.24354" y1="0.926886" x2="378.146" y2="60.8619" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FACCCE" />
          <stop offset="0.33" stopColor="#F6A7A8" />
          <stop offset="0.66" stopColor="#A3A7D3" />
          <stop offset="1" stopColor="#CACEFA" stopOpacity="0.964706" />
        </linearGradient>
        <linearGradient id="hm-g5" x1="2.16258" y1="-0.772248" x2="374.593" y2="59.1627" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FACCCE" />
          <stop offset="0.33" stopColor="#F6A7A8" />
          <stop offset="0.66" stopColor="#A3A7D3" />
          <stop offset="1" stopColor="#CACEFA" stopOpacity="0.964706" />
        </linearGradient>
        <linearGradient id="hm-g6" x1="1.5447" y1="2.16265" x2="366.407" y2="63.0245" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FACCCE" />
          <stop offset="0.33" stopColor="#F6A7A8" />
          <stop offset="0.66" stopColor="#A3A7D3" />
          <stop offset="1" stopColor="#CACEFA" stopOpacity="0.964706" />
        </linearGradient>
        <linearGradient id="hm-g7" x1="-0.309067" y1="0.30905" x2="370.423" y2="63.0245" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FACCCE" />
          <stop offset="0.33" stopColor="#F6A7A8" />
          <stop offset="0.66" stopColor="#A3A7D3" />
          <stop offset="1" stopColor="#CACEFA" stopOpacity="0.964706" />
        </linearGradient>
        <linearGradient id="hm-g8" x1="-0.309255" y1="-0.154416" x2="379.227" y2="64.2603" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FACCCE" />
          <stop offset="0.33" stopColor="#F6A7A8" />
          <stop offset="0.66" stopColor="#A3A7D3" />
          <stop offset="1" stopColor="#CACEFA" stopOpacity="0.964706" />
        </linearGradient>
        <linearGradient id="hm-g9" x1="2.62617" y1="-0.772538" x2="373.512" y2="86.1949" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FACCCE" />
          <stop offset="0.33" stopColor="#F6A7A8" />
          <stop offset="0.66" stopColor="#A3A7D3" />
          <stop offset="1" stopColor="#CACEFA" stopOpacity="0.964706" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Address copy button ───────────────────────────────────── */

function AddressRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <span className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-data truncate max-w-[200px]"
          style={{ color: "var(--color-foreground)" }}
        >
          {value}
        </span>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1 rounded transition-colors"
          style={{ color: "var(--color-muted)" }}
          title="Copy address"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

/* ── Credits row ───────────────────────────────────────────── */

function CreditsRow({
  credits,
  freeCredits,
  signInError,
}: {
  credits: number | null;
  freeCredits: number | null;
  signInError: string | null;
}) {
  const loading = credits === null && freeCredits === null;
  const total = (credits ?? 0) + (freeCredits ?? 0);
  return (
    <div
      className="flex items-center justify-between px-3 py-2 gap-2"
      title={
        signInError
          ? `Sign-in failed: ${signInError}`
          : loading
            ? undefined
            : `${freeCredits ?? 0} free + ${credits ?? 0} paid`
      }
    >
      <span
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-muted)" }}
      >
        Credits
      </span>
      {loading && signInError ? (
        <span
          className="text-xs truncate max-w-[170px]"
          style={{ color: "var(--color-error)" }}
        >
          {signInError}
        </span>
      ) : (
        <span
          className="text-sm font-semibold font-data"
          style={{ color: "var(--color-foreground)" }}
        >
          {loading ? "…" : total}
        </span>
      )}
    </div>
  );
}

/* ── Header ────────────────────────────────────────────────── */

export function Header() {
  const { addresses, logout, credits, freeCredits, signInError, theme } =
    useHorizonMarket();
  const [loginOpen, setLoginOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  const handleSell = () => {
    if (addresses) {
      setSellOpen(true);
    } else {
      setLoginOpen(true);
    }
  };

  const handleLoginSuccess = () => {
    setLoginOpen(false);
    setSellOpen(true);
  };

  // "Show all" jumps to the wallet page — close the menu first so it isn't left
  // floating over the new view.
  const handleShowAllBalances = () => {
    setWalletOpen(false);
    goToWallet();
  };

  // Disconnect must clear *both* sessions: Horizon Market's local state (hides
  // the wallet icon) and the Web3Auth session (persisted across refreshes).
  // Skipping the latter lets App.tsx's startup probe silently reconnect.
  const handleLogout = async () => {
    try {
      await web3authLogout();
    } catch (err) {
      console.error("Web3Auth logout failed:", err);
    }
    logout();
  };

  return (
    <>
      <header
        className="sticky top-0 z-50"
        style={{
          height: "var(--header-height)",
          borderBottom: "1px solid var(--color-border)",
          background: "#0b0b15",
        }}
      >
        {/* Centered to the same max-width column as <main>, so the logo lines up
            with the filter bar regardless of viewport width. The 24px left pad
            matches the content column, which is where the filter tab buttons
            start — so the logo's left edge aligns with the "All" underline (the
            tab's full-width border-bottom), not the inset tab text. */}
        <div
          className="flex h-full w-full items-center justify-between mx-auto"
          style={{
            maxWidth: "var(--content-max-width)",
            paddingLeft: "24px",
            paddingRight: "24px",
          }}
        >
          {/* Brand */}
          <div className="flex flex-col items-start gap-1">
            <HorizonLogo />
            {/* Tagline sizing lives in the className (not inline) so the
                `max-sm` breakpoint can nudge it a touch smaller on phones — an
                inline fontSize would override the responsive rule. */}
            <span
              className="font-semibold tracking-wide text-[13px] max-sm:text-[12px]"
              style={{
                color: "var(--color-foreground)",
                whiteSpace: "nowrap",
              }}
            >
              The DEX of Bitcoin metaprotocols
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
          <button
            onClick={handleSell}
            className={cn(
              "px-5 py-2 rounded-lg text-sm font-semibold transition-all",
              "hover:opacity-90 active:scale-95"
            )}
            style={{
              background: "var(--color-primary)",
              color: "#0b0b15",
            }}
          >
            Sell
          </button>

          {addresses && (
            <DropdownMenu.Root open={walletOpen} onOpenChange={setWalletOpen}>
              <DropdownMenu.Trigger asChild>
                <button
                  className="p-2.5 rounded-lg transition-colors"
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-foreground)",
                  }}
                  aria-label="Wallet"
                >
                  <Wallet size={18} />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  collisionPadding={8}
                  className="z-50 min-w-[300px] rounded-xl py-2 shadow-2xl"
                  style={{
                    background: "#13131f",
                    border: "1px solid var(--color-border)",
                    // Never wider than the viewport (minus an 8px gutter each
                    // side): on phones the menu would otherwise overflow and
                    // Radix would shove it flush against the left edge. With this
                    // cap + collisionPadding it stays inset from both edges.
                    maxWidth: "calc(100vw - 16px)",
                  }}
                >
                  {/* Title — no separator below: the address rows read as its
                      content rather than a divided-off section. Extra top padding
                      gives the menu some breathing room above the heading. */}
                  <div
                    className="px-3 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-muted)" }}
                  >
                    Addresses
                  </div>

                  <AddressRow label="Segwit (P2WPKH)" value={addresses.p2wpkh} />
                  {addresses.p2tr && (
                    <AddressRow label="Taproot (P2TR)" value={addresses.p2tr} />
                  )}

                  <DropdownMenu.Separator
                    className="my-1 h-px"
                    style={{ background: "var(--color-border)" }}
                  />

                  {/* Credits sit directly under the addresses. */}
                  <CreditsRow
                    credits={credits}
                    freeCredits={freeCredits}
                    signInError={signInError}
                  />

                  <DropdownMenu.Separator
                    className="my-1 h-px"
                    style={{ background: "var(--color-border)" }}
                  />

                  {/* Balances live in a Radix Portal (rendered at document.body),
                      outside the provider's theme-vars wrapper — so re-apply the
                      `--hm-*` vars here or the SDK component falls back to its
                      default (light) palette. "Show all" is rendered in the footer
                      row below (not via onShowAll) so it can sit opposite
                      Disconnect. */}
                  <div className="px-3 py-2" style={themeToCssVars(theme)}>
                    <WalletBalanceSummary />
                  </div>

                  <DropdownMenu.Separator
                    className="my-1 h-px"
                    style={{ background: "var(--color-border)" }}
                  />

                  {/* Footer: Disconnect pinned left, "Show all" pinned right. */}
                  <div className="flex items-center justify-between px-3 py-1">
                    <DropdownMenu.Item asChild>
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-1 py-1 text-sm transition-colors"
                        style={{ color: "var(--color-error)" }}
                      >
                        <LogOut size={14} />
                        Disconnect
                      </button>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <button
                        onClick={handleShowAllBalances}
                        className="px-1 py-1 text-sm font-semibold transition-colors"
                        style={{ color: "var(--color-primary)" }}
                      >
                        Open wallet →
                      </button>
                    </DropdownMenu.Item>
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          </div>
        </div>
      </header>

      {/* Login modal */}
      <Modal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        title="Login or sign up"
      >
        <LoginPanel
          getPrivateKey={getPrivateKey}
          onSuccess={handleLoginSuccess}
        />
      </Modal>

      {/* Sell modal — kept open on success so SellOrderForm's result screen
          (success message + mempool.space link) is shown; the user dismisses it
          via the ✕ / Escape / overlay, or starts another with "New order". */}
      <Modal open={sellOpen} onClose={() => setSellOpen(false)} title="Sell">
        <SellOrderForm onClose={() => setSellOpen(false)} />
      </Modal>
    </>
  );
}
