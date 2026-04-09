import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createEncryptedJsonCrypto } from "../../src/services/lib/encrypted-json-crypto.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-encrypted-json-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) =>
      rm(tempDir, { force: true, recursive: true })
    ),
  );
});

describe("encrypted JSON crypto", () => {
  it("round-trips JSON payloads", async () => {
    const dataDir = await makeTempDir();
    const crypto = await createEncryptedJsonCrypto({
      dataDir,
      fileName: "crypto-secret",
    });

    const payload = crypto.encryptJson({
      plaintext: JSON.stringify({
        accessToken: "secret-access-token",
      }),
    });

    expect(
      crypto.decryptJson({
        payload,
        schema: z.object({
          accessToken: z.string(),
        }),
      }),
    ).toEqual({
      accessToken: "secret-access-token",
    });
  });

  it("rejects malformed secret lengths", async () => {
    const dataDir = await makeTempDir();
    await writeFile(
      path.join(dataDir, "crypto-secret"),
      `${Buffer.from("short-secret", "utf8").toString("base64")}\n`,
      "utf8",
    );

    await expect(
      createEncryptedJsonCrypto({
        dataDir,
        fileName: "crypto-secret",
      }),
    ).rejects.toThrow("must decode to 32 bytes");
  });

  it("rejects tampered ciphertext envelopes", async () => {
    const dataDir = await makeTempDir();
    const crypto = await createEncryptedJsonCrypto({
      dataDir,
      fileName: "crypto-secret",
    });

    const envelope = JSON.parse(
      crypto.encryptJson({
        plaintext: JSON.stringify({
          accessToken: "secret-access-token",
        }),
      }),
    );
    envelope.tag = Buffer.from("tampered-tag", "utf8").toString("base64");

    expect(() =>
      crypto.decryptJson({
        payload: JSON.stringify(envelope),
        schema: z.object({
          accessToken: z.string(),
        }),
      })
    ).toThrow();
  });
});
