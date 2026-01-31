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

export function readPacket(data: Buffer): [Buffer | undefined, Buffer] {
  // Extract packets: start with 0x42, end with 0x43
  const start = data.indexOf(START_MARKER);
  const end = data.indexOf(END_MARKER, start + 1);
  if (start === -1 || end === -1 || end <= start) {
    return [undefined, data];
  }

  return [data.subarray(start + 1, end), data.subarray(end + 1)];
}

export function unescapePacket(packet: Buffer): Buffer<ArrayBuffer> {
  const unescaped: number[] = [];
  for (let index = 0; index < packet.length; index++) {
    if (packet[index] === 0x44 && index + 1 < packet.length) {
      if (packet[index + 1] === 0x62) {
        unescaped.push(START_MARKER);
        index++;
      } else if (packet[index + 1] === 0x63) {
        unescaped.push(END_MARKER);
        index++;
      } else if (packet[index + 1] === 0x64) {
        unescaped.push(ESCAPE_MARKER);
        index++;
      } else {
        unescaped.push(packet[index]);
      }
    } else {
      unescaped.push(packet[index]);
    }
  }

  return Buffer.from(unescaped);
}

export function escapePacket(packet: Buffer): Buffer<ArrayBuffer> {
  const escaped: number[] = [];
  for (const element of packet) {
    switch (element) {
      case START_MARKER: {
        escaped.push(ESCAPE_MARKER, 0x62);

        break;
      }
      case END_MARKER: {
        escaped.push(ESCAPE_MARKER, 0x63);

        break;
      }
      case ESCAPE_MARKER: {
        escaped.push(ESCAPE_MARKER, 0x64);

        break;
      }
      default: {
        escaped.push(element);
      }
    }
  }
  return Buffer.from(escaped);
}
