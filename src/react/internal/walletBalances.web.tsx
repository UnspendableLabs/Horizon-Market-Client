import { useHorizonMarket } from "../context.js";
import { assetImageUrl } from "./format.js";
import { AssetAvatar, BtcGoldIcon } from "./icons.web.js";
import { type TokenLine } from "./useWalletTokenSummary.js";

// The aggregation logic is platform-neutral and shared with the native renderer;
// re-export it here so existing web imports (`./walletBalances.web.js`) keep working.
export {
  useWalletTokenSummary,
  tokenAmountText,
  tokenAmountTitle,
  type TokenSymbol,
  type TokenLine,
  type WalletTokenSummary,
} from "./useWalletTokenSummary.js";

/** Round brand mark for a headline token: Bitcoin gold for BTC, avatar else. */
export function TokenMark({
  line,
  size,
}: {
  line: TokenLine;
  size: number;
}) {
  const { baseUrl } = useHorizonMarket();
  if (!line.asset) return <BtcGoldIcon size={size} />;
  return (
    <AssetAvatar
      asset={line.asset}
      size={size}
      radius={size / 2}
      imageUrl={assetImageUrl(baseUrl, line.asset)}
    />
  );
}
