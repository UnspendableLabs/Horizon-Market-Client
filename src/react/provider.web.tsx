import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  HorizonMarketProvider as BaseProvider,
  useHorizonMarket,
  type HorizonMarketProviderProps,
} from "./context.js";
import { themeToCssVars } from "./theme.js";

/**
 * Web Provider that also injects the resolved theme as CSS custom properties
 * on a wrapper `<div>`. This makes the `theme` prop functional for the built-in
 * web components (which read `var(--hm-*, …)` tokens) without consumers having
 * to manually apply `themeToCssVars`.
 *
 * `display: contents` keeps the wrapper layout-transparent.
 */
export function HorizonMarketProvider(props: HorizonMarketProviderProps) {
  return (
    <BaseProvider {...props}>
      <ThemeVars>{props.children}</ThemeVars>
    </BaseProvider>
  );
}

function ThemeVars({ children }: { children: ReactNode }) {
  const { theme } = useHorizonMarket();
  const style = useMemo(
    () => ({ ...themeToCssVars(theme), display: "contents" as const }),
    [theme],
  );
  return <div style={style}>{children}</div>;
}
