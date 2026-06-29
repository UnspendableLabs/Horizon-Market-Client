import type { CSSProperties, ReactNode } from "react";
import { useEffect } from "react";
import * as ws from "../internal/styles.web.js";

export interface ModalProps {
  /** Whether the modal is visible. When false, nothing is rendered. */
  open: boolean;
  /** Called when the overlay is clicked, the ✕ is pressed, or Escape is hit. */
  onClose: () => void;
  /** Heading shown on the left of the title row, beside the close button. */
  title?: ReactNode;
  /** Max card width in px. Defaults to 450 (matches Horizon Market). */
  maxWidth?: number;
  children: ReactNode;
}

/**
 * Shared overlay modal used across the library (and re-exported for consumers).
 *
 * Renders a dimmed, blurred full-screen overlay with a centered card. The card
 * is the visible surface (diagonal gradient, no border, generous padding, large
 * radius) and carries a title row with the heading on the left and a ✕ on the
 * right. Click the overlay, press ✕, or hit Escape to close. The panel content
 * (LoginPanel / SellOrderForm / SwapConfirmation) is chrome-less and stacks
 * directly under the title row.
 */
export function Modal({ open, onClose, title, maxWidth = 450, children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const cardStyle: CSSProperties = { ...ws.modalCard, maxWidth };

  return (
    <div style={ws.modalOverlay} onClick={onClose} role="presentation">
      <div
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={ws.modalHeader}>
          {title != null ? <h2 style={ws.modalTitle}>{title}</h2> : <span />}
          <button
            type="button"
            onClick={onClose}
            style={ws.modalClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
