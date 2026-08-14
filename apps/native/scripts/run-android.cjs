#!/usr/bin/env node
/*
 * Picks a 4 KB-page Android device, then hands off to `expo run:android`.
 *
 * Android 17 preview / `ps16k` system images use 16 KB memory pages and reject
 * any APK containing a 4 KB-aligned native library. `@kontor/sdk-native` ships
 * exactly one such prebuilt `.so`, so on those images the install reports
 * success but every activity stays invisible to the package resolver: the
 * launch intent fails with "unable to resolve Intent horizonmarket://…" and the
 * emulator sits on a black screen.
 *
 * `expo run:android` with no target picks the first available AVD, which is how
 * a 16 KB image gets selected by accident. This wrapper prefers a device that
 * actually reports `PAGE_SIZE=4096`, booting one if none is connected.
 *
 * Set HORIZON_ANDROID_AVD to force a specific AVD. Delete this wrapper (and
 * restore `"android": "expo run:android"`) once @kontor relinks its library
 * with -Wl,-z,max-page-size=16384.
 */

const { execFileSync, spawn, spawnSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const BOOT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

/** Runs a command, returning its trimmed stdout, or null if it failed. */
function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function sdkRoot() {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'Library/Android/sdk');
}

/** Resolves an SDK tool, falling back to PATH so a custom install still works. */
function sdkTool(subdir, name) {
  const bundled = join(sdkRoot(), subdir, name);
  return existsSync(bundled) ? bundled : name;
}

const adb = sdkTool('platform-tools', 'adb');
const emulator = sdkTool('emulator', 'emulator');

function connectedSerials() {
  const output = run(adb, ['devices']);
  if (!output) return [];
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
    .filter(([, state]) => state === 'device')
    .map(([serial]) => serial);
}

function pageSizeOf(serial) {
  const value = run(adb, ['-s', serial, 'shell', 'getconf', 'PAGE_SIZE']);
  return value ? Number(value.replace(/\r/g, '')) : null;
}

function isBooted(serial) {
  return run(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'])?.replace(/\r/g, '') === '1';
}

/*
 * `sys.boot_completed` flips before every system service is back, and a device
 * whose package manager is missing fails the install with a bare
 * "cmd: Can't find service: package". Ask for the service the install needs.
 */
function isReady(serial) {
  if (!isBooted(serial)) return false;
  return /found/.test(run(adb, ['-s', serial, 'shell', 'service', 'check', 'package']) ?? '');
}

/** The AVD name of a running emulator; null for physical devices. */
function avdNameOf(serial) {
  if (!serial.startsWith('emulator-')) return null;
  return run(adb, ['-s', serial, 'emu', 'avd', 'name'])?.split('\n')[0].replace(/\r/g, '') || null;
}

/** Expo targets emulators by AVD name and physical devices by serial. */
function expoTargetFor(serial) {
  return avdNameOf(serial) ?? serial;
}

function listAvds() {
  return run(emulator, ['-list-avds'])?.split('\n').filter(Boolean) ?? [];
}

/*
 * A 16 KB image can only be confirmed by booting it, so rank candidates by
 * their config instead: `ps16k` is in the image path, and every API level past
 * 36 defaults to 16 KB pages. Whatever we pick is verified after boot anyway.
 */
function looksLikeSmallPageAvd(name) {
  const config = join(homedir(), '.android/avd', `${name}.avd`, 'config.ini');
  if (!existsSync(config)) return true;
  const sysdir = readFileSync(config, 'utf8').match(/^image\.sysdir\.\d+\s*=\s*(.+)$/m)?.[1] ?? '';
  if (/ps16k/i.test(sysdir)) return false;
  const apiLevel = Number(sysdir.match(/android-(\d+)/)?.[1]);
  return !Number.isFinite(apiLevel) || apiLevel <= 36;
}

/** Blocking sleep: the whole script is synchronous so it can `process.exit` cleanly. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Boots an AVD and waits for it to finish, returning its serial. */
function bootAvd(name) {
  console.log(`› Booting emulator ${name}…`);
  const child = spawn(emulator, ['-avd', name, '-gpu', 'host'], { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const serial = connectedSerials().find((it) => avdNameOf(it) === name && isReady(it));
    if (serial) return serial;
    sleep(POLL_INTERVAL_MS);
  }
  return null;
}

function resolveTarget() {
  const forced = process.env.HORIZON_ANDROID_AVD;
  if (forced) {
    const running = connectedSerials().find((serial) => avdNameOf(serial) === forced);
    return running ?? bootAvd(forced);
  }

  const connected = connectedSerials().filter(isReady);
  const alreadyUsable = connected.find((serial) => pageSizeOf(serial) === 4096);
  if (alreadyUsable) return alreadyUsable;

  const candidates = listAvds().filter(looksLikeSmallPageAvd);
  if (candidates.length === 0) {
    const detail = connected.length > 0 ? 'every connected device uses 16 KB pages' : 'no 4 KB-page AVD found';
    console.error(
      `✖ ${detail}. This app cannot launch there until @kontor/sdk-native ships a 16 KB-aligned library.\n` +
        `  Create an AVD from a system image up to android-36, or set HORIZON_ANDROID_AVD to override.`,
    );
    process.exit(1);
  }
  return bootAvd(candidates[0]);
}

/** Resolves a device, boots one if needed, and refuses 16 KB-page targets. */
function prepareDevice() {
  const target = resolveTarget();
  if (!target) {
    console.error('✖ The emulator did not finish booting in time.');
    process.exit(1);
  }

  const serial = connectedSerials().find((it) => it === target || avdNameOf(it) === target);
  const pageSize = serial ? pageSizeOf(serial) : null;
  if (pageSize !== 4096) {
    console.error(
      `✖ ${target} reports PAGE_SIZE=${pageSize}. A 16 KB-page device installs this app but resolves no activity,\n` +
        `  so it would only show a black screen. Pick a device built from an android-36 or older system image.`,
    );
    process.exit(1);
  }

  return { serial, avdName: serial ? avdNameOf(serial) : null, expoTarget: serial ? expoTargetFor(serial) : target };
}

function runExpo(expoTarget) {
  console.log(`› Running on ${expoTarget} (4 KB pages)`);
  return spawnSync('npx', ['expo', 'run:android', '--device', expoTarget, ...process.argv.slice(2)], {
    stdio: 'inherit',
  }).status;
}

const device = prepareDevice();
let status = runExpo(device.expoTarget);

/*
 * A cold Gradle build runs for minutes, and an emulator that dies in the
 * meantime only surfaces at the very end, as an install failure against a
 * device that is no longer there. Reboot the same AVD and retry once: the build
 * is up to date by then, so the retry is just the install and launch.
 */
if (status !== 0 && device.avdName && !isReady(device.serial)) {
  console.log(`› ${device.avdName} went away during the build. Rebooting it and retrying the install…`);
  const serial = bootAvd(device.avdName);
  status = serial ? runExpo(expoTargetFor(serial)) : null;
  if (!serial) console.error('✖ The emulator did not finish booting in time.');
}

process.exit(status ?? 1);
