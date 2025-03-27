import { Settings } from '../models/settings';
import { PATHS, DEFAULT_SETTINGS } from '../utils/config';
import { readJsonFile, writeJsonFile } from '../utils/fileUtils';
import { createLogger } from '../utils/logger';

const logger = createLogger('Settings-Manager');

// In-memory cache of settings
let settings: Settings = { ...DEFAULT_SETTINGS };

/**
 * Loads settings from file
 * @returns The loaded settings
 */
export async function loadSettings(): Promise<Settings> {
    logger.info('Loading settings from file');
    
    try {
        const loadedSettings = await readJsonFile<Settings>(PATHS.SETTINGS_FILE, DEFAULT_SETTINGS);
        
        // Save original settings for comparison
        const originalSettings = { ...settings };
        
        // Update settings with loaded values
        settings = { ...DEFAULT_SETTINGS, ...loadedSettings };
        
        // Compare original and new settings
        const changedKeys = Object.keys(settings).filter(key => 
            JSON.stringify(settings[key as keyof Settings]) !== 
            JSON.stringify(originalSettings[key as keyof Settings])
        );
        
        if (changedKeys.length > 0) {
            logger.success(`Changed settings keys: ${changedKeys.join(', ')}`);
        } else {
            logger.warn('No settings keys were changed after loading from file');
        }
        
        logger.success('Settings loaded from file');
        logger.debug('App Key configured:', !!settings.dropboxAppKey, 'length:', settings.dropboxAppKey?.length || 0);
        logger.debug('App Secret configured:', !!settings.dropboxAppSecret, 'length:', settings.dropboxAppSecret?.length || 0);
        
        return settings;
    } catch (error) {
        logger.error('Error loading settings from file', error);
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Saves current settings to file
 * @returns true if successful, false otherwise
 */
export async function saveSettings(): Promise<boolean> {
    logger.info('Saving settings to file');
    
    try {
        const success = await writeJsonFile(PATHS.SETTINGS_FILE, settings, true);
        
        if (success) {
            logger.success('Settings successfully saved to file');
        } else {
            logger.error('Failed to save settings to file');
        }
        
        return success;
    } catch (error) {
        logger.error('Error saving settings to file', error);
        return false;
    }
}

/**
 * Gets the current settings
 * @returns Copy of the current settings
 */
export function getSettings(): Settings {
    return { ...settings };
}

/**
 * Updates settings with new values and optionally saves to file
 * @param updatedSettings Partial settings object with values to update
 * @param saveToFile Whether to save the updated settings to file
 * @returns true if successful, false otherwise
 */
export async function updateSettings(
    updatedSettings: Partial<Settings>, 
    saveToFile = true
): Promise<boolean> {
    logger.info('Updating settings');
    
    try {
        // Update settings
        settings = {
            ...settings,
            ...updatedSettings
        };
        
        // Save to file if requested
        if (saveToFile) {
            return await saveSettings();
        }
        
        return true;
    } catch (error) {
        logger.error('Error updating settings', error);
        return false;
    }
} 