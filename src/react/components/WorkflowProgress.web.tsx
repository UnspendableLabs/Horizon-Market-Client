import { useEffect } from "react";
import type { CSSProperties } from "react";
import type { WorkflowProgressEvent } from "../../types/index.js";
import { cx } from "../internal/format.js";
import { reduceSteps, stepVisual, type StepView } from "../internal/progress.js";
import { webTokens } from "../theme.js";

export interface WorkflowProgressClassNames {
  root?: string;
  step?: string;
  icon?: string;
  label?: string;
  successMessage?: string;
  errorMessage?: string;
}

export interface WorkflowProgressProps {
  steps: WorkflowProgressEvent[];
  totalSteps: number | null;
  status: "idle" | "loading" | "success" | "error";
  successMessage?: string;
  errorMessage?: string;
  className?: string;
  classNames?: WorkflowProgressClassNames;
  style?: CSSProperties;
}

const SPIN_KEYFRAMES = "@keyframes hm-spin { to { transform: rotate(360deg); } }";
const MAX_PENDING_STEPS = 10;
const KEYFRAMES_STYLE_ID = "hm-workflow-progress-keyframes";

function useSpinKeyframes() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(KEYFRAMES_STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = KEYFRAMES_STYLE_ID;
    el.textContent = SPIN_KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

export function WorkflowProgress({
  steps,
  totalSteps,
  status,
  successMessage,
  errorMessage,
  className,
  classNames,
  style,
}: WorkflowProgressProps) {
  useSpinKeyframes();
  const view = reduceSteps(steps);
  const showPending =
    totalSteps !== null && view.length < totalSteps && status === "loading";
  const remaining =
    totalSteps !== null
      ? Math.min(Math.max(0, totalSteps - view.length), MAX_PENDING_STEPS)
      : 0;

  const rootStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: webTokens.spacingSm,
    padding: webTokens.spacingMd,
    background: webTokens.surface,
    border: `${webTokens.borderWidth} solid ${webTokens.border}`,
    borderRadius: webTokens.radiusMd,
    color: webTokens.text,
    fontFamily: webTokens.fontFamily,
    fontSize: webTokens.fontSizeBase,
    ...style,
  };

  return (
    <div
      className={cx(classNames?.root, className)}
      style={rootStyle}
      role="status"
      aria-live="polite"
      aria-busy={status === "loading"}
    >
      {totalSteps !== null && (
        <div
          style={{
            fontSize: webTokens.fontSizeSm,
            color: webTokens.textMuted,
            marginBottom: webTokens.spacingXs,
          }}
        >
          Step {Math.min(view.length, totalSteps)} of {totalSteps}
        </div>
      )}
      {view.map((s) => (
        <Step key={s.key} step={s} classNames={classNames} />
      ))}
      {showPending &&
        Array.from({ length: remaining }).map((_, i) => (
          <Step
            key={`pending-${i}`}
            step={{
              key: `pending-${i}`,
              label: "Pending…",
              state: "pending",
            }}
            classNames={classNames}
          />
        ))}
      {status === "success" && successMessage && (
        <div
          className={classNames?.successMessage}
          style={{
            marginTop: webTokens.spacingSm,
            color: webTokens.success,
            fontWeight: 600,
          }}
        >
          ✅ {successMessage}
        </div>
      )}
      {status === "error" && (
        <div
          className={classNames?.errorMessage}
          style={{
            marginTop: webTokens.spacingSm,
            color: webTokens.error,
            fontWeight: 600,
          }}
        >
          ✗ {errorMessage ?? "Workflow failed"}
        </div>
      )}
    </div>
  );
}

function Step({
  step,
  classNames,
}: {
  step: StepView;
  classNames?: WorkflowProgressClassNames;
}) {
  // Icon + colors come from the shared `stepVisual` mapping (see progress.ts) so
  // web and native never drift; we only translate the semantic keys to tokens.
  const { icon, iconColorKey, labelColorKey } = stepVisual(step.state);
  const colorFor = webTokens[iconColorKey];

  return (
    <div
      className={classNames?.step}
      style={{
        display: "flex",
        alignItems: "center",
        gap: webTokens.spacingSm,
      }}
    >
      <span
        className={classNames?.icon}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          color: colorFor,
          fontWeight: 700,
        }}
      >
        {icon ?? <Spinner color={colorFor} />}
      </span>
      <span
        className={classNames?.label}
        style={{ color: webTokens[labelColorKey] }}
      >
        {step.label}
      </span>
    </div>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: `2px solid ${color}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "hm-spin 0.8s linear infinite",
      }}
    />
  );
}
