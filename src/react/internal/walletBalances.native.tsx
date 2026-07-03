import { useHorizonMarket } from "../context.js";
import { assetImageUrl } from "./format.js";
import { AssetAvatar, BtcGoldIcon } from "./icons.native.js";
import { type TokenLine } from "./useWalletTokenSummary.js";

// The aggregation logic is platform-neutral and shared with the web renderer;
// re-export it here so native imports can pull the hook + types from one place.
export {
  useWalletTokenSummary,
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
