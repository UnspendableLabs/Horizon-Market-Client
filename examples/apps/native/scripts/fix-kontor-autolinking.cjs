#!/usr/bin/env node
/**
 * TEMPORARY workaround for a packaging bug still present in
 * @kontor/sdk-native@0.3.0-rc.5. (The two sibling build bugs this app used to
 * patch — the sonameless-core link and the RN 0.83 CallInvoker unwrap — were
 * fixed upstream in rc.5, so those scripts were deleted; only this one remains.)
 *
 * @kontor/sdk-native is a uniffi-bindgen-react-native TurboModule that registers
 * itself through a plain `TurboReactPackage` (com.kontor.sdknative.KontorSdkNative
 * Package). But it ALSO ships an `expo-module.config.json`, which makes Expo
 * autolinking "claim" the package: Expo compiles and ships its `.so`, yet only
 * ever registers packages for expo-modules-core modules — never a plain
 * ReactPackage — so KontorSdkNativePackage is left unregistered. At the same time
 * the config's mere presence excludes the package from React Native autolinking.
 * Neither system registers the TurboModule, so on device the first Kontor call
 * (e.g. buying/selling KOR) throws:
 *
 *   Invariant Violation: TurboModuleRegistry.getEnforcing('KontorSdkNative')
 *   could not be found. Verify that a module by this name is registered in the
 *   native binary.
 *
 * Deleting the stray `expo-module.config.json` routes the package through RN
 * autolinking instead, which correctly emits KontorSdkNativePackage into the
 * generated PackageList (verified with
 * `npx expo-modules-autolinking react-native-config`). A native rebuild
 * (`npx expo run:android` / `run:ios`) is required after this runs.
 *
 * DELETE this script and its `postinstall` hook once @kontor/sdk-native ships a
 * fix (drops expo-module.config.json, or registers its own package/module).
 */
const fs = require("fs");
const path = require("path");

try {
  const pkgDir = path.dirname(require.resolve("@kontor/sdk-native/package.json"));
  const cfg = path.join(pkgDir, "expo-module.config.json");
  if (fs.existsSync(cfg)) {
    fs.rmSync(cfg);
    console.log(
      "[fix-kontor-autolinking] removed stray expo-module.config.json — RN autolinking will now register KontorSdkNative",
    );
  }
} catch (err) {
  // @kontor/sdk-native not installed yet, or already fixed upstream — nothing to do.
  console.warn("[fix-kontor-autolinking] skipped:", err.message);
}
