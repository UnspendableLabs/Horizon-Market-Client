import { Send } from "lucide-react";
import { NETWORKS, type UiNetwork } from "../lib/networks.js";

const ORDER: UiNetwork[] = ["mainnet", "signet"];

interface FooterProps {
  network: UiNetwork;
  onChange: (network: UiNetwork) => void;
}

const legalLinks = [
  { href: "https://horizon.market/terms", label: "Terms of Service" },
  { href: "https://horizon.market/privacy", label: "Privacy Policy" },
];

function HorizonLogo({ width = 50, height = 53 }: { width?: number; height?: number }) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 30 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M21.4878 32L21.4878 -3.72007e-07L30 0L30 32L21.4878 32Z"
        fill="url(#footer_logo_p0)"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.52151 9.28361e-08L8.52151 32L0.00927734 32L0.00927772 0L8.52151 9.28361e-08Z"
        fill="url(#footer_logo_p1)"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M30 0C30 6.44873 28.8983 12.0857 24.732 16.1336C21.7832 18.9985 18.3761 19.7193 16.0975 20.2014C16.022 20.2174 15.9478 20.2331 15.8749 20.2486C13.4758 20.7588 12.289 21.089 11.2354 22.0791C10.0985 23.3099 9.51438 24.3276 9.14525 25.5562C8.72774 26.9459 8.51223 28.8476 8.51223 32H0C0 28.5963 0.212818 25.6785 0.999977 23.0584C1.8275 20.304 3.20691 18.1391 5.12604 16.0891L5.1953 16.0151L5.26795 15.9446C8.21333 13.0828 11.6186 12.3625 13.8952 11.8809C13.9719 11.8647 14.0473 11.8488 14.1214 11.833C16.5692 11.3124 17.7579 10.9781 18.8317 9.93474C20.4494 8.36307 21.4878 5.72688 21.4878 0H30Z"
        fill="#FEFBF9"
      />
      <mask
        id="footer_logo_mask"
        style={{ maskType: "alpha" }}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="30"
        height="32"
      >
        <g style={{ mixBlendMode: "multiply" }}>
          <path
            d="M8.52148 13.6172C10.4983 12.6021 12.4302 12.1908 13.8955 11.8809C13.972 11.8647 14.0472 11.8487 14.1211 11.833C16.569 11.3124 17.7582 10.9779 18.832 9.93457C20.4496 8.36287 21.4873 5.72659 21.4873 0H30V32H21.4873V18.4561C19.5046 19.4768 17.5673 19.8902 16.0977 20.2012C16.0222 20.2171 15.9479 20.2335 15.875 20.249C13.476 20.7593 12.2889 21.089 11.2354 22.0791C10.0985 23.3098 9.51464 24.328 9.14551 25.5566C8.77479 26.7907 8.56418 28.4285 8.52148 30.9873V32H0C4.05423e-09 31.6529 0.00397876 31.3108 0.00878906 30.9736V0H8.52148V13.6172Z"
            fill="#D9D9D9"
          />
        </g>
      </mask>
      <g mask="url(#footer_logo_mask)">
        <g style={{ mixBlendMode: "multiply" }}>
          <rect
            x="-0.5"
            y="-85"
            width="31"
            height="172"
            rx="15.5"
            fill="url(#footer_logo_p2)"
          />
        </g>
      </g>
      <defs>
        <linearGradient
          id="footer_logo_p0"
          x1="21.4487"
          y1="-3.73714e-07"
          x2="21.4487"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.22" stopColor="#D8D8D8" />
          <stop offset="0.78" stopColor="white" />
        </linearGradient>
        <linearGradient
          id="footer_logo_p1"
          x1="8.56056"
          y1="32"
          x2="8.56056"
          y2="9.3262e-08"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.22" stopColor="#D8D8D8" />
          <stop offset="0.78" stopColor="white" />
        </linearGradient>
        <linearGradient
          id="footer_logo_p2"
          x1="0.102442"
          y1="-84.9449"
          x2="98.9624"
          y2="25.9891"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#DFD9BF" />
          <stop offset="0.125" stopColor="#EED09A" />
          <stop offset="0.255" stopColor="#EEB395" />
          <stop offset="0.405" stopColor="#E9A7AF" />
          <stop offset="0.605" stopColor="#9B86D7" />
          <stop offset="0.815" stopColor="#509FC0" />
          <stop offset="1" stopColor="#7DC2BC" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const socialIconStyle = {
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-surface-hover)",
  borderRadius: "var(--radius-sm)",
} as const;

/**
 * Site footer, mirroring horizon.market's footer but reduced to the Legal
 * column, with the mainnet ⇄ signet network switch bottom-left and the
 * copyright bottom-right.
 *
 * Lives OUTSIDE <HorizonMarketProvider> (so it survives the provider's
 * `key={network}` remount) and uses only the global theme CSS vars from
 * globals.css, which are available app-wide. It sits in normal flow (not
 * sticky), so you scroll to reveal it.
 */
export function Footer({ network, onChange }: FooterProps) {
  return (
    <footer
      className="w-full"
      style={{ borderTop: "1px solid var(--color-border)" }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "var(--content-max-width)",
          margin: "0 auto",
          padding: "40px 24px 32px",
        }}
      >
        {/* Top: logo (left, vertically centered) + the Legal column (right) */}
        <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-8">
          <HorizonLogo width={50} height={53} />

          <div className="flex flex-col items-start">
            <h3
              className="text-lg font-bold mb-5"
              style={{
                color: "var(--color-off-white)",
                fontFamily: "'Montserrat', system-ui, sans-serif",
                lineHeight: "120%",
              }}
            >
              Legal
            </h3>
            {legalLinks.map((link, i) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium flex items-center h-[26px] transition-colors"
                style={{
                  color: "var(--color-muted-strong)",
                  marginBottom: i < legalLinks.length - 1 ? "0.375rem" : 0,
                }}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Bottom row: network switch (left) + copyright (right) */}
        <div className="mt-10 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-muted)" }}
            >
              Network
            </span>

            <div
              className="flex items-center p-0.5 gap-0.5"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-full)",
              }}
              role="radiogroup"
              aria-label="Bitcoin network"
            >
              {ORDER.map((n) => {
                const active = n === network;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      if (!active) onChange(n);
                    }}
                    className="px-4 py-1 text-xs font-semibold transition-colors"
                    style={{
                      borderRadius: "var(--radius-full)",
                      background: active ? "var(--color-primary)" : "transparent",
                      color: active
                        ? "var(--color-background)"
                        : "var(--color-muted-strong)",
                    }}
                  >
                    {NETWORKS[n].label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <a
                href="https://twitter.com/hznmarket"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X (Twitter)"
                className="flex h-[26px] w-[26px] items-center justify-center"
                style={socialIconStyle}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 18 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M13.936 4.698H15.02L10.34 9.063L15.85 16.365H11.54L8.16 11.937L4.29 16.365H2.15L7.16 10.624L1.88 3.699H6.3L9.35 7.745L13.936 4.698ZM13.13 15.079H14.32L6.65 4.917H5.37L13.13 15.079Z"
                    fill="var(--color-off-white)"
                  />
                </svg>
              </a>
              <a
                href="https://t.me/HorizonXCP"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
                className="flex h-[26px] w-[26px] items-center justify-center"
                style={socialIconStyle}
              >
                <Send size={15} color="var(--color-off-white)" />
              </a>
            </div>

            <p
              className="text-xs font-medium"
              style={{
                color: "var(--color-muted)",
                fontFamily: "'Montserrat', system-ui, sans-serif",
                lineHeight: "120%",
                letterSpacing: "-0.24px",
              }}
            >
              © {new Date().getFullYear()} Unspendable Labs. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
