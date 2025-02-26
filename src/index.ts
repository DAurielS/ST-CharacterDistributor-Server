import chalk from 'chalk';
import { Router, Request, Response } from 'express';
import { setupApiRoutes } from './api/routes';
import { initializeDropbox, performSync as runSync, generateShareLink as createShareLink, checkDropboxAuth } from './dropbox/client';

const MODULE = '[Character-Distributor]';

let settings = {
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
    router.post('/settings', (req: Request, res: Response) => {
        try {
            const newSettings = req.body;
            console.log(chalk.green(MODULE), 'Received new settings');
            
            // Update settings
            settings = { ...settings, ...newSettings };
            
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