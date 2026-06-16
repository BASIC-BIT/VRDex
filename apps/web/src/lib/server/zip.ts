type ZipEntry = {
  name: string;
  body: Uint8Array;
};

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;

  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }

  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16LE(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32LE(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
  buffer[offset + 3] = (value >>> 24) & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
}

function safeZipName(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/") || "asset";
}

export function createStoredZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(safeZipName(entry.name));
    const checksum = crc32(entry.body);
    const localHeader = new Uint8Array(30 + name.byteLength);
    const centralHeader = new Uint8Array(46 + name.byteLength);

    writeUInt32LE(localHeader, 0, 0x04034b50);
    writeUInt16LE(localHeader, 4, 20);
    writeUInt16LE(localHeader, 6, 0);
    writeUInt16LE(localHeader, 8, 0);
    writeUInt16LE(localHeader, 10, 0);
    writeUInt16LE(localHeader, 12, 0);
    writeUInt32LE(localHeader, 14, checksum);
    writeUInt32LE(localHeader, 18, entry.body.byteLength);
    writeUInt32LE(localHeader, 22, entry.body.byteLength);
    writeUInt16LE(localHeader, 26, name.byteLength);
    writeUInt16LE(localHeader, 28, 0);
    localHeader.set(name, 30);

    writeUInt32LE(centralHeader, 0, 0x02014b50);
    writeUInt16LE(centralHeader, 4, 20);
    writeUInt16LE(centralHeader, 6, 20);
    writeUInt16LE(centralHeader, 8, 0);
    writeUInt16LE(centralHeader, 10, 0);
    writeUInt16LE(centralHeader, 12, 0);
    writeUInt16LE(centralHeader, 14, 0);
    writeUInt32LE(centralHeader, 16, checksum);
    writeUInt32LE(centralHeader, 20, entry.body.byteLength);
    writeUInt32LE(centralHeader, 24, entry.body.byteLength);
    writeUInt16LE(centralHeader, 28, name.byteLength);
    writeUInt16LE(centralHeader, 30, 0);
    writeUInt16LE(centralHeader, 32, 0);
    writeUInt16LE(centralHeader, 34, 0);
    writeUInt16LE(centralHeader, 36, 0);
    writeUInt32LE(centralHeader, 38, 0);
    writeUInt32LE(centralHeader, 42, offset);
    centralHeader.set(name, 46);

    localParts.push(localHeader, entry.body);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + entry.body.byteLength;
  }

  const centralDirectory = concat(centralParts);
  const end = new Uint8Array(22);

  writeUInt32LE(end, 0, 0x06054b50);
  writeUInt16LE(end, 4, 0);
  writeUInt16LE(end, 6, 0);
  writeUInt16LE(end, 8, entries.length);
  writeUInt16LE(end, 10, entries.length);
  writeUInt32LE(end, 12, centralDirectory.byteLength);
  writeUInt32LE(end, 16, offset);
  writeUInt16LE(end, 20, 0);

  return concat([...localParts, centralDirectory, end]);
}
