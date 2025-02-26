import { Dropbox } from 'dropbox';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { nanoid } from 'nanoid';

const MODULE = '[Character-Distributor-Dropbox]';

// Define token file path
const dataDir = process.env.DATA_DIR || './data';
const tokenFilePath = path.join(dataDir, 'character-distributor-token.json');

// Dropbox client instance
let dropboxClient: Dropbox | null = null;

// Access token
let accessToken: string | null = null;

/**
 * Save auth token to file
 */
async function saveAuthTokenToFile(token: string): Promise<void> {
    try {
        // Ensure directory exists
        const dir = path.dirname(tokenFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Write token to file
        fs.writeFileSync(tokenFilePath, JSON.stringify({ accessToken: token }, null, 2), 'utf8');
        console.log(chalk.green(MODULE), 'Auth token saved to file');
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error saving auth token to file:', error);
        throw error;
    }
}

/**
 * Load auth token from file
 */
async function loadAuthTokenFromFile(): Promise<string | null> {
    try {
        if (fs.existsSync(tokenFilePath)) {
            const data = fs.readFileSync(tokenFilePath, 'utf8');
            const tokenData = JSON.parse(data);
            
            if (tokenData.accessToken) {
                console.log(chalk.green(MODULE), 'Auth token loaded from file');
                return tokenData.accessToken;
            }
        }
        return null;
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error loading auth token from file:', error);
        return null;
    }
}

/**
 * Initialize the Dropbox client with the provided access token
 */
export async function initializeDropbox(token: string, appKey: string, appSecret: string): Promise<boolean> {
    try {
        // Log sanitized info
        console.log(chalk.green(MODULE), 'Initializing Dropbox client');
        console.log(chalk.green(MODULE), `Access Token length: ${token?.length || 0}`);
        console.log(chalk.green(MODULE), `App Key length: ${appKey?.length || 0}`);
        console.log(chalk.green(MODULE), `App Secret length: ${appSecret?.length || 0}`);
        
        if (!token) {
            console.error(chalk.red(MODULE), 'Access token is missing or empty');
            return false;
        }
        
        if (!appKey || !appSecret) {
            console.error(chalk.red(MODULE), 'App key or secret is missing or empty');
            return false;
        }
        
        accessToken = token;
        
        // Initialize Dropbox client
        try {
            dropboxClient = new Dropbox({
                accessToken: token,
                clientId: appKey,
                clientSecret: appSecret
            });
            console.log(chalk.green(MODULE), 'Dropbox client instance created');
        } catch (initError: any) {
            console.error(chalk.red(MODULE), 'Error creating Dropbox client instance:', initError?.message || 'Unknown error');
            return false;
        }
        
        // Test the connection by getting account info
        try {
            console.log(chalk.green(MODULE), 'Testing connection by fetching account info...');
            const account = await dropboxClient.usersGetCurrentAccount();
            console.log(chalk.green(MODULE), 'Successfully connected to Dropbox as', account?.result?.name?.display_name || 'Unknown User');
            
            // If we get here without error, save the token for future use
            await saveAuthTokenToFile(token);
        } catch (accountError: any) {
            console.error(chalk.red(MODULE), 'Error fetching account info:', accountError?.message || 'Unknown error');
            console.error(chalk.red(MODULE), 'Error status:', accountError?.status || 'Unknown status');
            console.error(chalk.red(MODULE), 'Error details:', accountError?.error || 'No details available');
            dropboxClient = null;
            accessToken = null;
            return false;
        }
        
        // Create the characters folder if it doesn't exist
        try {
            await ensureCharactersFolder();
            console.log(chalk.green(MODULE), 'Characters folder is ready');
        } catch (folderError: any) {
            console.error(chalk.red(MODULE), 'Error with characters folder:', folderError?.message || 'Unknown error');
            // Don't fail the initialization if folder creation fails
            // We'll try again during sync
        }
        
        return true;
    } catch (error: any) {
        console.error(chalk.red(MODULE), 'Error initializing Dropbox client:', error);
        console.error(chalk.red(MODULE), 'Error message:', error?.message || 'No message');
        console.error(chalk.red(MODULE), 'Error stack:', error?.stack || 'No stack trace');
        dropboxClient = null;
        accessToken = null;
        return false;
    }
}

/**
 * Try to restore Dropbox client from saved token
 */
export async function restoreDropboxClient(appKey: string, appSecret: string): Promise<boolean> {
    try {
        const savedToken = await loadAuthTokenFromFile();
        
        if (savedToken && appKey && appSecret) {
            console.log(chalk.green(MODULE), 'Attempting to restore Dropbox client from saved token');
            return await initializeDropbox(savedToken, appKey, appSecret);
        }
        
        return false;
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error restoring Dropbox client:', error);
        return false;
    }
}

/**
 * Clear the stored auth token
 */
export async function clearAuthToken(): Promise<boolean> {
    try {
        if (fs.existsSync(tokenFilePath)) {
            fs.unlinkSync(tokenFilePath);
            console.log(chalk.green(MODULE), 'Auth token file deleted');
        }
        
        dropboxClient = null;
        accessToken = null;
        return true;
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error clearing auth token:', error);
        return false;
    }
}

/**
 * Ensure the characters folder exists in Dropbox
 */
async function ensureCharactersFolder(): Promise<void> {
    if (!dropboxClient) {
        console.error(chalk.red(MODULE), 'Dropbox client not initialized');
        return;
    }
    
    try {
        // Check if the folder exists
        await dropboxClient.filesGetMetadata({
            path: '/characters'
        });
        
        console.log(chalk.green(MODULE), 'Characters folder exists');
    } catch (error) {
        // If the folder doesn't exist, create it
        try {
            await dropboxClient.filesCreateFolderV2({
                path: '/characters',
                autorename: false
            });
            
            console.log(chalk.green(MODULE), 'Created characters folder');
        } catch (createError) {
            console.error(chalk.red(MODULE), 'Error creating characters folder:', createError);
            throw createError;
        }
    }
}

/**
 * Upload a character to Dropbox
 */
export async function uploadCharacter(characterPath: string, excludeTags: string[]): Promise<boolean> {
    if (!dropboxClient) {
        console.error(chalk.red(MODULE), 'Dropbox client not initialized');
        return false;
    }
    
    try {
        // Read the character file
        const characterContent = fs.readFileSync(characterPath);
        
        // Parse the character data to check tags
        const characterData = JSON.parse(characterContent.toString());
        
        // Check if the character has any excluded tags
        if (characterData.tags) {
            const tags = Array.isArray(characterData.tags) 
                ? characterData.tags 
                : characterData.tags.split(',').map((tag: string) => tag.trim());
                
            if (tags.some((tag: string) => excludeTags.includes(tag))) {
                console.log(chalk.yellow(MODULE), 'Skipping character with excluded tag:', path.basename(characterPath));
                return false;
            }
        }
        
        // Upload the character file
        const filename = path.basename(characterPath);
        const response = await dropboxClient.filesUpload({
            path: `/characters/${filename}`,
            contents: characterContent,
            mode: { '.tag': 'overwrite' },
            autorename: false
        });
        
        console.log(chalk.green(MODULE), 'Uploaded character:', filename);
        return true;
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error uploading character:', error);
        return false;
    }
}

/**
 * Generate a share link for a character
 */
export async function generateShareLink(characterId: string): Promise<string | null> {
    if (!dropboxClient) {
        console.error(chalk.red(MODULE), 'Dropbox client not initialized');
        return null;
    }
    
    try {
        // For now, we just return a dummy link since this is a placeholder
        // In a real implementation, we would get the character file and create a Dropbox shared link
        
        // Example of how to create a shared link in Dropbox:
        /*
        const shareLinkResponse = await dropboxClient.sharingCreateSharedLinkWithSettings({
            path: `/characters/${characterId}`,
            settings: {
                requested_visibility: { '.tag': 'public' }
            }
        });
        
        return shareLinkResponse.result.url;
        */
        
        // For now, we'll return a placeholder link
        const shareId = nanoid(8);
        return `https://dropbox.com/share/${shareId}`;
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error generating share link:', error);
        return null;
    }
}

/**
 * Perform a sync operation to upload local characters to Dropbox
 */
export async function performSync(charactersDir: string, excludeTags: string[]): Promise<{ success: boolean; count: number }> {
    if (!dropboxClient) {
        console.error(chalk.red(MODULE), 'Dropbox client not initialized');
        return { success: false, count: 0 };
    }
    
    try {
        // Ensure characters folder exists
        await ensureCharactersFolder();
        
        // Get list of local character files
        const characterFiles = fs.readdirSync(charactersDir)
            .filter((file: string) => file.endsWith('.json') || file.endsWith('.png'));
        
        console.log(chalk.green(MODULE), `Found ${characterFiles.length} local character files`);
        
        // Upload each character
        let uploadedCount = 0;
        for (const file of characterFiles) {
            const fullPath = path.join(charactersDir, file);
            const uploaded = await uploadCharacter(fullPath, excludeTags);
            
            if (uploaded) {
                uploadedCount++;
            }
        }
        
        console.log(chalk.green(MODULE), `Uploaded ${uploadedCount} characters to Dropbox`);
        
        return { success: true, count: uploadedCount };
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error during sync:', error);
        return { success: false, count: 0 };
    }
}

/**
 * Check if the Dropbox client is authenticated
 */
export function checkDropboxAuth(): boolean {
    return dropboxClient !== null && accessToken !== null;
} 