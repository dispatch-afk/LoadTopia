import { ConnectionStatus } from "@loadtopia/shared";
import { describe, expect, it } from "vitest";
import {
  assertValidConnectionTransition,
  canRespondToConnection,
  canTransitionConnection,
} from "./connection-state-machine";
import { NetworkError } from "./errors";

describe("canTransitionConnection", () => {
  it("allows a fresh request from no existing connection", () => {
    expect(canTransitionConnection(null, "REQUEST")).toBe(true);
  });

  it("allows accept/decline only from PENDING", () => {
    expect(canTransitionConnection(ConnectionStatus.PENDING, "ACCEPT")).toBe(true);
    expect(canTransitionConnection(ConnectionStatus.PENDING, "DECLINE")).toBe(true);
    expect(canTransitionConnection(ConnectionStatus.ACCEPTED, "ACCEPT")).toBe(false);
    expect(canTransitionConnection(null, "ACCEPT")).toBe(false);
  });

  it("allows disconnect only from ACCEPTED", () => {
    expect(canTransitionConnection(ConnectionStatus.ACCEPTED, "DISCONNECT")).toBe(true);
    expect(canTransitionConnection(ConnectionStatus.PENDING, "DISCONNECT")).toBe(false);
    expect(canTransitionConnection(ConnectionStatus.DECLINED, "DISCONNECT")).toBe(false);
  });

  it("allows re-request from DECLINED or DISCONNECTED, never from PENDING/ACCEPTED", () => {
    expect(canTransitionConnection(ConnectionStatus.DECLINED, "REQUEST")).toBe(true);
    expect(canTransitionConnection(ConnectionStatus.DISCONNECTED, "REQUEST")).toBe(true);
    expect(canTransitionConnection(ConnectionStatus.PENDING, "REQUEST")).toBe(false);
    expect(canTransitionConnection(ConnectionStatus.ACCEPTED, "REQUEST")).toBe(false);
  });

  it("never allows DECLINED straight to ACCEPTED, or PENDING straight to DISCONNECTED", () => {
    // (These aren't real actions in the enum, but confirm no action reaches
    // an invalid combination via any documented path.)
    expect(canTransitionConnection(ConnectionStatus.DECLINED, "ACCEPT")).toBe(false);
    expect(canTransitionConnection(ConnectionStatus.PENDING, "DISCONNECT")).toBe(false);
  });
});

describe("assertValidConnectionTransition", () => {
  it("returns the resulting status on a valid transition", () => {
    expect(assertValidConnectionTransition(null, "REQUEST")).toBe(ConnectionStatus.PENDING);
    expect(assertValidConnectionTransition(ConnectionStatus.PENDING, "ACCEPT")).toBe(
      ConnectionStatus.ACCEPTED,
    );
    expect(assertValidConnectionTransition(ConnectionStatus.PENDING, "DECLINE")).toBe(
      ConnectionStatus.DECLINED,
    );
    expect(assertValidConnectionTransition(ConnectionStatus.ACCEPTED, "DISCONNECT")).toBe(
      ConnectionStatus.DISCONNECTED,
    );
    expect(assertValidConnectionTransition(ConnectionStatus.DISCONNECTED, "REQUEST")).toBe(
      ConnectionStatus.PENDING,
    );
  });

  it("throws NetworkError on an invalid transition", () => {
    expect(() => assertValidConnectionTransition(ConnectionStatus.ACCEPTED, "REQUEST")).toThrow(
      NetworkError,
    );
    expect(() => assertValidConnectionTransition(null, "ACCEPT")).toThrow(NetworkError);
  });
});

describe("canRespondToConnection", () => {
  it("forbids the requester from responding to their own request", () => {
    expect(canRespondToConnection("co-A", "co-A")).toBe(false);
  });

  it("allows the other company to respond", () => {
    expect(canRespondToConnection("co-B", "co-A")).toBe(true);
  });
});
