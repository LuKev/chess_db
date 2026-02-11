import { Decompress } from "fzstd";

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  if (typeof chunk === "string") {
    return new TextEncoder().encode(chunk);
  }
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }

  return new Uint8Array(chunk as Buffer);
}

async function* decodeByteStream(
  source: AsyncIterable<unknown>,
  isZstd: boolean
): AsyncGenerator<Uint8Array> {
  if (!isZstd) {
    for await (const chunk of source) {
      yield toUint8Array(chunk);
    }
    return;
  }

  const outputChunks: Uint8Array[] = [];
  const decompressor = new Decompress((chunk) => {
    outputChunks.push(chunk);
  });

  for await (const chunk of source) {
    decompressor.push(toUint8Array(chunk));
    while (outputChunks.length > 0) {
      const next = outputChunks.shift();
      if (next) {
        yield next;
      }
    }
  }

  decompressor.push(new Uint8Array(0), true);
  while (outputChunks.length > 0) {
    const next = outputChunks.shift();
    if (next) {
      yield next;
    }
  }
}

export async function* iterateLinesFromStream(
  source: AsyncIterable<unknown>,
  isZstd: boolean
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let carry = "";

  for await (const bytes of decodeByteStream(source, isZstd)) {
    carry += decoder.decode(bytes, { stream: true });

    let newlineIndex = carry.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = carry.slice(0, newlineIndex).replace(/\r$/, "");
      yield line;
      carry = carry.slice(newlineIndex + 1);
      newlineIndex = carry.indexOf("\n");
    }
  }

  carry += decoder.decode();
  if (carry.length > 0) {
    yield carry.replace(/\r$/, "");
  }
}

export async function* iteratePgnGames(
  lines: AsyncIterable<string>
): AsyncGenerator<{ gameOffset: number; pgnText: string }> {
  let currentLines: string[] = [];
  let hasMoves = false;
  let gameOffset = 0;

  for await (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("[") && hasMoves && currentLines.length > 0) {
      const pgnText = currentLines.join("\n").trim();
      if (pgnText.length > 0) {
        gameOffset += 1;
        yield { gameOffset, pgnText };
      }
      currentLines = [line];
      hasMoves = false;
      continue;
    }

    if (trimmed.length > 0 && !trimmed.startsWith("[")) {
      hasMoves = true;
    }

    currentLines.push(line);
  }

  const pgnText = currentLines.join("\n").trim();
  if (pgnText.length > 0) {
    gameOffset += 1;
    yield { gameOffset, pgnText };
  }
}
