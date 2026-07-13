// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCtx, renderHook, type CtxRef } from "../hook-test-utils.js";
import { defaultTheme } from "../theme.js";
import { useTheme } from "./useTheme.js";

const { ctxRef } = vi.hoisted(() => ({ ctxRef: { current: null } as CtxRef }));
vi.mock("../context.js", () => ({ useHorizonMarket: () => ctxRef.current }));

describe("useTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the resolved theme from context", () => {
    ctxRef.current = makeCtx();
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe(defaultTheme);
  });

  it("passes through a custom theme unchanged", () => {
    const custom = { ...defaultTheme, borderWidth: 3 };
    ctxRef.current = makeCtx({ theme: custom });
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe(custom);
  });
});
