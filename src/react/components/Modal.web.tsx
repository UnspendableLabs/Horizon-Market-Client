import type { CSSProperties, ReactNode } from "react";
import { useEffect } from "react";
import * as ws from "../internal/styles.web.js";
import { webTokens } from "../theme.js";

export interface ModalProps {
  /** Whether the modal is visible. When false, nothing is rendered. */
  open: boolean;
  /** Called when the overlay is clicked or the Escape key is pressed. */
  onClose: () => void;
  children: ReactNode;
}

const panelStyle: CSSProperties = {
  position: "relative",
  maxHeight: "90vh",
  overflowY: "auto",
  // Opaque base so the floating panel never shows the dimmed page through it,
  // even when the theme's `surface` token is translucent. The child card
  // (cardRoot, background = surface) composites on top for the visible surface.
  background: webTokens.background,
  borderRadius: webTokens.radiusLg,
};

/**
 * Shared overlay modal used across the library (and re-exported for consumers).
 *
 * Renders a dimmed full-screen overlay with a centered, opaque panel. Click the
 * overlay or press Escape to close. The panel content is expected to bring its
 * own card surface (e.g. LoginPanel / SellOrderForm / SwapConfirmation), which
 * sits on top of the opaque panel background.
 */
export function Modal({ open, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={ws.modalOverlay} onClick={onClose} role="presentation">
      <div
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={onClose}
          style={ws.modalClose}
          aria-label="Close"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
