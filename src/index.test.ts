import { describe, expect, it } from "vitest";
import * as sdk from "./index.js";

describe("public SDK barrel (index.ts)", () => {
  it("re-exports the main client and send helpers", () => {
    expect(sdk.HorizonMarketClient).toBeTypeOf("function");
    expect(sdk.sendAsset).toBeTypeOf("function");
    expect(sdk.prepareSend).toBeTypeOf("function");
  });

  it("re-exports the Kontor and API error classes", () => {
    expect(sdk.KontorListingNotRecordedError).toBeTypeOf("function");
    expect(sdk.KontorDelistNotRecordedError).toBeTypeOf("function");
    expect(sdk.KontorPurchaseNotRecordedError).toBeTypeOf("function");
    expect(sdk.KontorUnavailableError).toBeTypeOf("function");
    expect(sdk.HorizonMarketApiError).toBeTypeOf("function");
    // Error subclasses stay in the Error prototype chain.
    expect(new sdk.KontorUnavailableError("x")).toBeInstanceOf(Error);
  });

  it("re-exports the signers", () => {
    expect(sdk.LocalSigner).toBeTypeOf("function");
    expect(sdk.HDSigner).toBeTypeOf("function");
  });

  it("re-exports the mnemonic / BIP39 helpers and constants", () => {
    expect(sdk.generateMnemonic).toBeTypeOf("function");
    expect(sdk.validateMnemonic).toBeTypeOf("function");
    expect(sdk.mnemonicToPrivateKey).toBeTypeOf("function");
    expect(sdk.privateKeyToMnemonic).toBeTypeOf("function");
    expect(sdk.mnemonicToPrivateKeyEntropy).toBeTypeOf("function");
    expect(sdk.deriveHorizonWalletKeys).toBeTypeOf("function");
    expect(sdk.horizonWalletPath).toBeTypeOf("function");
    expect(sdk.coinTypeForNetwork).toBeTypeOf("function");
    expect(sdk.DEFAULT_DERIVATION_PATH).toBeTypeOf("string");
    expect(sdk.SEGWIT_PURPOSE).toBeDefined();
    expect(sdk.TAPROOT_PURPOSE).toBeDefined();
  });

  it("re-exports the keystore helpers", () => {
    expect(sdk.encryptKeystore).toBeTypeOf("function");
    expect(sdk.decryptKeystore).toBeTypeOf("function");
  });

  it("re-exports the config default constants", () => {
    expect(sdk.DEFAULT_BASE_URL).toBeTypeOf("string");
    expect(sdk.DEFAULT_KONTOR_INDEXER_URL).toBeTypeOf("string");
    expect(sdk.DEFAULT_COUNTERPARTY_API_BASE_URL).toBeTypeOf("string");
    expect(sdk.DEFAULT_ZELD_API_BASE_URL).toBeTypeOf("string");
  });

  it("re-exports the manual sell-prep helper", () => {
    expect(sdk.signAndFinalizeSellPrep).toBeTypeOf("function");
  });
});
