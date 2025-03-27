import * as path from 'path';

/**
 * Application configuration constants
 */

// Base directory for data storage
export const DATA_DIR = process.env.DATA_DIR || './data';

// File paths
export const PATHS = {
    // Settings file
    SETTINGS_FILE: path.join(DATA_DIR, 'character-distributor-settings.json'),
    
    // Status file
    STATUS_FILE: path.join(DATA_DIR, 'character-distributor-status.json'),
    
    // Auth token file
    TOKEN_FILE: path.join(DATA_DIR, 'character-distributor-token.json'),
    
    // Temporary cache directory for Dropbox file comparisons
    TEMP_CACHE_DIR: path.join(DATA_DIR, 'temp-cache')
};

// Module identification prefixes for logging
export const MODULE_NAMES = {
    MAIN: 'Character-Distributor',
    DROPBOX: 'Character-Distributor-Dropbox',
    PNG: 'PNG-Utils',
    SETTINGS: 'Settings-Manager',
    STATUS: 'Status-Manager',
    SYNC: 'Sync-Service'
};

// Default settings
export const DEFAULT_SETTINGS = {
    dropboxAppKey: '',
    dropboxAppSecret: '',
    autoSync: true,
    syncInterval: 1800, // 30 minutes in seconds
    excludeTags: ['Private']
};

// Default sync status
export const DEFAULT_SYNC_STATUS = {
    running: false,
    lastSync: '',
    lastCheck: '',
    sharedCharacters: 0
};

// Character card file extensions
export const CHARACTER_FILE_EXTENSIONS = ['.png', '.json']; 