/**
 * Utility functions for working with PNG files, specifically for extracting
 * character data from SillyTavern character cards.
 */

import chalk from 'chalk';

const MODULE = '[PNG-Utils]';

export interface MetadataChunk {
    keyword: string;
    text: string;
}

export interface CharacterData {
    name?: string;
    char_name?: string;
    description?: string;
    personality?: string;
    tags?: string[];
    version?: number;
    [key: string]: any;
}

/**
 * Extracts text chunks from a PNG file buffer.
 * This is a custom implementation that doesn't rely on external libraries.
 * It searches for tEXt chunks in the PNG file format and extracts their contents.
 * 
 * @param buffer The PNG file as a buffer
 * @returns Array of metadata chunks with keyword and text properties
 */
export function extractPngMetadata(buffer: Buffer): MetadataChunk[] {
    try {
        const chunks: MetadataChunk[] = [];
        
        // Check PNG signature
        const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        if (!buffer.slice(0, 8).equals(pngSignature)) {
            console.error(chalk.red(MODULE), 'Not a valid PNG file');
            return [];
        }
        
        // Start after the signature
        let pos = 8;
        
        // Process chunks until we reach the end
        while (pos < buffer.length) {
            // Check if we have enough data for the chunk length and type
            if (pos + 8 > buffer.length) {
                break;
            }
            
            // Read chunk length (4 bytes)
            const length = buffer.readUInt32BE(pos);
            pos += 4;
            
            // Read chunk type (4 bytes)
            const type = buffer.slice(pos, pos + 4).toString('ascii');
            pos += 4;
            
            // Check if we have enough data for the chunk data
            if (pos + length > buffer.length) {
                break;
            }
            
            // If it's a tEXt chunk, extract the metadata
            if (type === 'tEXt') {
                let nullPos = pos;
                while (nullPos < pos + length && buffer[nullPos] !== 0) {
                    nullPos++;
                }
                
                if (nullPos < pos + length) {
                    const keyword = buffer.slice(pos, nullPos).toString('ascii');
                    const text = buffer.slice(nullPos + 1, pos + length).toString('ascii');
                    
                    chunks.push({ keyword, text });
                }
            }
            
            // Skip to the next chunk (data + CRC)
            pos += length + 4;
        }
        
        return chunks;
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error extracting PNG metadata:', error);
        return [];
    }
}

/**
 * Extracts the version number from character metadata
 * @param data The character data object
 * @returns The version number as a float, defaults to 1.0 if not found
 */
function extractVersionNumber(data: any): number {
    try {
        // Look for the version number in all possible locations
        let versionValue = null;
        let versionSource = null;
        
        // Check all possible locations where version might be stored
        // This is ordered by priority - earlier checks take precedence
        
        // Try nested data.data properties (common in v3 cards)
        if (data.data?.character_version !== undefined) {
            versionValue = data.data.character_version;
            versionSource = 'data.data.character_version';
        } 
        // Try direct properties
        else if (data.character_version !== undefined) {
            versionValue = data.character_version;
            versionSource = 'data.character_version';
        } else if (data.version !== undefined) {
            versionValue = data.version;
            versionSource = 'data.version';
        }
        // Then try nested properties in metadata
        else if (data.metadata?.character_version !== undefined) {
            versionValue = data.metadata.character_version;
            versionSource = 'data.metadata.character_version';
        } else if (data.metadata?.version !== undefined) {
            versionValue = data.metadata.version;
            versionSource = 'data.metadata.version';
        }
        // Then try nested properties in creator
        else if (data.creator?.character_version !== undefined) {
            versionValue = data.creator.character_version;
            versionSource = 'data.creator.character_version';
        } else if (data.creator?.version !== undefined) {
            versionValue = data.creator.version;
            versionSource = 'data.creator.version';
        }
        // Default if nothing found
        else {
            versionValue = "1.0";
            versionSource = 'default';
        }
        
        // Ensure we're working with a string before parsing
        const versionString = String(versionValue);
        
        // Convert to float
        const versionFloat = parseFloat(versionString);
        
        // Return 1.0 if conversion fails or version is invalid
        if (isNaN(versionFloat)) {
            console.log(chalk.yellow(MODULE), 'Version parsing failed, defaulting to 1.0');
            return 1.0;
        }
        
        return versionFloat;
    } catch (error) {
        console.log(chalk.yellow(MODULE), 'Error extracting version number, defaulting to 1.0');
        return 1.0;
    }
}

/**
 * Attempts to extract character data from a PNG file.
 * This function checks multiple known metadata fields where character data might be stored.
 * 
 * @param buffer The PNG file as a buffer
 * @returns The parsed character data object or null if not found
 */
export function extractCharacterData(buffer: Buffer): CharacterData | null {
    try {
        // Try using the custom PNG metadata extractor
        const metadata = extractPngMetadata(buffer);
        
        // Known field names for character data in SillyTavern cards
        const fieldNames = ['chara', 'character', 'tavern', 'card', 'data'];
        
        // Check each possible field
        for (const fieldName of fieldNames) {
            const field = metadata.find(chunk => chunk.keyword === fieldName);
            
            if (field && field.text) {
                try {
                    // For base64-encoded fields, decode first
                    if (isBase64(field.text)) {
                        const jsonStr = Buffer.from(field.text, 'base64').toString('utf8');
                        const data = JSON.parse(jsonStr);
                        data.version = extractVersionNumber(data);
                        return data;
                    } else {
                        // For directly JSON-encoded fields
                        const data = JSON.parse(field.text);
                        data.version = extractVersionNumber(data);
                        return data;
                    }
                } catch (jsonError) {
                    console.error(chalk.yellow(MODULE), `Error parsing JSON from ${fieldName} field:`, jsonError);
                    // Continue to the next field
                }
            }
        }
        
        // If we couldn't find any valid character data, try a different approach
        // Some cards store data with a specific structure
        // Look for chunks with longer text that might contain base64-encoded JSON
        for (const chunk of metadata) {
            if (chunk.text.length > 100 && isBase64(chunk.text)) {
                try {
                    const jsonStr = Buffer.from(chunk.text, 'base64').toString('utf8');
                    const data = JSON.parse(jsonStr);
                    
                    // Check if it looks like character data (has common fields)
                    if (data.name || data.char_name || data.description || data.personality) {
                        data.version = extractVersionNumber(data);
                        return data;
                    }
                } catch (error) {
                    // Ignore parsing errors for this attempt
                }
            }
        }
        
        console.log(chalk.yellow(MODULE), 'No character data found in PNG metadata');
        return null;
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error extracting character data:', error);
        return null;
    }
}

/**
 * Helper function to check if a string is likely base64-encoded.
 * 
 * @param str The string to check
 * @returns True if the string appears to be base64-encoded
 */
function isBase64(str: string): boolean {
    // Base64 strings are typically longer and only contain specific characters
    if (str.length < 10) return false;
    
    // Check if the string consists only of base64 characters
    return /^[A-Za-z0-9+/]*={0,2}$/.test(str);
} 