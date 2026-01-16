/**
 * Binary message protocol implementation for Homed TCP communication
 *
 * Protocol:
 * - Start marker: 0x42
 * - End marker: 0x43
 * - Escape marker: 0x44
 * - Escape sequences: 0x42 -> 0x44,0x62 | 0x43 -> 0x44,0x63 | 0x44 -> 0x44,0x64
 * - Payload: AES-128-CBC encrypted JSON
 */

const START_MARKER = 0x42;
const END_MARKER = 0x43;
const ESCAPE_MARKER = 0x44;

/**
 * Protocol message interface
 */
export interface ProtocolMessage {
  action: "subscribe" | "publish";
  topic: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message?: any;
}

/**
 * Message framing/unframing for binary protocol
 */
export class MessageFramer {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Frame a message with start/end markers and escape sequences
   */
  frame(data: Buffer): Buffer {
    const escaped = this.escape(data);
    const framed = Buffer.allocUnsafe(escaped.length + 2);

    framed[0] = START_MARKER;
    escaped.copy(framed, 1);
    framed[framed.length - 1] = END_MARKER;

    return framed;
  }

  /**
   * Unframe messages from accumulated buffer
   * Returns array of complete message buffers
   */
  unframe(chunk: Buffer): Buffer[] {
    // Append new data to buffer
    this.buffer = Buffer.concat([this.buffer, chunk]);

    const messages: Buffer[] = [];
    let start = -1;

    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] === START_MARKER && start === -1) {
        start = i;
      } else if (this.buffer[i] === END_MARKER && start !== -1) {
        // Found complete message
        const escapedData = this.buffer.slice(start + 1, i);
        const unescapedData = this.unescape(escapedData);
        messages.push(unescapedData);

        // Remove processed message from buffer
        this.buffer = this.buffer.slice(i + 1);
        i = -1; // Reset search
        start = -1;
      }
    }

    // If we found a start but no end, keep it in buffer
    if (start !== -1 && start > 0) {
      this.buffer = this.buffer.slice(start);
    }

    return messages;
  }

  /**
   * Clear the internal buffer
   */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Escape special bytes in data
   */
  private escape(data: Buffer): Buffer {
    const escaped: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const byte = data[i];

      if (byte === START_MARKER) {
        escaped.push(ESCAPE_MARKER, 0x62);
      } else if (byte === END_MARKER) {
        escaped.push(ESCAPE_MARKER, 0x63);
      } else if (byte === ESCAPE_MARKER) {
        escaped.push(ESCAPE_MARKER, 0x64);
      } else {
        escaped.push(byte);
      }
    }

    return Buffer.from(escaped);
  }

  /**
   * Unescape special byte sequences in data
   */
  /**
   * Unescape special byte sequences in data
   * CRITICAL: C++ implementation applies & 0xDF to ALL bytes after 0x44 escape marker,
   * not just the known escape sequences (0x62, 0x63, 0x64).
   * This is a bitwise AND operation that masks off bit 5 of the byte.
   * Examples: 0x62 & 0xDF = 0x42, 0x63 & 0xDF = 0x43, 0x64 & 0xDF = 0x44
   * If encrypted data contains 0x44 followed by any other byte, the & 0xDF is applied.
   * For unknown escape sequences like [0x44, 0x65], output is [0x45] (0x65 & 0xDF).
   */
  private unescape(data: Buffer): Buffer {
    const unescaped: number[] = [];

    for (let i = 0; i < data.length; i++) {
      if (data[i] === ESCAPE_MARKER && i + 1 < data.length) {
        const next = data[i + 1];
        // Apply & 0xDF mask to next byte, matching C++ exactly
        // This converts 0x62→0x42, 0x63→0x43, 0x64→0x44, 0x65→0x45, etc.
        unescaped.push(next & 0xdf);
        i++; // Skip the next byte as it's part of escape sequence
      } else {
        unescaped.push(data[i]);
      }
    }

    return Buffer.from(unescaped);
  }
}
