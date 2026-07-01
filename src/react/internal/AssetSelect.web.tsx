import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AssetOption } from "../hooks/useAssets.js";
import { useHorizonMarket } from "../context.js";
import { webTokens } from "../theme.js";
import { assetImageUrl, assetKey, describeAsset } from "./format.js";
import { AssetAvatar } from "./icons.web.js";
import * as ws from "./styles.web.js";

export interface AssetSelectGroup {
  label: string;
  options: AssetOption[];
}

const trigger: CSSProperties = {
  ...ws.input,
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
};

const triggerLabel: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const placeholderText: CSSProperties = {
  ...triggerLabel,
  color: webTokens.textMuted,
};

const caret: CSSProperties = {
  flexShrink: 0,
  color: webTokens.textMuted,
  fontSize: 10,
};

const panel: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 30,
  maxHeight: 300,
  overflowY: "auto",
  padding: webTokens.spacingXs,
  background: webTokens.backgroundElevated,
  border: `${webTokens.borderWidth} solid ${webTokens.border}`,
  borderRadius: webTokens.radiusSm,
  boxShadow: "0 12px 32px -8px rgba(0, 0, 0, 0.5)",
};

const groupHeader: CSSProperties = {
  padding: `${webTokens.spacingXs} ${webTokens.spacingSm}`,
  fontSize: webTokens.fontSizeSm,
  color: webTokens.textMuted,
  fontWeight: 600,
};

const optionRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: webTokens.spacingSm,
  width: "100%",
  padding: webTokens.spacingSm,
  background: "transparent",
  border: "none",
  borderRadius: webTokens.radiusSm,
  color: webTokens.text,
  fontSize: webTokens.fontSizeBase,
  fontFamily: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const optionRowSelected: CSSProperties = {
  background: webTokens.surface,
};

const optionLabel: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/**
 * Asset picker with a small round thumbnail beside each name — a native
 * `<select>` can't render images in its options, so this is a custom listbox.
 * Artwork is loaded lazily (see {@link AssetAvatar}) and the option rows mount
 * only while the panel is open, so the balances list and the closed form render
 * without waiting on any image fetch.
 */
export function AssetSelect({
  groups,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  groups: AssetSelectGroup[];
  value: AssetOption | null;
  onChange: (asset: AssetOption) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
}) {
  const { baseUrl } = useHorizonMarket();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selectedKey = value ? assetKey(value) : null;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={className}
        style={ws.withDisabled(trigger, Boolean(disabled))}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <>
            <AssetAvatar
              asset={value}
              size={24}
              radius={12}
              imageUrl={assetImageUrl(baseUrl, value)}
            />
            <span style={triggerLabel}>{describeAsset(value)}</span>
          </>
        ) : (
          <span style={placeholderText}>{placeholder}</span>
        )}
        <span aria-hidden style={caret}>
          ▼
        </span>
      </button>
      {open && (
        <div role="listbox" style={panel}>
          {groups.map((group) =>
            group.options.length === 0 ? null : (
              <div key={group.label}>
                <div style={groupHeader}>{group.label}</div>
                {group.options.map((a) => {
                  const k = assetKey(a);
                  const selected = k === selectedKey;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onChange(a);
                        setOpen(false);
                      }}
                      style={
                        selected ? { ...optionRow, ...optionRowSelected } : optionRow
                      }
                    >
                      <AssetAvatar
                        asset={a}
                        size={28}
                        radius={14}
                        imageUrl={assetImageUrl(baseUrl, a)}
                      />
                      <span style={optionLabel}>{describeAsset(a)}</span>
                    </button>
                  );
                })}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
