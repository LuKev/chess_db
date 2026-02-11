import { describe, expect, it } from "vitest";
import { normalizeParsedGame } from "../src/imports/transform.js";

describe("normalizeParsedGame", () => {
  it("normalizes tags and computes hash", () => {
    const first = normalizeParsedGame({
      tags: {
        White: " Alpha  Player ",
        Black: "Beta Player",
        Result: "1-0",
        Event: "Club Match",
        Date: "2026.02.10",
      },
      moves: [
        { notation: { notation: "e4" } },
        { notation: { notation: "e5" } },
      ],
    });

    const second = normalizeParsedGame({
      tags: {
        White: "Alpha Player",
        Black: "Beta Player",
        Result: "1-0",
        Event: "Club Match",
        Date: "2026.02.10",
      },
      moves: [
        { notation: { notation: "e4" } },
        { notation: { notation: "e5" } },
      ],
    });

    expect(first.whiteNorm).toBe("alpha player");
    expect(first.playedOn).toBe("2026-02-10");
    expect(first.movesHash).toBe(second.movesHash);
  });
});
