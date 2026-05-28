import * as btc from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { ECPairFactory } from "ecpair";

btc.initEccLib(ecc);

export const ECPair = ECPairFactory(ecc);
export { ecc };
