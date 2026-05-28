import { useHorizonMarket } from "../context.js";
import type { ResolvedTheme } from "../theme.js";

export function useTheme(): ResolvedTheme {
  return useHorizonMarket().theme;
}
