import { describe, expect, it } from "vitest";
import {
  clientTurnRequestIdSchema,
  encodeClientTurnRequestIdAlphabetIndexes,
  encodeClientTurnRequestIdNumber,
  formatClientTurnRequestIdSuffix,
  hostDaemonProducerEventIdSchema,
} from "../src/index.js";

describe("protocol id schemas", () => {
  it("accepts prefixed daemon event and client request ids", () => {
    expect(
      hostDaemonProducerEventIdSchema.safeParse("hdevt_23456789abcdefghijkm")
        .success,
    ).toBe(true);
    expect(clientTurnRequestIdSchema.safeParse("creq_23456789ab").success).toBe(
      true,
    );
  });

  it("rejects unprefixed or short ids", () => {
    expect(
      hostDaemonProducerEventIdSchema.safeParse("23456789abcdefghijkm").success,
    ).toBe(false);
    expect(clientTurnRequestIdSchema.safeParse("creq_23456789").success).toBe(
      false,
    );
  });

  it("formats and encodes client turn request ids with the shared alphabet", () => {
    expect(formatClientTurnRequestIdSuffix({ suffix: "23456789ab" })).toBe(
      "creq_23456789ab",
    );
    expect(encodeClientTurnRequestIdNumber({ value: 1 })).toBe(
      "creq_2222222223",
    );
    expect(
      encodeClientTurnRequestIdAlphabetIndexes({
        indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      }),
    ).toBe("creq_23456789ab");
  });

  it("rejects invalid client turn request id helper input", () => {
    expect(() => formatClientTurnRequestIdSuffix({ suffix: "bad" })).toThrow();
    expect(() => encodeClientTurnRequestIdNumber({ value: -1 })).toThrow();
    expect(() =>
      encodeClientTurnRequestIdAlphabetIndexes({ indexes: [0] }),
    ).toThrow();
    expect(() =>
      encodeClientTurnRequestIdAlphabetIndexes({
        indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 99],
      }),
    ).toThrow();
  });
});
