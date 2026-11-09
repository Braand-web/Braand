import { detectOfficeMime } from "./office-archive.mjs";

export const OFFICE_MIME_TYPES = Object.freeze({
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});

export const FILE_POLICY = Object.freeze({
  maxFileBytes: 50 * 1024 * 1024,
  legacyDirectUploadBytes: 5 * 1024 * 1024,
  legacyDirectRequestBytes: 6 * 1024 * 1024,
  legacyMaxFilesPerWorkspace: 100,
  legacyTextPreviewChars: 30_000,
  maxDisplayNameChars: 160,
  maxFileSizeLabel: "50 Mio",
  legacyDirectUploadSizeLabel: "5 Mio",
  base64EncodingChunkBytes: 32_768,
  uploadRateWindowMs: 60 * 1000,
  maxUploadsPerUserPerWindow: 20,
  uploadLimitRetentionMs: 24 * 60 * 60 * 1000,
  maxPendingUploadsPerUser: 20,
  maxPendingUploadBytesPerWorkspace: 150 * 1024 * 1024,
  maxUploadBytesPerUserPerWindow: 150 * 1024 * 1024,
  maxPartRequestsPerUserPerWindow: 240,
  uploadRetryAttempts: 4,
  uploadRetryBaseMs: 250,
  uploadFinalizeLeaseMs: 2 * 60 * 1000,
  retentionDeleteBatchSize: 25,
  retentionMessageBatchSize: 100,
  maxFilesPerMessage: 10,
  currentComposerMaxFiles: 10,
  chunkBytes: 8 * 1024 * 1024,
  maxParallelFiles: 3,
  maxParallelChunksPerFile: 3,
  signedUrlTtlMs: 5 * 60 * 1000,
  incompleteUploadTtlMs: 24 * 60 * 60 * 1000,
  softDeleteRetentionMs: 30 * 24 * 60 * 60 * 1000,
  maxImagePixels: 100_000_000,
  maxImageSizeLabel: "100 mégapixels",
  officeMaxExpandedBytes: 200 * 1024 * 1024,
  officeMaxCompressionRatio: 100,
  officeMaxArchiveEntries: 5_000,
  officeMaxXmlPartBytes: 20 * 1024 * 1024,
  officeMaxRenderedChars: 1_000_000,
  officeMaxSheets: 20,
  officeMaxPreviewRowsPerSheet: 2_000,
  officeMaxPreviewColumnsPerSheet: 100,
  officeMaxSlides: 50,
  officeMaxProcessingMs: 30_000,
  officeMaxXmlNodes: 500_000,
  officeMaxDocxBlocks: 2_000,
  officeMaxDocxTableRows: 200,
  officeMaxDocxTableColumns: 50,
  officePreviewWindowRows: 40,
  officePreviewRowHeightPx: 38,
  extractMaxPages: 50,
  extractMaxSlides: 50,
  extractMaxSheets: 20,
  extractMaxRowsPerSheet: 1_000,
  extractMaxColsPerSheet: 50,
  extractMaxCharsPerMessage: 30_000,
  extractTimeoutMs: 30_000,
  extractMemoryBytes: 512 * 1024 * 1024,
  legacyUploadTypes: new Set(["image/png", "image/jpeg", "image/webp", "text/plain"]),
  uploadTypes: new Set([
    "image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain",
    "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "video/mp4", "video/webm",
    OFFICE_MIME_TYPES.docx, OFFICE_MIME_TYPES.xlsx, OFFICE_MIME_TYPES.pptx,
  ]),
  textDeclaredTypes: new Set(["text/plain", "text/markdown", "text/csv", "application/json"]),
  inlineTypes: new Set([
    "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "application/pdf",
    "text/plain", "text/markdown", "text/csv", "application/json",
    "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "video/mp4", "video/webm",
    OFFICE_MIME_TYPES.docx, OFFICE_MIME_TYPES.xlsx, OFFICE_MIME_TYPES.pptx,
  ]),
});

const ascii = bytes => String.fromCharCode(...bytes);
const starts = (bytes, signature) => signature.every((value, index) => bytes[index] === value);
const textMime = bytes => {
  if (!bytes.length || bytes.includes(0)) return null;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (let offset = 0; offset < bytes.length; offset += FILE_POLICY.chunkBytes) {
      decoder.decode(bytes.subarray(offset, Math.min(bytes.length, offset + FILE_POLICY.chunkBytes)), { stream: offset + FILE_POLICY.chunkBytes < bytes.length });
    }
    decoder.decode();
    return "text/plain";
  } catch {
    return null;
  }
};

export function detectFileType(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;
  if (starts(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (starts(bytes, [255, 216, 255])) return "image/jpeg";
  if (ascii(bytes.subarray(0, 4)) === "RIFF" && ascii(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  const head = ascii(bytes.subarray(0, 12));
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (ascii(bytes.subarray(4, 8)) === "ftyp" && /^(avif|avis)$/.test(ascii(bytes.subarray(8, 12)))) return "image/avif";
  if (ascii(bytes.subarray(0, 5)) === "%PDF-") return "application/pdf";
  if (ascii(bytes.subarray(0, 3)) === "ID3" || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(bytes.subarray(0, 4)) === "RIFF" && ascii(bytes.subarray(8, 12)) === "WAVE") return "audio/wav";
  if (starts(bytes, [79, 103, 103, 83])) return "audio/ogg";
  const officeMime = detectOfficeMime(bytes, {
    maxEntries: FILE_POLICY.officeMaxArchiveEntries,
    maxExpandedBytes: FILE_POLICY.officeMaxExpandedBytes,
    maxRatio: FILE_POLICY.officeMaxCompressionRatio,
  });
  if (officeMime) return officeMime;
  if (ascii(bytes.subarray(4, 8)) === "ftyp") {
    const brand = ascii(bytes.subarray(8, 12));
    if (["M4A ", "M4B ", "F4A ", "F4B "].includes(brand)) return "audio/mp4";
    return "video/mp4";
  }
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return textMime(bytes);
}

export function declaredTypeMatches(declaredType, detectedType) {
  const declared = String(declaredType || "").trim().toLowerCase();
  if (!declared || declared === detectedType) return true;
  return (detectedType === "text/plain" && FILE_POLICY.textDeclaredTypes.has(declared)) ||
    Object.values(OFFICE_MIME_TYPES).includes(detectedType) && declared === detectedType;
}

export function imageDimensions(bytes, mime) {
  if (mime === "image/png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/jpeg") {
    let cursor = 2;
    while (cursor + 4 < bytes.length) {
      if (bytes[cursor] !== 0xff) { cursor++; continue; }
      while (bytes[cursor] === 0xff) cursor++;
      const marker = bytes[cursor++];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (cursor + 2 > bytes.length) break;
      const segmentLength = (bytes[cursor] << 8) | bytes[cursor + 1];
      if (segmentLength < 2 || cursor + segmentLength > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && segmentLength >= 7) {
        return { height: (bytes[cursor + 3] << 8) | bytes[cursor + 4], width: (bytes[cursor + 5] << 8) | bytes[cursor + 6] };
      }
      cursor += segmentLength;
    }
    return null;
  }
  if (mime === "image/webp" && bytes.length >= 25) {
    const chunk = ascii(bytes.subarray(12,16));
    if (chunk === "VP8X" && bytes.length >= 30) {
      const read24 = offset => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
      return { width: read24(24) + 1, height: read24(27) + 1 };
    }
    if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: ((bytes[27] << 8) | bytes[26]) & 0x3fff, height: ((bytes[29] << 8) | bytes[28]) & 0x3fff };
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      return { width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10) };
    }
  }
  return null;
}

export function imageWithinPixelLimit(bytes, mime) {
  const size = imageDimensions(bytes, mime);
  return !!size && size.width > 0 && size.height > 0 && size.width * size.height <= FILE_POLICY.maxImagePixels;
}

export function safeFileDto(file) {
  return {
    id: file.id,
    workspaceId: file.workspace_id,
    name: file.status === "deleted" ? "Fichier supprimé" : file.status === "rejected" ? "Fichier indisponible" : file.display_name,
    size: Number(file.size_bytes || 0),
    mime: file.detected_mime || "application/octet-stream",
    status: file.status,
    createdAt: Number(file.created_at || 0),
    updatedAt: Number(file.updated_at || 0),
    deletedAt: file.deleted_at == null ? null : Number(file.deleted_at),
  };
}

export function safeResourceDto(resource) {
  if(resource?.kind==='deliverable'&&['source-project','data-analysis'].includes(resource.data?.format)){
    const data=resource.data,safe=Object.fromEntries(['projectId','title','summary','content','category','sources','format','executionConfirmed'].filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]]));
    if(data.format==='source-project')safe.fileCount=Array.isArray(data.files)?data.files.length:0;
    else if(data.analysis&&typeof data.analysis==='object')safe.analysis=Object.fromEntries(['schema','numberFormat','inputHash','outputHash','inputRows','outputRows','columns','notes'].filter(key=>Object.hasOwn(data.analysis,key)).map(key=>[key,data.analysis[key]]));
    return {...resource,data:safe};
  }
  if (resource?.kind !== "file") return resource;
  const safe = { ...(resource.data || {}) };
  for (const key of ["key", "text", "thumbnailKey", "extractionKey", "storageKey", "sha256"]) delete safe[key];
  return { ...resource, data: safe };
}

export function purgeAttachmentSnapshot(contentJson, attachmentsJson, fileId) {
  let attachments = [];
  let blocks = [];
  try { const parsed = JSON.parse(attachmentsJson || "[]"); if (Array.isArray(parsed)) attachments = parsed.filter(id => typeof id === "string"); } catch {}
  if (!attachments.includes(fileId)) return null;
  try { const parsed = JSON.parse(contentJson || "[]"); if (Array.isArray(parsed)) blocks = parsed; } catch {}
  const userText = blocks.find(block => block && typeof block === "object" && block.type === "text");
  return {
    attachments: JSON.stringify(attachments.filter(id => id !== fileId)),
    content: JSON.stringify(userText ? [userText] : []),
  };
}

function base64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function hmacKey(secret) {
  if (!secret || secret.length < 32) throw new Error("file_signing_secret_unavailable");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueFileToken(secret, claims, now = Date.now()) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ ...claims, exp: now + FILE_POLICY.signedUrlTtlMs })));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifyFileToken(secret, token, expected, now = Date.now()) {
  try {
    const [payload, signature, extra] = String(token || "").split(".");
    if (!payload || !signature || extra) return false;
    const key = await hmacKey(secret);
    if (!(await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), new TextEncoder().encode(payload)))) return false;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return claims.exp > now && claims.fileId === expected.fileId && claims.userId === expected.userId &&
      claims.workspaceId === expected.workspaceId && claims.scope === expected.scope;
  } catch {
    return false;
  }
}

export function contentSecurityHeaders(contentType, disposition, filename) {
  const safeType = FILE_POLICY.inlineTypes.has(contentType) ? contentType : "application/octet-stream";
  const safeDisposition = disposition === "inline" && FILE_POLICY.inlineTypes.has(contentType) ? "inline" : "attachment";
  const encoded = encodeURIComponent(filename || "fichier").replaceAll("'", "%27").replaceAll("(", "%28").replaceAll(")", "%29");
  return {
    "Content-Type": safeType,
    "Content-Disposition": `${safeDisposition}; filename*=UTF-8''${encoded}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, max-age=0, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
