import {
  actionsRow,
  primaryButton,
  secondaryButton,
} from "./styles.web.js";

export interface ResultActionsProps {
  isError: boolean;
  onBack: () => void;
  onRetry: () => void;
  onComplete: () => void;
  completeLabel: string;
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
  classNames,
}: ResultActionsProps) {
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
    </div>
  );
}
