/**
 * Interface for character metadata
 */
export interface Character {
    /**
     * Character name
     */
    name: string;
    
    /**
     * Character avatar URL
     */
    avatar_url: string;
    
    /**
     * Filename of the character file
     */
    filename?: string;
    
    /**
     * Tags associated with the character
     */
    tags?: string[];
    
    /**
     * If excluded by a tag, this field contains the tag that caused exclusion
     */
    excluded_by_tag?: string;
    
    /**
     * Character version number
     */
    version?: number;
}

/**
 * Interface for tracking which characters to sync
 */
export interface SyncCharacterItem {
    /**
     * Character filename (including extension)
     */
    filename: string;
    
    /**
     * Whether this character should be synced
     */
    sync: boolean;
} 