export class FileCheckError extends Error {}
export function inspectGeneratedFile(format: string, bytes: Uint8Array, expect?: {width?: number; height?: number}): Promise<{passed: true; summary: string; details: Record<string, number>}>;
