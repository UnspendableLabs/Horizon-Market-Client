import type { Chain, Signing } from "@kontor/sdk";
import type { Signer } from "../crypto/signer.js";

/**
 * Obtain a Kontor SDK `Signing` from a client Signer.
 *
 * Only signers implementing the optional `getKontorSigning` capability (i.e.
 * {@link LocalSigner}) can perform Kontor operations. Throws a clear error
 * otherwise. The private key never leaves the signer — `getKontorSigning`
 * builds the `Signing` in-process.
 */
export async function getKontorSigning(
  signer: Signer,
  chain: Chain,
): Promise<Signing> {
  if (typeof signer.getKontorSigning !== "function") {
    throw new Error(
      "Kontor operations require a signer that implements getKontorSigning(). " +
        "Construct the client with { privateKey } (LocalSigner supports Kontor), " +
        "or implement getKontorSigning on your custom Signer.",
    );
  }
  return (await signer.getKontorSigning(chain)) as Signing;
}
