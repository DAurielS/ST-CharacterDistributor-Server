declare module 'png-metadata' {
    export interface PNGMetadataChunk {
        keyword: string;
        text: string;
    }

    export function readMetadata(buffer: Buffer): PNGMetadataChunk[];
    export function writeMetadata(buffer: Buffer, chunks: PNGMetadataChunk[]): Buffer;
    export function removeMetadata(buffer: Buffer, keyword: string): Buffer;
} 