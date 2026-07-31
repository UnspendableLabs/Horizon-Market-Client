import { describe, it, expect, vi } from "vitest";
import { WorkflowProgressReporter } from "./progress.js";
import type { WorkflowProgressEvent } from "../types/index.js";

/**
 * `onProgress` is arbitrary host code — a React `setState`, a CLI spinner, an
 * analytics call. It reports on the workflow; it must never be able to *change*
 * what the workflow does. These pin that containment, because the two places it
 * used to leak are both expensive: a throw on `acceptKontorOffer`'s `complete`
 * landed after the swap reveal was broadcast (masking
 * `KontorPurchaseNotRecordedError`, and with it the txid the recovery needs),
 * and a throw on the pre-flight step's `complete` escaped the `try/finally`
 * that closes the Kontor session.
 */
describe("WorkflowProgressReporter: a broken listener can't break the workflow", () => {
  it("returns the step's result when the listener throws on complete", async () => {
    const reporter = new WorkflowProgressReporter("delistSwap", () => {
      throw new Error("host listener blew up");
    });

    await expect(
      reporter.runAsync("startDelist", async () => "delist-request-1"),
    ).resolves.toBe("delist-request-1");
    expect(reporter.runSync("confirmDelist", () => 42)).toBe(42);
  });

  it("still surfaces the step's own error, not the listener's", async () => {
    // The `error` emit is inside the catch, so a throwing listener there would
    // replace the real cause with its own — the worst possible substitution.
    const reporter = new WorkflowProgressReporter("delistSwap", () => {
      throw new Error("host listener blew up");
    });

    await expect(
      reporter.runAsync("startDelist", () =>
        Promise.reject(new Error("the server said no")),
      ),
    ).rejects.toThrow("the server said no");
  });

  it("keeps reporting after a listener throws", async () => {
    // Containment, not a mute button: one bad event must not silence the rest.
    let calls = 0;
    const onProgress = vi.fn((_event: WorkflowProgressEvent) => {
      calls++;
      if (calls === 1) throw new Error("first event blew up");
    });
    const reporter = new WorkflowProgressReporter("delistSwap", onProgress, 3);

    await reporter.runAsync("startDelist", async () => undefined);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[1]?.[0]).toMatchObject({
      workflow: "delistSwap",
      step: "startDelist",
      phase: "complete",
      stepIndex: 1,
      totalSteps: 3,
    });
  });
});
