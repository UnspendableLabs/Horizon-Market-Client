#!/usr/bin/env node
/**
 * TEMPORARY workaround for a second packaging bug in @kontor/sdk-native@0.3.0-rc.4.
 *
 * The native TurboModule loads two .so's in KontorSdkNativeModule.<clinit>:
 *
 *   System.loadLibrary("kontor_sdk_native")   // the Rust/uniffi core
 *   System.loadLibrary("kontor-sdk-native")   // the JSI/C++ wrapper (this package)
 *
 * The wrapper is compiled from the package's android/CMakeLists.txt during the
 * consumer's Android build, and it links against the PREBUILT Rust core as an
 * IMPORTED SHARED library BY FULL PATH:
 *
 *   set_target_properties(my_rust_lib PROPERTIES IMPORTED_LOCATION
 *     ${CMAKE_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libkontor_sdk_native.so)
 *
 * That prebuilt core .so ships with NO DT_SONAME. When a shared object without a
 * soname is linked by an explicit path, ld records that path VERBATIM in the
 * wrapper's DT_NEEDED — here a build-relative
 *   "../../../../src/main/jniLibs/arm64-v8a/libkontor_sdk_native.so".
 * On device every .so is flattened into lib/<abi>/, so dlopen can't find a lib by
 * that relative name and throws inside the module's static initializer:
 *
 *   java.lang.UnsatisfiedLinkError: dlopen failed: library
 *   "../../../../src/main/jniLibs/arm64-v8a/libkontor_sdk_native.so" not found:
 *   needed by .../lib/arm64-v8a/libkontor-sdk-native.so
 *     at com.kontor.sdknative.KontorSdkNativeModule.<clinit>() (KontorSdkNativeModule.kt:45)
 *
 * which aborts the process (SIGABRT) with no JS error — e.g. opening the Wallet
 * tab on signet, the first screen that reads Kontor holdings. A JS try/catch
 * cannot rescue a native abort, so this must be fixed in the link.
 *
 * Fix: link the sonameless core by `-l` name + a link directory instead of by
 * full path. When ld resolves `-lkontor_sdk_native` to a sonameless .so it records
 * the bare basename `libkontor_sdk_native.so` in DT_NEEDED, which the loader
 * resolves on device (the core is already loaded by the loadLibrary above). A
 * native rebuild (`npx expo run:android`) is required after this runs.
 *
 * DELETE this script and its `postinstall` hook once @kontor/sdk-native ships a
 * fix (a soname on the core .so, or an IMPORTED_SONAME in its CMakeLists).
 */
const fs = require("fs");
const path = require("path");

const MARKER = "[fix-kontor-soname]";

// The exact final link block shipped by @kontor/sdk-native@0.3.0-rc.4's
// android/CMakeLists.txt. `my_rust_lib` is the IMPORTED-by-path core target.
const OLD_BLOCK = `target_link_libraries(
  kontor-sdk-native
  fbjni::fbjni
  ReactAndroid::jsi
  \${LOGCAT}
  my_rust_lib
)`;

const NEW_BLOCK = `# ${MARKER} link the sonameless Rust core by -l name (not full path) so the
# wrapper's DT_NEEDED is the bare basename libkontor_sdk_native.so — which dlopen
# resolves on device — instead of a build-relative path. See fix-kontor-soname.cjs.
target_link_directories(kontor-sdk-native PRIVATE
  \${CMAKE_SOURCE_DIR}/src/main/jniLibs/\${ANDROID_ABI})
target_link_libraries(
  kontor-sdk-native
  fbjni::fbjni
  ReactAndroid::jsi
  \${LOGCAT}
  kontor_sdk_native
)`;

try {
  const pkgDir = path.dirname(require.resolve("@kontor/sdk-native/package.json"));
  const cmake = path.join(pkgDir, "android", "CMakeLists.txt");
  if (!fs.existsSync(cmake)) {
    console.warn("[fix-kontor-soname] skipped: no android/CMakeLists.txt");
    return;
  }
  const src = fs.readFileSync(cmake, "utf8");
  if (src.includes(MARKER)) {
    // Already patched (idempotent across repeated installs).
    return;
  }
  if (!src.includes(OLD_BLOCK)) {
    console.warn(
      "[fix-kontor-soname] skipped: expected link block not found — " +
        "@kontor/sdk-native may have changed (fixed upstream?). Review manually.",
    );
    return;
  }
  fs.writeFileSync(cmake, src.replace(OLD_BLOCK, NEW_BLOCK));
  console.log(
    "[fix-kontor-soname] patched android/CMakeLists.txt — wrapper will link the " +
      "Rust core by soname; run a native rebuild (npx expo run:android)",
  );
} catch (err) {
  // @kontor/sdk-native not installed yet, or already fixed upstream — nothing to do.
  console.warn("[fix-kontor-soname] skipped:", err.message);
}
