import { describe, expect, it } from "vitest";
import { InMemoryReportQueue } from "./queue.js";

describe("InMemoryReportQueue", () => {
  it("runs enqueued jobs in FIFO order, one at a time", async () => {
    const queue = new InMemoryReportQueue();
    const order: number[] = [];
    let resolveFirst: (() => void) | undefined;

    const done = new Promise<void>((resolveTest) => {
      queue.enqueue(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = () => {
              order.push(1);
              resolve();
            };
          }),
      );
      queue.enqueue(async () => {
        order.push(2);
        resolveTest();
      });
    });

    // The second job must not have run yet — the queue is single-worker.
    expect(order).toEqual([]);
    resolveFirst?.();
    await done;
    expect(order).toEqual([1, 2]);
  });

  it("keeps draining after a job throws, without losing later jobs", async () => {
    const queue = new InMemoryReportQueue();
    const seen: string[] = [];
    const done = new Promise<void>((resolve) => {
      queue.enqueue(async () => {
        seen.push("a");
        throw new Error("boom");
      });
      queue.enqueue(async () => {
        seen.push("b");
        resolve();
      });
    });
    await done;
    expect(seen).toEqual(["a", "b"]);
  });
});
