import {
  actionsRow,
  primaryButton,
  secondaryButton,
  withDisabled,
} from "./styles.web.js";

export interface ResultActionsProps {
  isError: boolean;
  onBack: () => void;
  onRetry: () => void;
  onComplete: () => void;
  completeLabel: string;
  /** Optional dismiss action; when set, a "Close" button is shown on success. */
  onClose?: () => void;
  closeLabel?: string;
  /**
   * The failure is an uncertain Kontor publication: signed, handed to the
   * network, and maybe already on-chain. Back and Retry both lead to signing a
   * second one, so neither is offered — only {@link onCheckAgain}, when the
   * flow can re-check the same signed package, and a way out (`onClose`, else
   * `onComplete`).
   */
  unresolved?: boolean;
  /** Re-check the same signed package. Shown only when {@link unresolved}. */
  onCheckAgain?: () => void;
  /** A re-check is in flight: "Check again" is disabled. */
  checking?: boolean;
  classNames?: {
    button?: string;
    buttonSecondary?: string;
  };
}

export function ResultActions({
  isError,
  onBack,
  onRetry,
  onComplete,
  completeLabel,
  onClose,
  closeLabel = "Close",
  unresolved = false,
  onCheckAgain,
  checking = false,
  classNames,
}: ResultActionsProps) {
  if (isError && unresolved) {
    return (
      <div style={actionsRow}>
        <button
          type="button"
          onClick={onClose ?? onComplete}
          className={classNames?.buttonSecondary}
          style={{ ...secondaryButton, flex: 1 }}
        >
          {onClose ? closeLabel : completeLabel}
        </button>
        {onCheckAgain && (
          <button
            type="button"
            onClick={onCheckAgain}
            disabled={checking}
            className={classNames?.button}
            style={withDisabled({ ...primaryButton, flex: 1 }, checking)}
          >
            {checking ? "Checking…" : "Check again"}
          </button>
        )}
      </div>
    );
  }
  if (isError) {
    return (
      <div style={actionsRow}>
        <button
          type="button"
          onClick={onBack}
          className={classNames?.buttonSecondary}
          style={{ ...secondaryButton, flex: 1 }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onRetry}
          className={classNames?.button}
          style={{ ...primaryButton, flex: 1 }}
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <div style={actionsRow}>
      <button
        type="button"
        onClick={onComplete}
        className={classNames?.button}
        style={{ ...primaryButton, flex: 1 }}
      >
        {completeLabel}
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className={classNames?.buttonSecondary}
          style={{ ...secondaryButton, flex: 1 }}
        >
          {closeLabel}
        </button>
      )}
    </div>
  );
}
