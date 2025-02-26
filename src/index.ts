import chalk from 'chalk';
import { Router, Request, Response } from 'express';
import { setupApiRoutes } from './api/routes';
import { initializeDropbox, performSync as runSync, generateShareLink as createShareLink, checkDropboxAuth, restoreDropboxClient, clearAuthToken } from './dropbox/client';
import * as fs from 'fs';
import * as path from 'path';

const MODULE = '[Character-Distributor]';

// Define settings file path
const dataDir = process.env.DATA_DIR || './data';
const settingsFilePath = path.join(dataDir, 'character-distributor-settings.json');

// Define the settings interface with index signature
interface SettingsType {
    dropboxAppKey: string;
    dropboxAppSecret: string;
    autoSync: boolean;
    syncInterval: number;
    excludeTags: string[];
    [key: string]: string | boolean | number | string[]; // Allow string indexing
}

let settings: SettingsType = {
    dropboxAppKey: '',
    dropboxAppSecret: '',
    autoSync: true,
    syncInterval: 1800, // 30 minutes
    excludeTags: ['Private']
};

let syncStatus = {
    lastSync: '',
    running: false,
    sharedCharacters: 0
};

let syncIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Save settings to file
 */
async function saveSettingsToFile() {
    try {
        // Log what we're about to save
        console.log(chalk.blue(MODULE), 'About to save settings:', JSON.stringify(settings, null, 2));
        
        // Ensure directory exists
        const dir = path.dirname(settingsFilePath);
        console.log(chalk.blue(MODULE), 'Settings directory path:', dir);
        
        if (!fs.existsSync(dir)) {
            console.log(chalk.blue(MODULE), 'Creating directory:', dir);
            try {
                fs.mkdirSync(dir, { recursive: true });
                console.log(chalk.green(MODULE), 'Successfully created directory:', dir);
            } catch (dirError) {
                console.error(chalk.red(MODULE), 'Error creating directory:', dirError);
                throw dirError;
            }
        } else {
            console.log(chalk.blue(MODULE), 'Directory already exists:', dir);
        }
        
        // Check if we can write to the directory
        try {
            fs.accessSync(dir, fs.constants.W_OK);
            console.log(chalk.blue(MODULE), 'Directory is writable:', dir);
        } catch (accessError) {
            console.error(chalk.red(MODULE), 'Directory is not writable:', dir, accessError);
            throw new Error(`Cannot write to directory: ${dir}`);
        }
        
        // Save a copy of what we're writing for debugging
        const settingsToSave = JSON.stringify(settings, null, 2);
        console.log(chalk.blue(MODULE), 'Settings JSON to be saved:', settingsToSave);
        
        // Write settings to file
        try {
            fs.writeFileSync(settingsFilePath, settingsToSave, 'utf8');
            console.log(chalk.green(MODULE), 'Settings successfully saved to file:', settingsFilePath);
            
            // Verify the file was written
            if (fs.existsSync(settingsFilePath)) {
                const savedContent = fs.readFileSync(settingsFilePath, 'utf8');
                console.log(chalk.blue(MODULE), 'Verification - saved file content:', savedContent);
                
                // Check if content matches what we intended to save
                if (savedContent !== settingsToSave) {
                    console.warn(chalk.yellow(MODULE), 'Warning: saved content differs from what we tried to save');
                } else {
                    console.log(chalk.green(MODULE), 'Verification successful: saved content matches what we tried to save');
                }
            } else {
                console.error(chalk.red(MODULE), 'File not found after writing:', settingsFilePath);
            }
        } catch (writeError) {
            console.error(chalk.red(MODULE), 'Error writing settings to file:', writeError);
            throw writeError;
        }
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error in saveSettingsToFile:', error);
        throw error;
    }
}

/**
 * Load settings from file
 */
async function loadSettingsFromFile() {
    try {
        console.log(chalk.blue(MODULE), 'Attempting to load settings from:', settingsFilePath);
        
        if (fs.existsSync(settingsFilePath)) {
            console.log(chalk.blue(MODULE), 'Settings file exists, reading content');
            
            try {
                const data = fs.readFileSync(settingsFilePath, 'utf8');
                console.log(chalk.blue(MODULE), 'Raw file content:', data);
                
                try {
                    const loadedSettings = JSON.parse(data) as Partial<SettingsType>;
                    console.log(chalk.blue(MODULE), 'Parsed settings from file:', JSON.stringify(loadedSettings, null, 2));
                    
                    // Save original settings for comparison
                    const originalSettings = { ...settings };
                    console.log(chalk.blue(MODULE), 'Original settings before merge:', JSON.stringify(originalSettings, null, 2));
                    
                    // Update settings with loaded values
                    Object.keys(loadedSettings).forEach(key => {
                        if (settings.hasOwnProperty(key) && loadedSettings[key] !== undefined) {
                            settings[key] = loadedSettings[key] as typeof key; // Type assertion to ensure compatibility
                        }
                    });
                    console.log(chalk.green(MODULE), 'Settings after merge:', JSON.stringify(settings, null, 2));
                    
                    // Compare original and new settings
                    let changedKeys = [];
                    for (const key in settings) {
                        if (JSON.stringify(settings[key]) !== JSON.stringify(originalSettings[key])) {
                            changedKeys.push(key);
                        }
                    }
                    
                    if (changedKeys.length > 0) {
                        console.log(chalk.green(MODULE), 'Changed settings keys:', changedKeys.join(', '));
                    } else {
                        console.warn(chalk.yellow(MODULE), 'No settings keys were changed after loading from file');
                    }
                    
                    console.log(chalk.green(MODULE), 'Settings loaded from file:', settingsFilePath);
                    console.log(chalk.green(MODULE), 'App Key configured:', !!settings.dropboxAppKey, 'length:', settings.dropboxAppKey?.length || 0);
                    console.log(chalk.green(MODULE), 'App Secret configured:', !!settings.dropboxAppSecret, 'length:', settings.dropboxAppSecret?.length || 0);
                } catch (parseError) {
                    console.error(chalk.red(MODULE), 'Error parsing settings file:', parseError);
                    console.error(chalk.red(MODULE), 'Invalid JSON in settings file');
                    throw parseError;
                }
            } catch (readError) {
                console.error(chalk.red(MODULE), 'Error reading settings file:', readError);
                throw readError;
            }
        } else {
            console.log(chalk.yellow(MODULE), 'Settings file not found, using defaults:', settingsFilePath);
            console.log(chalk.yellow(MODULE), 'Default settings:', JSON.stringify(settings, null, 2));
        }
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error in loadSettingsFromFile:', error);
    }
}

/**
 * Clean up function called when plugin exits
 */
async function exit() {
    console.log(chalk.green(MODULE), 'Plugin shutting down');
    if (syncIntervalId) {
        clearInterval(syncIntervalId);
    }
}

/**
 * Initializes the plugin
 */
async function init(router: Router) {
    console.log(chalk.green(MODULE), 'Plugin loaded!');
    
    // Load settings from file
    await loadSettingsFromFile();
    
    // Try to restore Dropbox client from saved token
    if (settings.dropboxAppKey && settings.dropboxAppSecret) {
        console.log(chalk.green(MODULE), 'Attempting to restore Dropbox authentication...');
        const restored = await restoreDropboxClient(settings.dropboxAppKey, settings.dropboxAppSecret);
        if (restored) {
            console.log(chalk.green(MODULE), 'Successfully restored Dropbox authentication');
        } else {
            console.log(chalk.yellow(MODULE), 'No saved Dropbox authentication found or restoration failed');
        }
    } else {
        console.log(chalk.yellow(MODULE), 'Dropbox App Key or Secret not configured, skipping authentication restoration');
    }
    
    // Set up API routes
    setupApiRoutes(router, settings, syncStatus);
    
    // Add diagnostic endpoint
    router.get('/debug', (req: Request, res: Response) => {
        try {
            // Collect diagnostic information
            const diagnosticInfo = {
                plugin: {
                    running: true,
                    lastSync: syncStatus.lastSync || 'Never',
                    sharedCharacters: syncStatus.sharedCharacters
                },
                settings: {
                    // Only report if keys are configured, not the actual values
                    dropboxAppKeyConfigured: !!settings.dropboxAppKey,
                    dropboxAppSecretConfigured: !!settings.dropboxAppSecret,
                    autoSync: settings.autoSync,
                    syncInterval: settings.syncInterval,
                    excludeTags: settings.excludeTags
                },
                dropbox: {
                    clientInitialized: checkDropboxAuth(),
                    tokenPresent: checkDropboxAuth()
                },
                nodeVersion: process.version,
                serverUptime: process.uptime()
            };
            
            res.status(200).json(diagnosticInfo);
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error generating diagnostic info:', error);
            res.status(500).json({ success: false, error: 'Error generating diagnostic info' });
        }
    });
    
    // Set up auth endpoint
    router.post('/auth', async (req: Request, res: Response) => {
        try {
            const { accessToken, tokenType, expiresIn } = req.body;
            console.log(chalk.green(MODULE), 'Received Dropbox auth token');
            
            // Check if app key and secret are configured
            if (!settings.dropboxAppKey || !settings.dropboxAppSecret) {
                console.error(chalk.red(MODULE), 'Dropbox App Key or Secret not configured');
                return res.status(400).json({ 
                    success: false, 
                    error: 'Dropbox App Key or Secret not configured. Please configure in settings.' 
                });
            }
            
            // Detailed logging
            console.log(chalk.green(MODULE), 'Attempting to initialize Dropbox with provided token');
            console.log(chalk.green(MODULE), `App Key configured: ${!!settings.dropboxAppKey}`);
            console.log(chalk.green(MODULE), `App Secret configured: ${!!settings.dropboxAppSecret}`);
            
            try {
                const success = await initializeDropbox(accessToken, settings.dropboxAppKey, settings.dropboxAppSecret);
                
                if (success) {
                    res.status(200).json({ success: true });
                } else {
                    res.status(400).json({ success: false, error: 'Failed to initialize Dropbox client' });
                }
            } catch (dropboxError: any) {
                // More detailed error logging
                console.error(chalk.red(MODULE), 'Specific error during Dropbox initialization:', dropboxError);
                console.error(chalk.red(MODULE), 'Error message:', dropboxError.message);
                console.error(chalk.red(MODULE), 'Error details:', dropboxError.error || 'No details available');
                
                res.status(500).json({ 
                    success: false, 
                    error: `Dropbox initialization error: ${dropboxError.message || 'Unknown error'}`
                });
            }
        } catch (error: any) {
            console.error(chalk.red(MODULE), 'Error processing auth token:', error);
            console.error(chalk.red(MODULE), 'Error details:', error.message || 'No message');
            res.status(500).json({ 
                success: false, 
                error: `Internal server error: ${error.message || 'Unknown error'}`
            });
        }
    });
    
    // Set up settings endpoint
    router.post('/settings', async (req: Request, res: Response) => {
        try {
            const newSettings = req.body as Partial<SettingsType>;
            console.log(chalk.green(MODULE), 'Received new settings');
            
            // Log the received settings for debugging
            console.log(chalk.green(MODULE), 'New settings received:', JSON.stringify(newSettings));
            console.log(chalk.green(MODULE), 'Current settings before update:', JSON.stringify(settings));
            
            // Ensure we're extracting the dropbox keys correctly
            if (newSettings.hasOwnProperty('dropboxAppKey')) {
                console.log(chalk.green(MODULE), `Received App Key of length: ${newSettings.dropboxAppKey?.length}`);
            }
            if (newSettings.hasOwnProperty('dropboxAppSecret')) {
                console.log(chalk.green(MODULE), `Received App Secret of length: ${newSettings.dropboxAppSecret?.length}`);
            }
            
            // Update settings - use a different approach to ensure all properties are updated
            for (const key in newSettings) {
                if (newSettings.hasOwnProperty(key) && settings.hasOwnProperty(key)) {
                    settings[key] = newSettings[key] as any; // Type assertion needed since we've narrowed that this is a valid key
                }
            }
            
            // Log the updated settings
            console.log(chalk.green(MODULE), 'Settings after update:', JSON.stringify(settings));
            
            // Save settings to file
            await saveSettingsToFile();
            
            // Read back the saved file to verify contents
            try {
                const savedContent = fs.readFileSync(settingsFilePath, 'utf8');
                console.log(chalk.green(MODULE), 'Saved settings file content:', savedContent);
            } catch (readError) {
                console.error(chalk.red(MODULE), 'Error reading back saved settings:', readError);
            }
            
            // Update sync interval if needed
            if (settings.autoSync) {
                setupSyncInterval();
            } else if (syncIntervalId) {
                clearInterval(syncIntervalId);
                syncIntervalId = null;
            }
            
            res.status(200).json({ success: true });
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error processing settings:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    });
    
    // Set up status endpoint
    router.get('/status', (req: Request, res: Response) => {
        try {
            // Get authentication status from dropbox client
            // We access the imported function to check if dropboxClient is initialized
            const isAuthenticated = checkDropboxAuth();
            
            res.status(200).json({
                running: true,
                lastSync: syncStatus.lastSync || 'Never',
                sharedCharacters: syncStatus.sharedCharacters,
                authenticated: isAuthenticated
            });
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error checking status:', error);
            res.status(500).json({ 
                running: true, 
                error: 'Error checking status', 
                authenticated: false 
            });
        }
    });
    
    // Set up sync endpoint
    router.post('/sync', async (req: Request, res: Response) => {
        if (syncStatus.running) {
            return res.status(409).json({ success: false, error: 'Sync already in progress' });
        }
        
        try {
            syncStatus.running = true;
            console.log(chalk.green(MODULE), 'Starting manual sync');
            
            // Call the sync function from Dropbox client
            const result = await performSync();
            
            syncStatus.running = false;
            syncStatus.lastSync = new Date().toLocaleString();
            
            res.status(200).json({
                success: true,
                message: 'Sync completed successfully',
                sharedCharacters: syncStatus.sharedCharacters
            });
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error during sync:', error);
            syncStatus.running = false;
            
            res.status(500).json({
                success: false,
                error: 'Error during synchronization'
            });
        }
    });
    
    // Set up share endpoint
    router.get('/share/:characterId', async (req: Request, res: Response) => {
        try {
            const characterId = req.params.characterId;
            console.log(chalk.green(MODULE), 'Generating share link for character', characterId);
            
            // Generate share link
            const shareLink = await generateShareLink(characterId);
            
            if (shareLink) {
                res.status(200).json({ success: true, shareLink });
            } else {
                res.status(400).json({ success: false, error: 'Failed to generate share link' });
            }
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error generating share link:', error);
            res.status(500).json({ success: false, error: 'Internal server error' });
        }
    });
    
    // Set up logout endpoint
    router.post('/logout', async (req: Request, res: Response) => {
        try {
            console.log(chalk.green(MODULE), 'Logout requested');
            
            // Clear the auth token
            const success = await clearAuthToken();
            
            if (success) {
                res.status(200).json({ success: true });
                console.log(chalk.green(MODULE), 'Successfully logged out from Dropbox');
            } else {
                res.status(500).json({ success: false, error: 'Error during logout' });
                console.error(chalk.red(MODULE), 'Error during logout');
            }
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error during logout:', error);
            res.status(500).json({ success: false, error: 'Error during logout' });
        }
    });
    
    // Setup initial sync interval if auto sync is enabled
    if (settings.autoSync) {
        setupSyncInterval();
    }
}

/**
 * Sets up the sync interval
 */
function setupSyncInterval() {
    if (syncIntervalId) {
        clearInterval(syncIntervalId);
    }
    
    syncIntervalId = setInterval(async () => {
        if (!syncStatus.running) {
            try {
                syncStatus.running = true;
                console.log(chalk.green(MODULE), 'Starting scheduled sync');
                
                await performSync();
                
                syncStatus.lastSync = new Date().toLocaleString();
                syncStatus.running = false;
            } catch (error) {
                console.error(chalk.red(MODULE), 'Error during scheduled sync:', error);
                syncStatus.running = false;
            }
        } else {
            console.log(chalk.yellow(MODULE), 'Skipping scheduled sync because a sync is already in progress');
        }
    }, settings.syncInterval * 1000);
}

/**
 * Perform sync operation
 */
async function performSync() {
    // Call the sync function from Dropbox client
    const charactersDir = process.env.CHARACTERS_DIR || './characters';
    return await runSync(charactersDir, settings.excludeTags);
}

/**
 * Generate share link for a character
 */
async function generateShareLink(characterId: string) {
    return await createShareLink(characterId);
}

export default {
    init,
    exit,
    info: {
        id: 'character-distributor',
        name: 'Character Distributor',
        description: 'Share and discover AI characters through Dropbox integration.',
    },
}; 