/**
 * App Store policy switches — the ONE place the iOS build diverges from Android.
 *
 * Apple rejected v1.0 under guideline 3.1.1: the app "includes or accesses paid
 * services for buying and selling NFTs, or related paid services, such as
 * minting, listing, or transferring, with mechanisms other than In-App
 * Purchase". So the iOS build ships as a wallet + token explorer with no
 * marketplace: no Buy / Sell tabs, no Create, no offers, no listing credits, no
 * per-asset Sell. Android (accepted on Play) keeps all of it.
 *
 * Every switch below derives from `Platform.OS === "ios"`, so on Android each
 * one evaluates to the behaviour the app had before it existed. Screens read
 * these flags instead of testing the platform themselves, so turning the market
 * back on for iOS (e.g. once it can run through In-App Purchase) is a change to
 * this file alone.
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import type { AssetOption } from "@unspendablelabs/horizon-market-client/react";
import { getStorefrontCountryCode } from "../modules/horizon-storefront/index.js";

const IS_IOS = Platform.OS === "ios";

/**
 * The in-app marketplace: the Buy and Sell tabs, the Create screen, a token's
 * Offers tab, the wallet's per-asset Sell, and the listing-credit rows (credits
 * are bought on the web, so showing them is a 3.1.3 problem of their own).
 */
export const MARKETPLACE_ENABLED = !IS_IOS;

/**
 * Whether the iOS build may send (withdraw) NFTs. Sending one only pays the
 * network fee, to miners — nothing goes to Horizon — so it is kept; but
 * "transferring" NFTs is named in 3.1.1, so if Apple objects, flip this to
 * `false` and the wallet stops offering Withdraw on NFTs (see
 * {@link isNftAsset}). BTC and fungible tokens are unaffected either way.
 */
export const IOS_ALLOW_NFT_SEND = true;

/**
 * What the NFT-send switch covers: inscriptions, Kontor NFTs, and indivisible
 * Counterparty assets (the card-style collectibles — Rare Pepes and the like).
 * Divisible Counterparty assets, XCP, ZELD and KOR are fungible.
 */
export function isNftAsset(asset: AssetOption): boolean {
  switch (asset.type) {
    case "ordinal":
    case "kontor-nft":
      return true;
    case "counterparty":
      return !asset.divisible;
    default:
      return false;
  }
}

/**
 * `WalletBalances`' `canWithdrawAsset` gate: `undefined` (every asset can be
 * withdrawn — the SDK default) unless NFT send is switched off on iOS.
 */
export const canWithdrawAsset: ((asset: AssetOption) => boolean) | undefined =
  IS_IOS && !IOS_ALLOW_NFT_SEND ? (asset) => !isNftAsset(asset) : undefined;

/**
 * Where "home" is — the wordmark, a cold token screen's Back, the /auth sink.
 * The Buy tab (`/`) when the market is in the app, the Wallet otherwise: on iOS
 * the Buy tab isn't registered at all, so `/` is not a route to send anyone to.
 */
export const HOME_PATH = MARKETPLACE_ENABLED ? "/" : "/wallet";

/** The screen {@link HOME_PATH} opens, for accessibility labels. */
export const HOME_LABEL = MARKETPLACE_ENABLED ? "Buy" : "Wallet";

/**
 * Hosts whose pages are a marketplace or a purchase flow. A token's links are
 * issuer-supplied (website, socials, free-form `url_*` rows), so on a build
 * without the market any of them could be the very "external link to a
 * purchasing mechanism" 3.1.1 forbids — horizon.market itself included.
 */
const MARKETPLACE_HOSTS = [
  "horizon.market",
  "opensea.io",
  "magiceden.io",
  "magiceden.us",
  "ord.io",
  "unisat.io",
  "okx.com",
  "gamma.io",
  "ordinalswallet.com",
  "satflow.com",
  "ordzaar.com",
  "pepe.wtf",
  "scarce.city",
  "emblem.finance",
  "binance.com",
  "coinbase.com",
  "kraken.com",
];

/** A path segment that reads as a storefront, on any host. */
const PURCHASE_PATH =
  /\/(buy|sell|trade|market|marketplace|listing|listings|swap|swaps|dispenser|dispensers|checkout|shop|store|mint)(\/|$)/i;

/**
 * Whether a URL may lead to buying or selling. Fail-closed: anything that isn't
 * a plain http(s) URL this can read the host of counts as one.
 *
 * Parsed with a regex rather than `URL`: React Native's `URL` doesn't implement
 * `hostname`.
 */
export function isPurchaseLink(url: string): boolean {
  // scheme, optional `user:pass@`, host, optional port — and then nothing but
  // the path, query or fragment, so an authority this can't read refuses.
  const match = /^https?:\/\/(?:[^/?#@]*@)?([^/?#:@]+)(?::\d*)?(?=[/?#]|$)([^?#]*)/i.exec(
    url.trim(),
  );
  if (!match) return true;
  const host = (match[1] ?? "").toLowerCase().replace(/\.$/, "");
  const path = match[2] ?? "";
  if (
    MARKETPLACE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
  ) {
    return true;
  }
  return PURCHASE_PATH.test(path);
}

/** Whether a token page may show an external link — always, with the market in the app. */
export function canShowExternalLink(url: string): boolean {
  return MARKETPLACE_ENABLED || !isPurchaseLink(url);
}

/** App Store storefront code (ISO 3166-1 alpha-3) of the United States. */
const US_STOREFRONT = "USA";

/**
 * True when this install may link out to horizon.market to trade: only on iOS,
 * and only on the United States storefront — the one where 3.1.1 lets an app
 * link to a purchase mechanism other than In-App Purchase. The storefront is the
 * country of the Apple ID's App Store account, read through StoreKit, not the
 * device's region or language.
 *
 * Fail-closed: false while the storefront is being read, when it can't be read
 * (no StoreKit answer, a binary built without the native module), on every other
 * storefront — and on Android, whose app has the market itself.
 */
export function useCanLinkToWebMarket(): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (MARKETPLACE_ENABLED) return;
    let active = true;
    void getStorefrontCountryCode().then((code) => {
      if (active) setAllowed(code === US_STOREFRONT);
    });
    return () => {
      active = false;
    };
  }, []);

  return allowed;
}
