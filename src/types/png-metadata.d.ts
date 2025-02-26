declare module 'png-metadata' {
    export interface PNGMetadataChunk {
        keyword: string;
        text: string;
    }

    export function readMetadata(buffer: Buffer): PNGMetadataChunk[];
    export function writeMetadata(buffer: Buffer, chunks: PNGMetadataChunk[]): Buffer;
    export function removeMetadata(buffer: Buffer, keyword: string): Buffer;
    
    // Add CommonJS exports
    const _default: {
        readMetadata: typeof readMetadata;
        writeMetadata: typeof writeMetadata;
        removeMetadata: typeof removeMetadata;
    };
    export default _default;
} 