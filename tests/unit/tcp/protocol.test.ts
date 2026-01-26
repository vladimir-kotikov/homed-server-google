import {
  escapePacket,
  readPacket,
  unescapePacket,
} from "../../../src/tcp/protocol.ts";

describe("Protocol Packet Handling", () => {
  describe("readPacket", () => {
    it("should extract packet between start and end markers", () => {
      const data = Buffer.from([0x42, 0x01, 0x02, 0x03, 0x43]);
      const [packet, remainder] = readPacket(data);

      expect(packet).toEqual(Buffer.from([0x01, 0x02, 0x03]));
      expect(remainder).toEqual(Buffer.from([]));
    });

    it("should return undefined if no start marker", () => {
      const data = Buffer.from([0x01, 0x02, 0x43]);
      const [packet, remainder] = readPacket(data);

      expect(packet).toBeUndefined();
      expect(remainder).toEqual(data);
    });

    it("should return undefined if no end marker", () => {
      const data = Buffer.from([0x42, 0x01, 0x02]);
      const [packet, remainder] = readPacket(data);

      expect(packet).toBeUndefined();
      expect(remainder).toEqual(data);
    });

    it("should return undefined if end marker before start marker", () => {
      const data = Buffer.from([0x43, 0x42, 0x01]);
      const [packet, remainder] = readPacket(data);

      expect(packet).toBeUndefined();
      expect(remainder).toEqual(data);
    });

    it("should extract first complete packet and return remainder", () => {
      const data = Buffer.from([
        0x42, 0x01, 0x02, 0x43, 0x42, 0x03, 0x04, 0x43,
      ]);
      const [packet, remainder] = readPacket(data);

      expect(packet).toEqual(Buffer.from([0x01, 0x02]));
      expect(remainder).toEqual(Buffer.from([0x42, 0x03, 0x04, 0x43]));
    });

    it("should handle empty packet", () => {
      const data = Buffer.from([0x42, 0x43]);
      const [packet, remainder] = readPacket(data);

      expect(packet).toEqual(Buffer.from([]));
      expect(remainder).toEqual(Buffer.from([]));
    });

    it("should handle escaped markers in packet content", () => {
      // Packet: [0x42, ESCAPED_START, 0x01, 0x43] -> should extract [ESCAPED_START, 0x01]
      const data = Buffer.from([0x42, 0x44, 0x62, 0x01, 0x43]);
      const [packet, remainder] = readPacket(data);

      expect(packet).toEqual(Buffer.from([0x44, 0x62, 0x01]));
      expect(remainder).toEqual(Buffer.from([]));
    });
  });

  describe("escapePacket", () => {
    it("should escape START_MARKER (0x42)", () => {
      const data = Buffer.from([0x42]);
      const escaped = escapePacket(data);

      expect(escaped).toEqual(Buffer.from([0x44, 0x62]));
    });

    it("should escape END_MARKER (0x43)", () => {
      const data = Buffer.from([0x43]);
      const escaped = escapePacket(data);

      expect(escaped).toEqual(Buffer.from([0x44, 0x63]));
    });

    it("should escape ESCAPE_MARKER (0x44)", () => {
      const data = Buffer.from([0x44]);
      const escaped = escapePacket(data);

      expect(escaped).toEqual(Buffer.from([0x44, 0x64]));
    });

    it("should escape multiple special bytes", () => {
      const data = Buffer.from([0x42, 0x43, 0x44]);
      const escaped = escapePacket(data);

      expect(escaped).toEqual(
        Buffer.from([0x44, 0x62, 0x44, 0x63, 0x44, 0x64])
      );
    });

    it("should not escape regular bytes", () => {
      const data = Buffer.from([0x01, 0x02, 0x03]);
      const escaped = escapePacket(data);

      expect(escaped).toEqual(data);
    });

    it("should handle mixed regular and special bytes", () => {
      const data = Buffer.from([0x01, 0x42, 0x02, 0x43, 0x03]);
      const escaped = escapePacket(data);

      expect(escaped).toEqual(
        Buffer.from([0x01, 0x44, 0x62, 0x02, 0x44, 0x63, 0x03])
      );
    });
  });

  describe("unescapePacket", () => {
    it("should unescape START_MARKER sequence", () => {
      const escaped = Buffer.from([0x44, 0x62]);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(Buffer.from([0x42]));
    });

    it("should unescape END_MARKER sequence", () => {
      const escaped = Buffer.from([0x44, 0x63]);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(Buffer.from([0x43]));
    });

    it("should unescape ESCAPE_MARKER sequence", () => {
      const escaped = Buffer.from([0x44, 0x64]);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(Buffer.from([0x44]));
    });

    it("should unescape multiple sequences", () => {
      const escaped = Buffer.from([0x44, 0x62, 0x44, 0x63, 0x44, 0x64]);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(Buffer.from([0x42, 0x43, 0x44]));
    });

    it("should leave regular bytes unchanged", () => {
      const escaped = Buffer.from([0x01, 0x02, 0x03]);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(escaped);
    });

    it("should handle mixed regular and escaped bytes", () => {
      const escaped = Buffer.from([0x01, 0x44, 0x62, 0x02, 0x44, 0x63, 0x03]);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(Buffer.from([0x01, 0x42, 0x02, 0x43, 0x03]));
    });

    it("should handle escape marker at end of buffer", () => {
      const escaped = Buffer.from([0x01, 0x02, 0x44]);
      const unescaped = unescapePacket(escaped);

      // Escape marker at end with no following byte
      expect(unescaped).toEqual(Buffer.from([0x01, 0x02, 0x44]));
    });

    it("should handle incomplete escape sequence", () => {
      const escaped = Buffer.from([0x01, 0x44]); // 0x44 at end, no next byte
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(Buffer.from([0x01, 0x44]));
    });

    it("should handle invalid escape sequence", () => {
      const escaped = Buffer.from([0x44, 0xff]); // Invalid escape code
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(Buffer.from([0x44, 0xff]));
    });
  });

  describe("round-trip: escape and unescape", () => {
    it("should recover original data after escape/unescape", () => {
      const original = Buffer.from([0x42, 0x43, 0x44, 0x01, 0x02]);
      const escaped = escapePacket(original);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(original);
    });

    it("should handle regular data without modification", () => {
      const original = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const escaped = escapePacket(original);
      const unescaped = unescapePacket(escaped);

      expect(escaped).toEqual(original);
      expect(unescaped).toEqual(original);
    });

    it("should handle large data", () => {
      const original = Buffer.alloc(1000);
      for (let index = 0; index < original.length; index++) {
        original[index] = index % 256;
      }

      const escaped = escapePacket(original);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(original);
    });

    it("should handle all special bytes", () => {
      const special = Buffer.from([0x42, 0x43, 0x44, 0x42, 0x44, 0x43]);
      const escaped = escapePacket(special);
      const unescaped = unescapePacket(escaped);

      expect(unescaped).toEqual(special);
    });
  });

  describe("protocol message framing", () => {
    it("should frame and unframe a complete message", () => {
      const messageData = Buffer.from(
        JSON.stringify({
          action: "publish",
          topic: "test/topic",
          message: { data: "hello" },
        })
      );

      // Escape the data
      const escaped = escapePacket(messageData);

      // Create frame: [START, escaped_data, END]
      const framed = Buffer.concat([
        Buffer.from([0x42]),
        escaped,
        Buffer.from([0x43]),
      ]);

      // Extract packet
      const [packet, remainder] = readPacket(framed);

      expect(packet).toEqual(escaped);
      expect(remainder).toEqual(Buffer.from([]));

      // Unescape to get original
      const unescaped = unescapePacket(packet!);
      expect(unescaped).toEqual(messageData);

      // Parse JSON
      const message: ProtocolMessage = JSON.parse(unescaped.toString());
      expect(message.action).toBe("publish");
      expect(message.topic).toBe("test/topic");
    });

    it("should handle multiple framed messages", () => {
      const message1 = Buffer.from("message1");
      const message2 = Buffer.from("message2");

      const escaped1 = escapePacket(message1);
      const escaped2 = escapePacket(message2);

      const framed1 = Buffer.concat([
        Buffer.from([0x42]),
        escaped1,
        Buffer.from([0x43]),
      ]);
      const framed2 = Buffer.concat([
        Buffer.from([0x42]),
        escaped2,
        Buffer.from([0x43]),
      ]);

      const combined = Buffer.concat([framed1, framed2]);

      // Extract first message
      const [packet1, remainder1] = readPacket(combined);
      expect(packet1).toEqual(escaped1);

      // Extract second message from remainder
      const [packet2, remainder2] = readPacket(remainder1);
      expect(packet2).toEqual(escaped2);
      expect(remainder2).toEqual(Buffer.from([]));

      // Verify unescaping
      expect(unescapePacket(packet1!)).toEqual(message1);
      expect(unescapePacket(packet2!)).toEqual(message2);
    });

    it("should handle partial messages in buffer", () => {
      const messageData = Buffer.from("test message content");
      const escaped = escapePacket(messageData);
      const framed = Buffer.concat([
        Buffer.from([0x42]),
        escaped,
        Buffer.from([0x43]),
      ]);

      // Split message in half
      const half = Math.floor(framed.length / 2);
      const part1 = framed.slice(0, half);
      const part2 = framed.slice(half);

      // First read should return undefined (incomplete)
      const [packet1] = readPacket(part1);
      expect(packet1).toBeUndefined();

      // Combine and read again
      const combined = Buffer.concat([part1, part2]);
      const [packet2, remainder] = readPacket(combined);

      expect(packet2).toEqual(escaped);
      expect(remainder).toEqual(Buffer.from([]));
      expect(unescapePacket(packet2!)).toEqual(messageData);
    });
  });
});
