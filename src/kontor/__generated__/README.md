# Vendored Kontor contract bindings

`token.ts` and `nft.ts` are **vendored verbatim** from the Horizon-Market server repo
(`src/lib/clients/kontor/__generated__/`), which generates them with `kontor-codegen` from
the on-chain contract ABIs. They only import from `@kontor/sdk`.

Do not hand-edit. If the Kontor token/NFT contract ABI changes, re-copy the regenerated files
from the server repo:

```
cp ../Horizon-Market/src/lib/clients/kontor/__generated__/{token,nft}.ts ./
```
