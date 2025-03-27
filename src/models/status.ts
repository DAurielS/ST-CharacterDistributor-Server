/**
 * Interface for tracking synchronization status
 */
export interface SyncStatus {
    /**
     * Whether a sync operation is currently running
     */
    running: boolean;
    
    /**
     * ISO date string of the last successful sync operation
     */
    lastSync: string;
    
    /**
     * ISO date string of the last time characters were checked
     */
    lastCheck: string;
    
    /**
     * Count of characters that have been shared
     */
    sharedCharacters: number;
} 