import { SyncStatus } from '../models/status';
import { PATHS, DEFAULT_SYNC_STATUS } from '../utils/config';
import { readJsonFile, writeJsonFile } from '../utils/fileUtils';
import { createLogger } from '../utils/logger';

const logger = createLogger('Status-Manager');

// In-memory cache of status
let syncStatus: SyncStatus = { ...DEFAULT_SYNC_STATUS };

/**
 * Loads sync status from file
 * @returns The loaded sync status
 */
export async function loadSyncStatus(): Promise<SyncStatus> {
    logger.info('Loading sync status from file'); 
    
    try {
        const loadedStatus = await readJsonFile<SyncStatus>(PATHS.STATUS_FILE, DEFAULT_SYNC_STATUS);
        
        // Update status with loaded values
        syncStatus = { ...DEFAULT_SYNC_STATUS, ...loadedStatus };
        
        logger.success('Sync status loaded from file');
        return syncStatus;
    } catch (error) {
        logger.error('Error loading sync status from file', error);
        return { ...DEFAULT_SYNC_STATUS };
    }
}

/**
 * Saves current sync status to file
 * @returns true if successful, false otherwise
 */
export async function saveSyncStatus(): Promise<boolean> {
    logger.info('Saving sync status to file');
    
    try {
        const success = await writeJsonFile(PATHS.STATUS_FILE, syncStatus, true);
        
        if (success) {
            logger.success('Sync status successfully saved to file');
        } else {
            logger.error('Failed to save sync status to file');
        }
        
        return success;
    } catch (error) {
        logger.error('Error saving sync status to file', error);
        return false;
    }
}

/**
 * Gets the current sync status
 * @returns Copy of the current sync status
 */
export function getSyncStatus(): SyncStatus {
    return { ...syncStatus };
}

/**
 * Updates sync status with new values and optionally saves to file
 * @param updatedStatus Partial status object with values to update
 * @param saveToFile Whether to save the updated status to file
 * @returns true if successful, false otherwise
 */
export async function updateSyncStatus(
    updatedStatus: Partial<SyncStatus>, 
    saveToFile = true
): Promise<boolean> {
    logger.info('Updating sync status');
    
    try {
        // Update status
        syncStatus = {
            ...syncStatus,
            ...updatedStatus
        };
        
        // Save to file if requested
        if (saveToFile) {
            return await saveSyncStatus();
        }
        
        return true;
    } catch (error) {
        logger.error('Error updating sync status', error);
        return false;
    }
}

/**
 * Sets the sync running flag and updates lastCheck
 * @param running Whether a sync is currently running
 * @returns The updated sync status
 */
export async function setSyncRunning(running: boolean): Promise<SyncStatus> {
    const updates: Partial<SyncStatus> = { 
        running,
        lastCheck: new Date().toISOString()
    };
    
    // If sync is completing, update lastSync too
    if (!running) {
        updates.lastSync = new Date().toISOString();
    }
    
    await updateSyncStatus(updates);
    return syncStatus;
}

/**
 * Increments the shared characters count
 * @param count Number to increment by (default: 1)
 * @returns The updated sync status
 */
export async function incrementSharedCharacters(count = 1): Promise<SyncStatus> {
    const newCount = syncStatus.sharedCharacters + count;
    await updateSyncStatus({ sharedCharacters: newCount });
    return syncStatus;
} 