import chalk from 'chalk';
import { Router, Request, Response } from 'express';
import { setupApiRoutes } from './api/routes';
import { initializeDropbox, performSync as runSync, generateShareLink as createShareLink, checkDropboxAuth, restoreDropboxClient, clearAuthToken, validateDropboxCredentials } from './dropbox/client';
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import axios from 'axios';
// import { readMetadata } from 'png-metadata';
// Import our custom PNG utilities that actually work
import { extractPngMetadata, extractCharacterData } from './utils/pngUtils';

const MODULE = '[Character-Distributor]';

// Define settings file path
const dataDir = process.env.DATA_DIR || './data';
const settingsFilePath = path.join(dataDir, 'character-distributor-settings.json');
const statusFilePath = path.join(dataDir, 'character-distributor-status.json');

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

// Define the sync status interface
interface SyncStatus {
    running: boolean;
    lastSync: string;
    lastCheck: string;
    sharedCharacters: number;
}

// Status tracking
let syncStatus: SyncStatus = {
    running: false,
    lastSync: '',  // Empty string instead of null
    lastCheck: '',  // Empty string instead of null
    sharedCharacters: 0
};

let syncIntervalId: ReturnType<typeof setInterval> | null = null;

// Define character interface
interface Character {
    name: string;
    avatar_url: string;
    filename?: string;
    tags?: string[];
    excluded_by_tag?: string;
}

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
    
    // Add JSON body parser middleware to handle incoming JSON payloads
    router.use(express.json());
    console.log(chalk.green(MODULE), 'Added JSON body parser middleware');
    
    // Load settings and status from files
    await loadSettingsFromFile();
    await loadSyncStatus();
    
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
    
    // Add character version inspection endpoint
    router.get('/inspect/:characterFilename', async (req: Request, res: Response) => {
        console.log(chalk.blue(MODULE), `Inspecting character file ${req.params.characterFilename}`);
        
        try {
            // Use SillyTavern's character directory
            const sillyTavernDir = process.env.SILLY_TAVERN_DIR || '.';
            const charsPath = process.env.CHARACTERS_DIR || path.join(sillyTavernDir, 'data', 'default-user', 'characters');
            
            // Check if file exists
            const filePath = path.join(charsPath, req.params.characterFilename);
            if (!fs.existsSync(filePath)) {
                console.log(chalk.red(MODULE), `File not found: ${filePath}`);
                return res.status(404).json({ error: 'Character file not found' });
            }
            
            // Read the file
            const fileContent = fs.readFileSync(filePath);
            console.log(chalk.blue(MODULE), `Read character file: ${req.params.characterFilename}`);
            
            // Attempt to extract data
            let characterData: any = null;
            let extractionMethod = '';
            let extractionError: Error | null = null;
            
            try {
                // Try using character data extractor
                characterData = extractCharacterData(fileContent);
                if (characterData) {
                    extractionMethod = 'png';
                }
            } catch (extractErr) {
                const err = extractErr as Error;
                extractionError = err;
                console.log(chalk.yellow(MODULE), `PNG extraction failed: ${err.message}`);
            }
            
            // If PNG extraction failed, try JSON parsing
            if (!characterData) {
                try {
                    characterData = JSON.parse(fileContent.toString('utf8'));
                    extractionMethod = 'json';
                } catch (err) {
                    console.log(chalk.yellow(MODULE), `JSON parsing failed: ${(err as Error).message}`);
                    
                    if (extractionError) {
                        return res.status(400).json({ 
                            error: `Could not extract character data: ${extractionError.message}` 
                        });
                    } else {
                        return res.status(400).json({ 
                            error: `Could not parse JSON: ${(err as Error).message}` 
                        });
                    }
                }
            }
            
            if (!characterData) {
                return res.status(400).json({ error: 'Could not extract character data' });
            }
            
            // Check where version information is found
            let versionInfo = {
                detected: false,
                value: null,
                location: '',
                numeric: 0,
                rawValue: null
            };
            
            // Check in data.data.character_version (priority)
            if (characterData.data && 
                characterData.data.data && 
                characterData.data.data.character_version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.data.data.character_version,
                    location: 'data.data.character_version',
                    numeric: Number(characterData.data.data.character_version),
                    rawValue: characterData.data.data.character_version
                };
            }
            // Check character_version
            else if (characterData.character_version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.character_version,
                    location: 'character_version',
                    numeric: Number(characterData.character_version),
                    rawValue: characterData.character_version
                };
            }
            // Check data.character_version
            else if (characterData.data && characterData.data.character_version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.data.character_version,
                    location: 'data.character_version',
                    numeric: Number(characterData.data.character_version),
                    rawValue: characterData.data.character_version
                };
            }
            // Check version
            else if (characterData.version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.version,
                    location: 'version',
                    numeric: Number(characterData.version),
                    rawValue: characterData.version
                };
            }
            // Check data.version
            else if (characterData.data && characterData.data.version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.data.version,
                    location: 'data.version',
                    numeric: Number(characterData.data.version),
                    rawValue: characterData.data.version
                };
            }
            // Check metadata.character_version
            else if (characterData.metadata && characterData.metadata.character_version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.metadata.character_version,
                    location: 'metadata.character_version',
                    numeric: Number(characterData.metadata.character_version),
                    rawValue: characterData.metadata.character_version
                };
            }
            // Check metadata.version
            else if (characterData.metadata && characterData.metadata.version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.metadata.version,
                    location: 'metadata.version',
                    numeric: Number(characterData.metadata.version),
                    rawValue: characterData.metadata.version
                };
            }
            // Check creator.character_version
            else if (characterData.creator && characterData.creator.character_version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.creator.character_version,
                    location: 'creator.character_version',
                    numeric: Number(characterData.creator.character_version),
                    rawValue: characterData.creator.character_version
                };
            }
            // Check creator.version
            else if (characterData.creator && characterData.creator.version !== undefined) {
                versionInfo = {
                    detected: true,
                    value: characterData.creator.version,
                    location: 'creator.version',
                    numeric: Number(characterData.creator.version),
                    rawValue: characterData.creator.version
                };
            }
            
            if (versionInfo.detected) {
                console.log(chalk.green(MODULE), `Found version in ${versionInfo.location}: ${versionInfo.value}`);
            } else {
                console.log(chalk.yellow(MODULE), `No version information detected`);
            }
            
            // Extract basic character information
            const name = characterData.name || (characterData.data && characterData.data.name) || 'Unknown';
            
            // Check data structure
            const dataStructure = {
                hasKeys: Object.keys(characterData).join(', '),
                hasMetadata: characterData.metadata !== undefined,
                hasData: characterData.data !== undefined,
                hasCreator: characterData.creator !== undefined,
                hasTags: characterData.tags !== undefined
            };
            
            return res.json({
                filename: req.params.characterFilename,
                extractionMethod,
                name,
                versionInfo,
                dataStructure
            });
            
        } catch (err) {
            console.error(chalk.red(MODULE), `Error inspecting character file:`, err);
            return res.status(500).json({ error: `Server error: ${(err as Error).message}` });
        }
    });
    
    // Set up auth endpoint
    router.post('/auth', async (req: Request, res: Response) => {
        try {
            console.log(chalk.green(MODULE), 'Auth endpoint hit');
            
            // Add defensive check for undefined req.body
            if (!req.body) {
                console.error(chalk.red(MODULE), 'Auth request body is undefined - check JSON parsing middleware');
                return res.status(400).json({ 
                    success: false, 
                    error: 'Request body is missing or malformed' 
                });
            }
            
            // Log request headers for debugging
            console.log(chalk.blue(MODULE), 'Auth request headers:', JSON.stringify(req.headers));
            
            // Log raw request body type
            console.log(chalk.blue(MODULE), 'Auth raw request body type:', typeof req.body);
            console.log(chalk.blue(MODULE), 'Auth request body keys:', Object.keys(req.body));
            
            // Extract token data with type validation
            let accessToken = req.body.accessToken;
            let tokenType = req.body.tokenType || 'bearer';
            let expiresIn = req.body.expiresIn || 14400;
            let refreshToken = req.body.refreshToken; // Extract refresh token if provided
            
            console.log(chalk.green(MODULE), 'Received Dropbox auth token');
            console.log(chalk.green(MODULE), 'Token length:', accessToken?.length || 0);
            console.log(chalk.green(MODULE), 'Refresh token provided:', !!refreshToken);
            
            // Validate required fields
            if (!accessToken) {
                console.error(chalk.red(MODULE), 'Access token is missing in request');
                return res.status(400).json({
                    success: false,
                    error: 'Access token is missing in request'
                });
            }
            
            if (typeof accessToken !== 'string') {
                console.error(chalk.red(MODULE), 'Access token is not a string');
                return res.status(400).json({
                    success: false,
                    error: 'Access token must be a string'
                });
            }
            
            if (accessToken.length < 10) {
                console.error(chalk.red(MODULE), 'Access token is too short to be valid');
                return res.status(400).json({
                    success: false,
                    error: 'Access token is too short to be valid'
                });
            }
            
            // Check if app key and secret are configured
            if (!settings.dropboxAppKey || !settings.dropboxAppSecret) {
                console.error(chalk.red(MODULE), 'Dropbox App Key or Secret not configured');
                return res.status(400).json({ 
                    success: false, 
                    error: 'Dropbox App Key or Secret not configured. Please configure in settings.' 
                });
            }
            
            // Detailed logging
            console.log(chalk.green(MODULE), 'Attempting to validate Dropbox credentials');
            console.log(chalk.green(MODULE), `App Key configured: ${!!settings.dropboxAppKey}, length: ${settings.dropboxAppKey.length}`);
            console.log(chalk.green(MODULE), `App Secret configured: ${!!settings.dropboxAppSecret}, length: ${settings.dropboxAppSecret.length}`);
            
            try {
                // First pre-validate the credentials
                console.log(chalk.green(MODULE), 'Pre-validating Dropbox credentials...');
                const validationResult = await validateDropboxCredentials(
                    accessToken, 
                    settings.dropboxAppKey, 
                    settings.dropboxAppSecret
                );
                
                if (!validationResult.valid) {
                    console.error(chalk.red(MODULE), 'Credential pre-validation failed:', validationResult.message);
                    return res.status(400).json({
                        success: false,
                        error: validationResult.message || 'Credential validation failed'
                    });
                }
                
                console.log(chalk.green(MODULE), 'Credential pre-validation successful:', validationResult.message);
                
                // If validation passed, proceed with full initialization
                console.log(chalk.green(MODULE), 'Proceeding with full Dropbox client initialization...');
                const success = await initializeDropbox(
                    accessToken, 
                    settings.dropboxAppKey, 
                    settings.dropboxAppSecret,
                    refreshToken, // Pass refresh token if provided
                    expiresIn     // Pass expiration if provided
                );
                
                if (success) {
                    console.log(chalk.green(MODULE), 'Dropbox client initialization successful');
                    res.status(200).json({ success: true });
                } else {
                    console.error(chalk.red(MODULE), 'Failed to initialize Dropbox client - unknown error');
                    res.status(400).json({ 
                        success: false, 
                        error: 'Failed to initialize Dropbox client. See server logs for details.' 
                    });
                }
            } catch (dropboxError: any) {
                // More detailed error logging
                console.error(chalk.red(MODULE), 'Error initializing Dropbox client:');
                console.error(chalk.red(MODULE), 'Error message:', dropboxError.message);
                console.error(chalk.red(MODULE), 'Error details:', dropboxError.error || 'No details available');
                
                // Customize response based on error type
                let errorMessage = 'Dropbox initialization error';
                let statusCode = 500;
                
                if (dropboxError.status === 401) {
                    errorMessage = 'Invalid authorization token';
                    statusCode = 401;
                } else if (dropboxError.status === 400) {
                    errorMessage = 'Bad request to Dropbox API';
                    statusCode = 400;
                } else if (dropboxError.message) {
                    errorMessage = dropboxError.message;
                }
                
                res.status(statusCode).json({ 
                    success: false, 
                    error: errorMessage,
                    details: process.env.NODE_ENV !== 'production' ? 
                        (dropboxError.error || dropboxError.stack || 'No details available') : undefined
                });
            }
        } catch (error: any) {
            console.error(chalk.red(MODULE), 'Error processing auth token:', error);
            console.error(chalk.red(MODULE), 'Error details:', error.message || 'No message');
            console.error(chalk.red(MODULE), 'Error stack:', error.stack || 'No stack trace');
            
            res.status(500).json({ 
                success: false, 
                error: `Internal server error: ${error.message || 'Unknown error'}`
            });
        }
    });
    
    // Set up settings endpoint
    router.post('/settings', async (req: Request, res: Response) => {
        try {
            console.log(chalk.green(MODULE), 'Received new settings');
            
            // Add defensive check for undefined req.body
            if (!req.body) {
                console.error(chalk.red(MODULE), 'Request body is undefined - check JSON parsing middleware');
                return res.status(400).json({ 
                    success: false, 
                    error: 'Request body is missing or malformed' 
                });
            }
            
            // Log request headers for debugging
            console.log(chalk.blue(MODULE), 'Request headers:', JSON.stringify(req.headers));
            
            // Log raw request body and its type
            console.log(chalk.blue(MODULE), 'Raw request body type:', typeof req.body);
            console.log(chalk.green(MODULE), 'Raw request body:', req.body);
            
            const newSettings = req.body as Partial<SettingsType>;
            
            // Log the received settings for debugging
            console.log(chalk.green(MODULE), 'New settings received:', JSON.stringify(newSettings));
            console.log(chalk.green(MODULE), 'Current settings before update:', JSON.stringify(settings));
            
            // Ensure we're extracting the dropbox keys correctly - with defensive checks
            if (newSettings && typeof newSettings === 'object') {
                if (newSettings.hasOwnProperty('dropboxAppKey')) {
                    console.log(chalk.green(MODULE), `Received App Key of length: ${newSettings.dropboxAppKey?.length}`);
                }
                if (newSettings.hasOwnProperty('dropboxAppSecret')) {
                    console.log(chalk.green(MODULE), `Received App Secret of length: ${newSettings.dropboxAppSecret?.length}`);
                }
                
                // Update settings - use a different approach to ensure all properties are updated
                for (const key in newSettings) {
                    if (newSettings.hasOwnProperty(key) && settings.hasOwnProperty(key)) {
                        // Add special handling for string values, especially app credentials
                        if (typeof newSettings[key] === 'string') {
                            // Trim whitespace from app credentials to avoid auth issues
                            if (key === 'dropboxAppKey' || key === 'dropboxAppSecret') {
                                const trimmedValue = (newSettings[key] as string).trim();
                                console.log(chalk.green(MODULE), `Trimmed whitespace from ${key}, original length: ${(newSettings[key] as string).length}, new length: ${trimmedValue.length}`);
                                settings[key] = trimmedValue;
                            } else {
                                settings[key] = newSettings[key] as any;
                            }
                        } else {
                            settings[key] = newSettings[key] as any; // Type assertion needed since we've narrowed that this is a valid key
                        }
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
                
                return res.status(200).json({ success: true });
            } else {
                console.error(chalk.red(MODULE), 'New settings is not a valid object:', newSettings);
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid settings format. Expected JSON object.' 
                });
            }
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error processing settings:', error);
            // Return more detailed error information
            if (error instanceof Error) {
                return res.status(500).json({ 
                    success: false, 
                    error: `Internal server error: ${error.message}`,
                    stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
                });
            }
            return res.status(500).json({ success: false, error: 'Internal server error' });
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
    
    // Set up characters list proxy endpoint
    router.get('/characters', async (req: Request, res: Response) => {
        try {
            console.log(chalk.blue(MODULE), 'Characters list requested');
            
            // Get the excluded tags from query params if available
            const requestExcludeTags = req.query.excludeTags ? 
                (req.query.excludeTags as string).split(',').map(tag => tag.trim()) : 
                [];
                
            // Combine with settings exclude tags
            const excludeTags = [...new Set([...settings.excludeTags, ...requestExcludeTags])];
            
            console.log(chalk.blue(MODULE), `Using exclude tags: ${excludeTags.join(', ')}`);
            
            // Use SillyTavern's character directory
            // SillyTavern typically stores characters in "public/characters" or "data/default-user/characters"
            const sillyTavernDir = process.env.SILLY_TAVERN_DIR || '.';
            const charactersDir = process.env.CHARACTERS_DIR || path.join(sillyTavernDir, 'data', 'default-user', 'characters');
            
            console.log(chalk.blue(MODULE), `Scanning character directory: ${charactersDir}`);
            
            // Initialize character collection
            const characters: Character[] = [];
            let processedCount = 0;
            let successfulExtractCount = 0;
            
            // Only proceed if directory exists
            if (!fs.existsSync(charactersDir)) {
                console.error(chalk.red(MODULE), `Character directory ${charactersDir} not found`);
                return res.status(404).json({ error: 'Character directory not found' });
            }
            
            // List all PNG and JSON files
            const files = fs.readdirSync(charactersDir);
            const characterFiles = files.filter(file => file.endsWith('.png') || file.endsWith('.json'));
            
            console.log(chalk.blue(MODULE), `Found ${characterFiles.length} potential character files`);
            
            // Process each character file
            for (const filename of characterFiles) {
                const filePath = path.join(charactersDir, filename);
                
                // Skip directories
                if (fs.statSync(filePath).isDirectory()) {
                    continue;
                }
                
                processedCount++;
                
                try {
                    // Process differently based on file type
                    if (filename.endsWith('.png')) {
                        // For PNG files, we need to extract the character data
                        const fileContent = fs.readFileSync(filePath);
                        
                        // Character data to extract
                        let characterData: any = null;
                        let extractionMethod = 'custom-extractor';
                        
                        try {
                            // Use only our custom extractor since the library doesn't work
                            characterData = extractCharacterData(fileContent);
                            
                            if (!characterData) {
                                console.log(chalk.yellow(MODULE), `No character data could be extracted from ${filename}`);
                            }
                        } catch (extractionError) {
                            console.error(chalk.red(MODULE), `Error extracting character data from ${filename}:`, extractionError);
                        }
                        
                        if (characterData) {
                            successfulExtractCount++;
                            
                            // Check if the character has any excluded tags
                            let isExcluded = false;
                            let excludedByTag = '';
                            
                            // Extract tags from the character data
                            const characterTags = characterData.tags || [];
                            const tagsList = Array.isArray(characterTags) ? 
                                characterTags : 
                                characterTags.split(',').map((tag: string) => tag.trim());
                            
                            // Check for excluded tags
                            for (const tag of tagsList) {
                                if (excludeTags.includes(tag)) {
                                    isExcluded = true;
                                    excludedByTag = tag;
                                    break;
                                }
                            }
                            
                            // Add to list if not excluded
                            if (!isExcluded) {
                                characters.push({
                                    name: characterData.name || characterData.char_name || path.basename(filename, '.png'),
                                    avatar_url: filename,
                                    filename: filename,
                                    tags: tagsList
                                });
                            } else {
                                console.log(chalk.yellow(MODULE), `Excluding character ${filename} due to tag: ${excludedByTag}`);
                                
                                // We still add it but mark it as excluded for UI feedback
                                characters.push({
                                    name: characterData.name || characterData.char_name || path.basename(filename, '.png'),
                                    avatar_url: filename,
                                    filename: filename,
                                    tags: tagsList,
                                    excluded_by_tag: excludedByTag
                                });
                            }
                            
                            console.log(chalk.green(MODULE), `Successfully processed ${filename} using ${extractionMethod}`);
                        } else {
                            // Add with basic info if extraction failed
                            characters.push({
                                name: path.basename(filename, '.png'),
                                avatar_url: filename,
                                filename: filename,
                                tags: []
                            });
                            
                            console.log(chalk.yellow(MODULE), `Added ${filename} with basic info (extraction failed)`);
                        }
                    } else if (filename.endsWith('.json')) {
                        // For JSON files, parse directly
                        const fileContent = fs.readFileSync(filePath, 'utf8');
                        
                        try {
                            const characterData = JSON.parse(fileContent);
                            
                            // Check if the character has any excluded tags
                            let isExcluded = false;
                            let excludedByTag = '';
                            
                            // Extract tags from the character data
                            const characterTags = characterData.tags || [];
                            const tagsList = Array.isArray(characterTags) ? 
                                characterTags : 
                                characterTags.split(',').map((tag: string) => tag.trim());
                            
                            // Check for excluded tags
                            for (const tag of tagsList) {
                                if (excludeTags.includes(tag)) {
                                    isExcluded = true;
                                    excludedByTag = tag;
                                    break;
                                }
                            }
                            
                            // Add to list if not excluded
                            if (!isExcluded) {
                                characters.push({
                                    name: characterData.name || characterData.char_name || path.basename(filename, '.json'),
                                    avatar_url: filename,
                                    filename: filename,
                                    tags: tagsList
                                });
                            } else {
                                console.log(chalk.yellow(MODULE), `Excluding character ${filename} due to tag: ${excludedByTag}`);
                                
                                // We still add it but mark it as excluded for UI feedback
                                characters.push({
                                    name: characterData.name || characterData.char_name || path.basename(filename, '.json'),
                                    avatar_url: filename,
                                    filename: filename,
                                    tags: tagsList,
                                    excluded_by_tag: excludedByTag
                                });
                            }
                            
                            successfulExtractCount++;
                        } catch (jsonError) {
                            console.error(chalk.red(MODULE), `Error parsing JSON for ${filename}:`, jsonError);
                            
                            // Add with basic info if parsing failed
                            characters.push({
                                name: path.basename(filename, '.json'),
                                avatar_url: filename,
                                filename: filename,
                                tags: []
                            });
                        }
                    }
                } catch (error) {
                    console.error(chalk.red(MODULE), `Error processing character file ${filename}:`, error);
                    
                    // Add with basic info on error
                    characters.push({
                        name: path.basename(filename, path.extname(filename)),
                        avatar_url: filename,
                        filename: filename,
                        tags: []
                    });
                }
            }
            
            console.log(chalk.green(MODULE), `Processed ${processedCount} character files, successfully extracted data from ${successfulExtractCount}`);
            console.log(chalk.green(MODULE), `Returning ${characters.length} characters to client`);
            
            return res.status(200).json(characters);
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error getting character list:', error);
            return res.status(500).json({ error: 'Error getting character list' });
        }
    });
    
    // Set up sync endpoint
    router.post('/sync', async (req: Request, res: Response) => {
        try {
            console.log(chalk.green(MODULE), 'Manual sync requested');
            
            // Check if a sync is already running
            if (syncStatus.running) {
                console.log(chalk.yellow(MODULE), 'Sync already in progress, skipping');
                return res.status(200).json({
                    success: false,
                    message: 'Sync already in progress'
                });
            }
            
            // Update and save status before starting sync
            updateStatus({ 
                running: true,
                lastCheck: new Date().toISOString()
            });
            
            try {
                // Get the list of allowed character files from the request body
                let allowedCharacterFiles: string[] = [];
                
                if (req.body && req.body.allowedCharacterFiles && Array.isArray(req.body.allowedCharacterFiles)) {
                    console.log(chalk.green(MODULE), `Received filtered list of ${req.body.allowedCharacterFiles.length} character files from UI`);
                    allowedCharacterFiles = req.body.allowedCharacterFiles;
                } else {
                    console.log(chalk.yellow(MODULE), 'No filtered character list provided, using server-side filtering only');
                }
                
                // Perform the sync operation using the performSync function
                const result = await performSync(allowedCharacterFiles);
                
                // Update status after successful sync
                updateStatus({
                    running: false,
                    lastSync: new Date().toISOString(),
                    sharedCharacters: result.count || 0
                });
                
                return res.status(200).json({
                    success: result.success,
                    count: result.count,
                    removed: result.removed || 0,
                    total: syncStatus.sharedCharacters,
                    message: result.success ? 
                        `Successfully synced ${result.count} characters` + 
                        (result.removed ? `, removed ${result.removed} characters` : '') 
                        : 'Sync failed'
                });
            } catch (error) {
                console.error(chalk.red(MODULE), 'Error during sync:', error);
                // Update status on error
                updateStatus({ running: false });
                return res.status(500).json({ 
                    success: false, 
                    message: 'Internal server error during sync' 
                });
            }
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error handling sync request:', error);
            // Update status on error
            updateStatus({ running: false });
            return res.status(500).json({ 
                success: false, 
                message: 'Internal server error processing sync request' 
            });
        }
    });
    
    // Set up share endpoint
    router.get('/share/:characterId', async (req: Request, res: Response) => {
        try {
            const characterId = req.params.characterId;
            console.log(chalk.green(MODULE), 'Generating share link for character', characterId);
            
            // Generate share link
            const shareLink = await createShareLink(characterId);
            
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
    
    // Add a test endpoint for debugging request handling
    router.post('/echo', (req: Request, res: Response) => {
        console.log(chalk.blue(MODULE), '=== DEBUG ECHO ENDPOINT ===');
        console.log(chalk.blue(MODULE), 'Request method:', req.method);
        console.log(chalk.blue(MODULE), 'Request path:', req.path);
        console.log(chalk.blue(MODULE), 'Request headers:', JSON.stringify(req.headers));
        console.log(chalk.blue(MODULE), 'Request body exists:', !!req.body);
        console.log(chalk.blue(MODULE), 'Request body type:', typeof req.body);
        
        if (req.body) {
            console.log(chalk.blue(MODULE), 'Request body keys:', Object.keys(req.body));
            console.log(chalk.blue(MODULE), 'Request body:', JSON.stringify(req.body));
        }
        
        return res.status(200).json({
            success: true,
            received: {
                headers: req.headers,
                body: req.body,
                query: req.query,
                method: req.method,
                path: req.path
            },
            message: 'Echo endpoint for debugging'
        });
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
    // Clear any existing interval
    if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
    }

    // Get sync interval from settings (default to 30 minutes)
    const syncInterval = settings.syncInterval || 1800;
    console.log(chalk.green(MODULE), `Setting up sync interval: ${syncInterval} seconds`);

    // Set up the new interval
    syncIntervalId = setInterval(() => {
        // Only trigger sync if auto-sync is enabled
        if (settings.autoSync) {
            console.log(chalk.green(MODULE), 'Auto-sync interval triggered');
            // Note: Actual sync will happen when UI sends filtered characters
            // This just logs that the interval was triggered
            updateStatus({ lastCheck: new Date().toISOString() });
        } else {
            console.log(chalk.yellow(MODULE), 'Auto-sync is disabled, skipping interval sync');
        }
    }, syncInterval * 1000);

    console.log(chalk.green(MODULE), 'Sync interval setup complete');
}

/**
 * Perform a sync operation with the UI extension's filtered character list if available
 */
async function performSync(allowedCharacterFiles: string[] = []) {
    // Use SillyTavern's character directory
    // SillyTavern typically stores characters in "public/characters" or "data/default-user/characters"
    const sillyTavernDir = process.env.SILLY_TAVERN_DIR || '.';
    const charactersDir = process.env.CHARACTERS_DIR || path.join(sillyTavernDir, 'data', 'default-user', 'characters');
    
    console.log(chalk.green(MODULE), `Using characters directory: ${charactersDir}`);
    
    // Call the sync function from Dropbox client
    return await runSync(charactersDir, settings.excludeTags, allowedCharacterFiles);
}

/**
 * Generate share link for a character
 */
async function generateShareLink(characterId: string) {
    return await createShareLink(characterId);
}

// Function to save sync status to file
async function saveSyncStatus() {
    try {
        // Ensure directory exists
        const dir = path.dirname(statusFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Save status to file
        const statusToSave = JSON.stringify(syncStatus, null, 2);
        fs.writeFileSync(statusFilePath, statusToSave, 'utf8');
        console.log(chalk.green(MODULE), 'Sync status saved to file');
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error saving sync status:', error);
    }
}

// Function to load sync status from file
async function loadSyncStatus() {
    try {
        if (fs.existsSync(statusFilePath)) {
            const data = fs.readFileSync(statusFilePath, 'utf8');
            const loadedStatus = JSON.parse(data) as SyncStatus;
            
            // Update status with loaded values, maintaining type safety
            syncStatus = {
                running: false, // Always start with running false
                lastSync: loadedStatus.lastSync || '',
                lastCheck: loadedStatus.lastCheck || '',
                sharedCharacters: loadedStatus.sharedCharacters || 0
            };
            
            console.log(chalk.green(MODULE), 'Loaded sync status from file');
        } else {
            console.log(chalk.yellow(MODULE), 'No saved sync status found, using defaults');
        }
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error loading sync status:', error);
    }
}

// Update the updateStatus function to save status after updates
function updateStatus(updates: Partial<SyncStatus>) {
    // Ensure string fields are never null
    const sanitizedUpdates = { ...updates };
    if ('lastSync' in sanitizedUpdates && sanitizedUpdates.lastSync === null) {
        sanitizedUpdates.lastSync = '';
    }
    if ('lastCheck' in sanitizedUpdates && sanitizedUpdates.lastCheck === null) {
        sanitizedUpdates.lastCheck = '';
    }
    
    // Update status
    syncStatus = { ...syncStatus, ...sanitizedUpdates };
    console.log(chalk.blue(MODULE), 'Updated sync status:', syncStatus);
    
    // Save to file
    saveSyncStatus();
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