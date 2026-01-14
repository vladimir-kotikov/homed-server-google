import {
  AES128CBC,
  deriveMD5Key,
  DHKeyExchange,
  padBuffer,
  unpadBuffer,
} from "../../src/tcp/crypto";

describe("DHKeyExchange", () => {
  it("should generate DH parameters", () => {
    const dh = new DHKeyExchange();
    const params = dh.generateParameters();

    expect(params.prime).toBeDefined();
    expect(params.generator).toBeDefined();
    expect(params.sharedKey).toBeDefined();
    expect(typeof params.prime).toBe("number");
    expect(typeof params.generator).toBe("number");
    expect(typeof params.sharedKey).toBe("number");
  });

  it("should compute private key from client shared key", () => {
    const dh = new DHKeyExchange();
    const clientSharedKey = 12345;

    const privateKey = dh.computePrivateKey(clientSharedKey);

    expect(typeof privateKey).toBe("number");
    expect(privateKey).toBeGreaterThan(0);
  });

  it("should get server shared key", () => {
    const dh = new DHKeyExchange();
    const sharedKey = dh.getSharedKey();

    expect(typeof sharedKey).toBe("number");
    expect(sharedKey).toBeGreaterThan(0);
  });
});

describe("deriveMD5Key", () => {
  it("should derive 16-byte key from private key", () => {
    const privateKey = 123456789;
    const key = deriveMD5Key(privateKey);

    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(16);
  });

  it("should produce consistent results", () => {
    const privateKey = 123456789;
    const key1 = deriveMD5Key(privateKey);
    const key2 = deriveMD5Key(privateKey);

    expect(key1).toEqual(key2);
  });

  it("should produce different keys for different inputs", () => {
    const key1 = deriveMD5Key(123);
    const key2 = deriveMD5Key(456);

    expect(key1).not.toEqual(key2);
  });
});

describe("AES128CBC", () => {
  const testKey = Buffer.from("0123456789abcdef");
  const testIV = Buffer.from("fedcba9876543210");

  describe("constructor", () => {
    it("should accept 16-byte key and IV", () => {
      expect(() => new AES128CBC(testKey, testIV)).not.toThrow();
    });

    it("should throw on invalid key length", () => {
      const shortKey = Buffer.from("short");
      expect(() => new AES128CBC(shortKey, testIV)).toThrow(
        "AES-128 key must be 16 bytes"
      );
    });

    it("should throw on invalid IV length", () => {
      const shortIV = Buffer.from("short");
      expect(() => new AES128CBC(testKey, shortIV)).toThrow(
        "AES IV must be 16 bytes"
      );
    });
  });

  describe("encrypt/decrypt", () => {
    it("should encrypt and decrypt data correctly", () => {
      const aes = new AES128CBC(testKey, testIV);
      const plaintext = Buffer.from("Hello, World!!!!"); // 16 bytes

      const encrypted = aes.encrypt(plaintext);
      const decrypted = aes.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("should produce different ciphertext than plaintext", () => {
      const aes = new AES128CBC(testKey, testIV);
      const plaintext = Buffer.from("0123456789abcdef");

      const encrypted = aes.encrypt(plaintext);

      expect(encrypted).not.toEqual(plaintext);
    });

    it("should handle 32-byte data", () => {
      const aes = new AES128CBC(testKey, testIV);
      const plaintext = Buffer.from("01234567890123456789012345678901"); // 32 bytes

      const encrypted = aes.encrypt(plaintext);
      const decrypted = aes.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });

    it("should handle 48-byte data", () => {
      const aes = new AES128CBC(testKey, testIV);
      const plaintext = Buffer.from(
        "012345678901234567890123456789012345678901234567"
      ); // 48 bytes

      const encrypted = aes.encrypt(plaintext);
      const decrypted = aes.decrypt(encrypted);

      expect(decrypted).toEqual(plaintext);
    });
  });
});

describe("padBuffer", () => {
  it("should pad to 16-byte boundary", () => {
    const buffer = Buffer.from("hello"); // 5 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(16);
    expect(padded.length % 16).toBe(0);
  });

  it("should not pad if already aligned", () => {
    const buffer = Buffer.from("0123456789abcdef"); // 16 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(16);
    expect(padded).toEqual(buffer);
  });

  it("should pad with zeros", () => {
    const buffer = Buffer.from("test"); // 4 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(16);
    expect(padded.slice(0, 4)).toEqual(buffer);
    expect(padded.slice(4).every(b => b === 0)).toBe(true);
  });

  it("should handle 15-byte buffer", () => {
    const buffer = Buffer.from("123456789012345"); // 15 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(16);
  });

  it("should handle 17-byte buffer", () => {
    const buffer = Buffer.from("12345678901234567"); // 17 bytes
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(32);
  });

  it("should handle empty buffer", () => {
    const buffer = Buffer.from([]);
    const padded = padBuffer(buffer);

    expect(padded.length).toBe(0);
  });
});

describe("unpadBuffer", () => {
  it("should remove zero padding", () => {
    const original = Buffer.from("hello");
    const padded = padBuffer(original);
    const unpadded = unpadBuffer(padded);

    expect(unpadded).toEqual(original);
  });

  it("should handle buffer with no padding", () => {
    const buffer = Buffer.from("0123456789abcdef");
    const unpadded = unpadBuffer(buffer);

    expect(unpadded).toEqual(buffer);
  });

  it("should handle buffer that ends with non-zero", () => {
    const buffer = Buffer.from([1, 2, 3, 4, 5]);
    const unpadded = unpadBuffer(buffer);

    expect(unpadded).toEqual(buffer);
  });

  it("should handle all-zero buffer", () => {
    const buffer = Buffer.from([0, 0, 0, 0]);
    const unpadded = unpadBuffer(buffer);

    expect(unpadded.length).toBe(0);
  });

  it("should preserve data before padding", () => {
    const original = Buffer.from("test data here");
    const padded = padBuffer(original);
    const unpadded = unpadBuffer(padded);

    expect(unpadded.toString()).toBe(original.toString());
  });
});

describe("Integration: padBuffer + AES + unpadBuffer", () => {
  it("should handle round-trip encryption with padding", () => {
    const testKey = Buffer.from("0123456789abcdef");
    const testIV = Buffer.from("fedcba9876543210");
    const aes = new AES128CBC(testKey, testIV);

    const plaintext = Buffer.from("This is a test message!");
    const padded = padBuffer(plaintext);
    const encrypted = aes.encrypt(padded);
    const decrypted = aes.decrypt(encrypted);
    const unpadded = unpadBuffer(decrypted);

    expect(unpadded).toEqual(plaintext);
  });

  it("should handle JSON data", () => {
    const testKey = Buffer.from("0123456789abcdef");
    const testIV = Buffer.from("fedcba9876543210");
    const aes = new AES128CBC(testKey, testIV);

    const json = JSON.stringify({
      action: "test",
      topic: "test/topic",
      message: "hello",
    });
    const plaintext = Buffer.from(json);
    const padded = padBuffer(plaintext);
    const encrypted = aes.encrypt(padded);
    const decrypted = aes.decrypt(encrypted);
    const unpadded = unpadBuffer(decrypted);

    expect(unpadded.toString()).toBe(json);
    expect(JSON.parse(unpadded.toString())).toEqual(JSON.parse(json));
  });
});
