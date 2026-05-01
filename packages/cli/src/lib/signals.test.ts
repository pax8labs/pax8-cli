import { describe, it, expect, beforeEach } from "vitest";
import {
  markWriteInFlight,
  _getWriteInFlight,
  _resetWriteInFlight,
} from "./signals.js";

describe("markWriteInFlight", () => {
  beforeEach(() => {
    _resetWriteInFlight();
  });

  it("registers an in-flight write", () => {
    expect(_getWriteInFlight()).toBeNull();
    markWriteInFlight("orders");
    expect(_getWriteInFlight()).toEqual({ resource: "orders", hint: undefined });
  });

  it("clears the registry when done() is called", () => {
    const done = markWriteInFlight("orders");
    expect(_getWriteInFlight()).not.toBeNull();
    done();
    expect(_getWriteInFlight()).toBeNull();
  });

  it("the latest call wins; an older done() does not clear a newer entry", () => {
    const doneA = markWriteInFlight("orders");
    const doneB = markWriteInFlight("subscriptions");
    expect(_getWriteInFlight()?.resource).toBe("subscriptions");
    // The first done() should be a no-op now that B is the active write.
    doneA();
    expect(_getWriteInFlight()?.resource).toBe("subscriptions");
    doneB();
    expect(_getWriteInFlight()).toBeNull();
  });

  it("preserves the optional hint", () => {
    markWriteInFlight("orders", "id=abc");
    expect(_getWriteInFlight()).toEqual({ resource: "orders", hint: "id=abc" });
  });
});
