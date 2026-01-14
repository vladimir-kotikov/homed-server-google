import { MessageFramer } from '../../src/tcp/protocol';

describe('MessageFramer', () => {
  let framer: MessageFramer;

  beforeEach(() => {
    framer = new MessageFramer();
  });

  describe('frame', () => {
    it('should add start and end markers', () => {
      const data = Buffer.from('test');
      const framed = framer.frame(data);

      expect(framed[0]).toBe(0x42); // START_MARKER
      expect(framed[framed.length - 1]).toBe(0x43); // END_MARKER
    });

    it('should escape START_MARKER in data', () => {
      const data = Buffer.from([0x42]);
      const framed = framer.frame(data);

      // Should be: [START, ESCAPE, 0x62, END]
      expect(framed).toEqual(Buffer.from([0x42, 0x44, 0x62, 0x43]));
    });

    it('should escape END_MARKER in data', () => {
      const data = Buffer.from([0x43]);
      const framed = framer.frame(data);

      // Should be: [START, ESCAPE, 0x63, END]
      expect(framed).toEqual(Buffer.from([0x42, 0x44, 0x63, 0x43]));
    });

    it('should escape ESCAPE_MARKER in data', () => {
      const data = Buffer.from([0x44]);
      const framed = framer.frame(data);

      // Should be: [START, ESCAPE, 0x64, END]
      expect(framed).toEqual(Buffer.from([0x42, 0x44, 0x64, 0x43]));
    });

    it('should escape multiple special bytes', () => {
      const data = Buffer.from([0x42, 0x43, 0x44]);
      const framed = framer.frame(data);

      // Should be: [START, ESCAPE, 0x62, ESCAPE, 0x63, ESCAPE, 0x64, END]
      expect(framed).toEqual(Buffer.from([0x42, 0x44, 0x62, 0x44, 0x63, 0x44, 0x64, 0x43]));
    });

    it('should handle data with no special bytes', () => {
      const data = Buffer.from('hello world');
      const framed = framer.frame(data);

      expect(framed[0]).toBe(0x42);
      expect(framed[framed.length - 1]).toBe(0x43);
      expect(framed.slice(1, -1)).toEqual(data);
    });
  });

  describe('unframe', () => {
    it('should extract a single complete message', () => {
      const data = Buffer.from('test');
      const framed = framer.frame(data);

      const messages = framer.unframe(framed);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });

    it('should handle multiple messages in one chunk', () => {
      const data1 = Buffer.from('message1');
      const data2 = Buffer.from('message2');
      const framed1 = framer.frame(data1);
      const framed2 = framer.frame(data2);
      const combined = Buffer.concat([framed1, framed2]);

      const messages = framer.unframe(combined);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual(data1);
      expect(messages[1]).toEqual(data2);
    });

    it('should handle partial messages across multiple calls', () => {
      const data = Buffer.from('test message');
      const framed = framer.frame(data);

      // Split the framed message in half
      const part1 = framed.slice(0, Math.floor(framed.length / 2));
      const part2 = framed.slice(Math.floor(framed.length / 2));

      // First call should return no complete messages
      let messages = framer.unframe(part1);
      expect(messages).toHaveLength(0);

      // Second call should return the complete message
      messages = framer.unframe(part2);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });

    it('should unescape START_MARKER', () => {
      const data = Buffer.from([0x42]);
      const framed = framer.frame(data);
      const messages = framer.unframe(framed);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });

    it('should unescape END_MARKER', () => {
      const data = Buffer.from([0x43]);
      const framed = framer.frame(data);
      const messages = framer.unframe(framed);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });

    it('should unescape ESCAPE_MARKER', () => {
      const data = Buffer.from([0x44]);
      const framed = framer.frame(data);
      const messages = framer.unframe(framed);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });

    it('should handle complex escaped sequences', () => {
      const data = Buffer.from([0x42, 0x43, 0x44, 0x01, 0x02]);
      const framed = framer.frame(data);
      const messages = framer.unframe(framed);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });

    it('should handle empty data', () => {
      const data = Buffer.from([]);
      const framed = framer.frame(data);
      const messages = framer.unframe(framed);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });
  });

  describe('reset', () => {
    it('should clear internal buffer', () => {
      const data = Buffer.from('test');
      const framed = framer.frame(data);
      const partial = framed.slice(0, 5);

      framer.unframe(partial);
      framer.reset();

      // After reset, the buffer should be empty
      const messages = framer.unframe(framed);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });
  });

  describe('edge cases', () => {
    it('should handle buffer with only markers', () => {
      const data = Buffer.from([0x42, 0x43]);
      const messages = framer.unframe(data);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(Buffer.from([]));
    });

    it('should handle data before start marker', () => {
      const garbage = Buffer.from([0x01, 0x02, 0x03]);
      const data = Buffer.from('test');
      const framed = framer.frame(data);
      const combined = Buffer.concat([garbage, framed]);

      const messages = framer.unframe(combined);

      // Should ignore garbage before start marker
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });

    it('should handle large messages', () => {
      const data = Buffer.alloc(10000, 0xFF);
      const framed = framer.frame(data);
      const messages = framer.unframe(framed);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(data);
    });
  });
});
