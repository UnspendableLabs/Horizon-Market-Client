import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The React entries must never *statically* reach `@kontor/sdk`.
 *
 * Loading that package is eager and heavy: on web it compiles an embedded
 * WebAssembly component at module-evaluation time, and on React Native it
 * installs a Rust crate through `@kontor/sdk-native` — which isn't linked in
 * every app. So the client reaches every Kontor module through a dynamic
 * `import()`, and a bundler with code-splitting keeps those out of the entry
 * chunk. A single static `import … from "@kontor/sdk"` anywhere in the entry's
 * graph undoes all of it: importing `/react` at all would then compile the
 * Kontor WASM in apps that never touch Kontor (and crash Hermes in those that
 * can't).
 *
 * That is easy to break by accident — re-exporting one helper from a module
 * that happens to sit next to Kontor code is enough — and impossible to notice
 * without measuring, so it is asserted here rather than re-verified by hand.
 * `kontor/gas.ts` exists precisely to be importable from this side of the line:
 * it is pure arithmetic with no `@kontor/sdk` import, and the React layer reads
 * it for the Max affordance and the gas-cost labels.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");

/**
 * Specifiers that survive into the emitted JavaScript.
 *
 * Excluded, both deliberately:
 *  - `import("…")` — dynamic, and the whole mechanism by which Kontor stays out
 *    of the entry chunk.
 *  - `import type … from "…"` / `export type … from "…"` — erased at compile
 *    time (the package builds with `verbatimModuleSyntax`, which keeps the
 *    *statement* only when a value binding remains), so a type-only reference to
 *    a Kontor type costs a bundle nothing. Most of this package's Kontor
 *    references are exactly that.
 */
function staticSpecifiers(source: string): string[] {
  const specs: string[] = [];
  // `import <clause> from "x"` / `export <clause> from "x"`, clause captured so
  // a leading `type` can be recognised and skipped.
  const fromRe =
    /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s*from\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = fromRe.exec(source)) !== null) {
    if (/^type\b/.test(match[1]!)) continue;
    specs.push(match[2]!);
  }
  // Bare side-effect imports: `import "x"`.
  const bareRe = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  while ((match = bareRe.exec(source)) !== null) specs.push(match[1]!);
  return specs;
}

/** Resolve a NodeNext-style `./foo.js` specifier back to its TypeScript file. */
function resolveLocal(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    base,
    `${base}.ts`,
    `${base}.tsx`,
    resolve(base, "index.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Walk the static import graph from `entry`.
 *
 * Returns both halves of it, because both are asserted below: `bare` maps every
 * bare (non-relative) specifier to the files importing it, and `files` is the
 * set of local modules actually visited — which is what says whether a module
 * is still *reachable*, since a relative specifier never lands in `bare`.
 */
function staticImportGraph(entry: string): {
  bare: Map<string, string[]>;
  files: Set<string>;
} {
  const bare = new Map<string, string[]>();
  const files = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    for (const spec of staticSpecifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        const target = resolveLocal(file, spec);
        // An unresolvable relative specifier would silently shrink the graph and
        // make this test pass by not looking — fail loudly instead.
        expect(target, `${file} imports unresolvable ${spec}`).not.toBeNull();
        queue.push(target!);
        continue;
      }
      const importers = bare.get(spec) ?? [];
      importers.push(file.slice(SRC.length + 1));
      bare.set(spec, importers);
    }
  }
  return { bare, files };
}

describe.each([
  ["web", resolve(SRC, "react/index.web.ts")],
  ["native", resolve(SRC, "react/index.native.ts")],
])("%s React entry", (_platform, entry) => {
  it("never statically imports the Kontor backend", () => {
    const { bare } = staticImportGraph(entry);
    const offenders = [...bare.entries()].filter(([spec]) =>
      spec.startsWith("@kontor/"),
    );
    expect(
      offenders,
      `these modules statically import the Kontor backend: ${offenders
        .map(([spec, importers]) => `${spec} ← ${importers.join(", ")}`)
        .join("; ")}`,
    ).toEqual([]);
  });

  it("still reaches the Kontor gas arithmetic (it is the point of gas.ts)", () => {
    // Guards the other direction. The test above only says the entry doesn't
    // reach the backend — a graph that reached *nothing* would satisfy it just
    // as well. So assert the pricing is still in there: if the Max affordance's
    // arithmetic ever moved behind a module that does pull `@kontor/sdk`, it
    // would have to leave this graph to keep the test above green, and that is
    // the React layer silently losing its ability to price gas at all.
    const gasFile = resolve(SRC, "kontor/gas.ts");
    const { files } = staticImportGraph(entry);
    expect(
      files.has(gasFile),
      "the entry no longer statically reaches kontor/gas.ts — the React layer " +
        "can't price gas without pulling the Kontor backend",
    ).toBe(true);

    // And that the file it reaches is still on this side of the line. Read with
    // the same walker the graph uses, so both directions agree on what counts:
    // a bare `import "@kontor/sdk"` is caught, an erased `import type` is not.
    const kontorImports = staticSpecifiers(
      readFileSync(gasFile, "utf8"),
    ).filter((spec) => spec.startsWith("@kontor/"));
    expect(
      kontorImports,
      `kontor/gas.ts must stay free of the Kontor backend, but imports: ${kontorImports.join(", ")}`,
    ).toEqual([]);
  });
});
