#!/usr/bin/env node
/**
 * TEMPORARY workaround for a third packaging bug in @kontor/sdk-native@0.3.0-rc.4,
 * this one incompatible with React Native 0.83 / New Architecture (Expo 55).
 *
 * The uniffi-bindgen-react-native adapter (android/cpp-adapter.cpp) installs the
 * Rust JSI bindings by grabbing the app's JS CallInvoker out of the Java
 * `CallInvokerHolderImpl`. It does so by REVERSE-ENGINEERING fbjni internals —
 * reading a private `mHybridData` (HybridData) field, then its `mDestructor`, then
 * `mNativePointer` (a snippet copied from realm-js).
 *
 * RN 0.83 refactored `CallInvokerHolderImpl` to extend `com.facebook.jni.
 * HybridClassBase` instead of holding a `HybridData mHybridData` field, so that
 * field no longer exists. At the first Kontor call the adapter's
 * `env->GetFieldID(..., "mHybridData", ...)` throws, aborting the process (SIGABRT)
 * with no JS error:
 *
 *   java.lang.NoSuchFieldError: no "Lcom/facebook/jni/HybridData;" field
 *   "mHybridData" in class "Lcom/facebook/react/turbomodule/core/CallInvokerHolderImpl;"
 *     at com.kontor.sdknative.KontorSdkNativeModule.nativeInstallRustCrate(...)
 *     at com.kontor.sdknative.KontorSdkNativeModule.installRustCrate(KontorSdkNativeModule.kt:24)
 *
 * — e.g. opening the Wallet tab on signet (the first screen to read Kontor
 * holdings). Like the other native crashes here, a JS try/catch can't rescue it.
 *
 * Fix: stop reverse-engineering fbjni. `CallInvokerHolder` is itself a fbjni
 * `HybridClass` (see ReactCommon/CallInvokerHolder.h), so wrap the Java object in
 * an fbjni `alias_ref` and let `cthis()` read the native pointer through fbjni's
 * own machinery — correct across RN versions (mHybridData vs HybridClassBase).
 * The adapter is compiled during the app's Android build, so a native rebuild
 * (`npx expo run:android`) is required after this runs.
 *
 * DELETE this script and its `postinstall` hook once @kontor/sdk-native ships a
 * fix (an adapter that unwraps the CallInvoker via fbjni / is RN 0.83-compatible).
 */
const fs = require("fs");
const path = require("path");

const MARKER = "[fix-kontor-callinvoker]";

// The exact reverse-engineering block shipped by @kontor/sdk-native@0.3.0-rc.4's
// android/cpp-adapter.cpp (from the `// 1.` comment through the getCallInvoker line).
const OLD_BLOCK = `    // 1. Get the Java object referred to by the mHybridData field of the Java holder object
    auto callInvokerHolderClass = env->GetObjectClass(callInvokerHolderJavaObj);
    auto hybridDataField = env->GetFieldID(callInvokerHolderClass, "mHybridData", "Lcom/facebook/jni/HybridData;");
    auto hybridDataObj = env->GetObjectField(callInvokerHolderJavaObj, hybridDataField);

    // 2. Get the destructor Java object referred to by the mDestructor field from the myHybridData Java object
    auto hybridDataClass = env->FindClass("com/facebook/jni/HybridData");
    auto destructorField =
        env->GetFieldID(hybridDataClass, "mDestructor", "Lcom/facebook/jni/HybridData$Destructor;");
    auto destructorObj = env->GetObjectField(hybridDataObj, destructorField);

    // 3. Get the mNativePointer field from the mDestructor Java object
    auto destructorClass = env->FindClass("com/facebook/jni/HybridData$Destructor");
    auto nativePointerField = env->GetFieldID(destructorClass, "mNativePointer", "J");
    auto nativePointerValue = env->GetLongField(destructorObj, nativePointerField);

    // 4. Cast the mNativePointer back to its C++ type
    auto nativePointer = reinterpret_cast<facebook::react::CallInvokerHolder*>(nativePointerValue);
    auto jsCallInvoker = nativePointer->getCallInvoker();`;

const NEW_BLOCK = `    // ${MARKER} CallInvokerHolder is a fbjni HybridClass (ReactCommon/
    // CallInvokerHolder.h). Wrap the Java holder in an fbjni alias_ref and let
    // cthis() read the native pointer through fbjni's own machinery, instead of
    // reverse-engineering a private mHybridData field that RN 0.83 removed when
    // CallInvokerHolderImpl moved to HybridClassBase (NoSuchFieldError → SIGABRT).
    auto callInvokerHolder = facebook::jni::alias_ref<react::CallInvokerHolder::javaobject>{
        reinterpret_cast<react::CallInvokerHolder::javaobject>(callInvokerHolderJavaObj)};
    auto jsCallInvoker = callInvokerHolder->cthis()->getCallInvoker();`;

try {
  const pkgDir = path.dirname(require.resolve("@kontor/sdk-native/package.json"));
  const adapter = path.join(pkgDir, "android", "cpp-adapter.cpp");
  if (!fs.existsSync(adapter)) {
    console.warn("[fix-kontor-callinvoker] skipped: no android/cpp-adapter.cpp");
    return;
  }
  const src = fs.readFileSync(adapter, "utf8");
  if (src.includes(MARKER)) {
    // Already patched (idempotent across repeated installs).
    return;
  }
  if (!src.includes(OLD_BLOCK)) {
    console.warn(
      "[fix-kontor-callinvoker] skipped: expected CallInvoker block not found — " +
        "@kontor/sdk-native may have changed (fixed upstream?). Review manually.",
    );
    return;
  }
  fs.writeFileSync(adapter, src.replace(OLD_BLOCK, NEW_BLOCK));
  console.log(
    "[fix-kontor-callinvoker] patched android/cpp-adapter.cpp — CallInvoker " +
      "unwrapped via fbjni; run a native rebuild (npx expo run:android)",
  );
} catch (err) {
  // @kontor/sdk-native not installed yet, or already fixed upstream — nothing to do.
  console.warn("[fix-kontor-callinvoker] skipped:", err.message);
}
