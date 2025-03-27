/**
 * Settings interface for Character Distributor
 */
export interface Settings {
    /**
     * Dropbox application key
     */
    dropboxAppKey: string;
    
    /**
     * Dropbox application secret
     */
    dropboxAppSecret: string;
    
    /**
     * Whether to automatically sync characters on an interval
     */
    autoSync: boolean;
    
    /**
     * Interval for automatic sync in seconds
     */
    syncInterval: number;
    
    /**
     * Tags that will exclude characters from syncing
     */
    excludeTags: string[];
} 