import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  iterateLinesFromStream,
  iteratePgnGames,
} from "../src/imports/pgn_stream.js";

describe("PGN stream parsing", () => {
  it("iterates lines from plain stream", async () => {
    const source = Readable.from(["a\nb\n", "c\n"]);
    const lines: string[] = [];

    for await (const line of iterateLinesFromStream(source, false)) {
      lines.push(line);
    }

    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("splits a stream into multiple games", async () => {
    const source = Readable.from([
      "[Event \"A\"]\n[White \"One\"]\n\n1. e4 e5 1-0\n",
      "[Event \"B\"]\n[White \"Two\"]\n\n1. d4 d5 1/2-1/2\n",
    ]);

    const lines = iterateLinesFromStream(source, false);
    const games: string[] = [];

    for await (const game of iteratePgnGames(lines)) {
      games.push(game.pgnText);
    }

    expect(games).toHaveLength(2);
    expect(games[0]).toContain("[Event \"A\"]");
    expect(games[1]).toContain("[Event \"B\"]");
  });

  it("decompresses zstd stream chunks", async () => {
    const compressedBase64 = "KLUv/QRY0QAAW0V2ZW50ICJBIl0KCjEuIGU0IGU1IDEtMArr+hPt";
    const source = Readable.from([Buffer.from(compressedBase64, "base64")]);
    const lines: string[] = [];

    for await (const line of iterateLinesFromStream(source, true)) {
      lines.push(line);
    }

    expect(lines).toEqual(["[Event \"A\"]", "", "1. e4 e5 1-0"]);
  });
});
