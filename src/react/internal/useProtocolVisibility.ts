import { useMemo } from "react";
import { useHorizonMarket } from "../context.js";
import {
  visibleFilterTabs,
  type ProtocolVisibility,
  type SwapListingType,
} from "./swapListConstants.js";

export type { ProtocolVisibility };

/**
 * Which network-bound protocols this app shows, derived from the provider
 * configuration — see {@link ProtocolVisibility}. "Configured to read it" is
 * the whole rule: ZELD is visible wherever a ZeldHash API resolves (the public
 * mainnet API by default on mainnet, an explicit `zeldApiBaseUrl` elsewhere),
 * Kontor wherever `kontorNetwork` is set. So on mainnet Kontor disappears and
 * ZELD shows; on signet the reverse — and when Kontor launches on mainnet,
 * configuring it there lights its UI back up with no further code change.
 *
 * Consumed by every protocol-scoped surface the SDK renders (wallet headline
 * rows, other-holdings tabs, sell-picker groups, swap filter tabs), and
 * exported so a host app can gate its own protocol UI off the same rule.
 */
export function useProtocolVisibility(): ProtocolVisibility {
  const { kontorNetwork, zeldApiBaseUrl } = useHorizonMarket();
  return useMemo(
    () => ({
      zeld: zeldApiBaseUrl !== undefined,
      kontor: kontorNetwork !== undefined,
    }),
    [kontorNetwork, zeldApiBaseUrl],
  );
}

/**
 * The swap-filter tabs this app should render: `FILTER_TABS` minus the
 * protocols hidden by {@link useProtocolVisibility}.
 */
export function useSwapFilterTabs(): Array<{
  key: SwapListingType | null;
  label: string;
}> {
  const visibility = useProtocolVisibility();
  return useMemo(() => visibleFilterTabs(visibility), [visibility]);
}
