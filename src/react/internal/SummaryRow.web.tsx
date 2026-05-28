import type { CSSProperties } from "react";
import { webTokens } from "../theme.js";
import { summaryRow } from "./styles.web.js";

export interface SummaryRowProps {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
}

export function SummaryRow({
  label,
  value,
  mono,
  className,
  labelClassName,
  valueClassName,
}: SummaryRowProps) {
  const valueStyle: CSSProperties = {
    color: webTokens.text,
    fontWeight: 600,
    ...(mono ? { fontFamily: "monospace" } : {}),
  };
  return (
    <div className={className} style={summaryRow}>
      <span
        className={labelClassName}
        style={{ color: webTokens.textMuted }}
      >
        {label}
      </span>
      <span className={valueClassName} style={valueStyle}>
        {value}
      </span>
    </div>
  );
}
