import { Dropbox } from 'dropbox';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { nanoid } from 'nanoid';
import fetch from 'node-fetch';
// import { readMetadata } from 'png-metadata';
// Use CommonJS require instead of import
const pngMetadata = require('png-metadata');
// Import our custom PNG utilities
import { extractPngMetadata, extractCharacterData } from '../utils/pngUtils';

// Shared module variables
const MODULE = '[Character-Distributor-Dropbox]';

// Define token file path
const dataDir = process.env.DATA_DIR || './data';
const tokenFilePath = path.join(dataDir, 'character-distributor-token.json');

// Dropbox client instance
let dropboxClient: Dropbox | null = null;

// Access token
let accessToken: string | null = null;
let refreshToken: string | null = null;

// Shared characters count - for stats
let sharedCharactersCount = 0;

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
 * Validate token format (basic check)
 */
function validateTokenFormat(token: string): boolean {
    // Basic validation - tokens are usually non-empty strings with some minimum length
    if (!token || typeof token !== 'string' || token.length < 10) {
        console.error(chalk.red(MODULE), 'Token validation failed: token is too short or invalid format');
        return false;
    }
    
    // Check if the token looks like a valid Dropbox token (usually starts with certain prefixes)
    // Dropbox tokens often begin with "sl." for short-lived tokens or "..." for other types
    if (!token.startsWith('sl.') && !token.match(/^[A-Za-z0-9_-]{20,}$/)) {
        console.warn(chalk.yellow(MODULE), 'Token format warning: token does not match expected Dropbox token patterns');
        // We don't fail on this because Dropbox might change their format
    }
    
    return true;
}

/**
 * Pre-validate Dropbox credentials without creating full client
 */
export async function validateDropboxCredentials(token: string, appKey: string, appSecret: string): Promise<{ valid: boolean, message?: string }> {
    try {
        console.log(chalk.blue(MODULE), 'Pre-validating Dropbox credentials');
        
        // Check token format
        if (!validateTokenFormat(token)) {
            return { valid: false, message: 'Token format is invalid' };
        }
        
        // Check app key and secret (basic format validation)
        if (!appKey || typeof appKey !== 'string' || appKey.length < 5) {
            return { valid: false, message: 'App key is invalid or too short' };
        }
        
        if (!appSecret || typeof appSecret !== 'string' || appSecret.length < 5) {
            return { valid: false, message: 'App secret is invalid or too short' };
        }
        
        // Try making a simple request to validate the token
        // This uses a low-level approach without creating the full Dropbox client
        try {
            console.log(chalk.blue(MODULE), 'Testing token validity with basic API request');
            
            const response = await axios({
                method: 'post',
                url: 'https://api.dropboxapi.com/2/users/get_current_account',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                data: null, // Use null as required by Dropbox API, not an empty object
                timeout: 5000 // 5 second timeout
            });
            
            if (response.status === 200 && response.data) {
                console.log(chalk.green(MODULE), 'Token pre-validation successful');
                return { 
                    valid: true, 
                    message: `Valid token for user: ${response.data.name?.display_name || 'Unknown'}` 
                };
            } else {
                console.error(chalk.red(MODULE), 'Unexpected response from validation check', response.status);
                return { valid: false, message: `Unexpected response: ${response.status}` };
            }
        } catch (apiError: any) {
            console.error(chalk.red(MODULE), 'Error validating token with API request:');
            console.error(chalk.red(MODULE), 'Status:', apiError?.response?.status);
            console.error(chalk.red(MODULE), 'Response data:', JSON.stringify(apiError?.response?.data));
            
            if (apiError?.response?.status === 401) {
                return { valid: false, message: 'Invalid or expired access token' };
            } else if (apiError?.response?.status === 400) {
                return { valid: false, message: 'Bad request - token may be malformed' };
            } else {
                return { 
                    valid: false, 
                    message: `API validation error: ${apiError?.message || 'Unknown error'}` 
                };
            }
        }
    } catch (error: any) {
        console.error(chalk.red(MODULE), 'Unexpected error during credential validation:', error);
        return { valid: false, message: `Validation error: ${error.message || 'Unknown error'}` };
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
        console.log(chalk.green(MODULE), `Access Token first/last 5 chars: ${token?.substring(0, 5)}...${token?.slice(-5)}`);
        console.log(chalk.green(MODULE), `App Key length: ${appKey?.length || 0}`);
        console.log(chalk.green(MODULE), `App Secret length: ${appSecret?.length || 0}`);
        
        // Validate inputs
        if (!token) {
            console.error(chalk.red(MODULE), 'Access token is missing or empty');
            return false;
        }
        
        if (!appKey || !appSecret) {
            console.error(chalk.red(MODULE), 'App key or secret is missing or empty');
            return false;
        }
        
        // Basic token format validation
        if (!validateTokenFormat(token)) {
            return false;
        }
        
        accessToken = token;
        
        // Initialize Dropbox client with detailed error handling
        let clientCreationSuccess = false;
        try {
            console.log(chalk.blue(MODULE), 'Creating Dropbox client instance...');
            
            // Clear any existing client instance
            dropboxClient = null;
            
            // Create new client with full configuration
            dropboxClient = new Dropbox({
                accessToken: token,
                clientId: appKey,
                clientSecret: appSecret,
                fetch: fetch
            });
            
            // Check if client was created successfully
            if (!dropboxClient) {
                console.error(chalk.red(MODULE), 'Dropbox client is null after creation');
                return false;
            }
            
            clientCreationSuccess = true;
            console.log(chalk.green(MODULE), 'Dropbox client instance created successfully');
        } catch (initError: any) {
            console.error(chalk.red(MODULE), 'Error creating Dropbox client instance:');
            console.error(chalk.red(MODULE), 'Error message:', initError?.message || 'Unknown error');
            console.error(chalk.red(MODULE), 'Error name:', initError?.name || 'Unknown error type');
            console.error(chalk.red(MODULE), 'Error stack:', initError?.stack || 'No stack available');
            
            if (initError?.isAxiosError) {
                console.error(chalk.red(MODULE), 'Axios error details:');
                console.error(chalk.red(MODULE), 'Status:', initError?.response?.status);
                console.error(chalk.red(MODULE), 'Status text:', initError?.response?.statusText);
                console.error(chalk.red(MODULE), 'Response data:', JSON.stringify(initError?.response?.data));
            }
            
            return false;
        }
        
        // Only test connection if client was created successfully
        if (clientCreationSuccess && dropboxClient) {
            // Test the connection by getting account info with retry mechanism
            let retryAttempt = 0;
            const maxRetries = 2;
            
            while (retryAttempt <= maxRetries) {
                try {
                    console.log(chalk.green(MODULE), `Testing connection (attempt ${retryAttempt + 1}/${maxRetries + 1}) by fetching account info...`);
                    
                    // Make api call with timeout to avoid hanging
                    const account = await Promise.race([
                        dropboxClient.usersGetCurrentAccount(),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('API call timed out after 10 seconds')), 10000)
                        )
                    ]);
                    
                    // If we get here, the call was successful
                    console.log(chalk.green(MODULE), 'Successfully connected to Dropbox as', 
                        account && typeof account === 'object' && 'result' in account ? 
                            (account.result as any)?.name?.display_name || 'Unknown User' : 'Unknown User');
                    
                    // If we get here without error, save the token for future use
                    await saveAuthTokenToFile(token);
                    return true;
                } catch (accountError: any) {
                    console.error(chalk.red(MODULE), `Error fetching account info (attempt ${retryAttempt + 1}/${maxRetries + 1}):`);
                    console.error(chalk.red(MODULE), 'Error message:', accountError?.message || 'Unknown error');
                    console.error(chalk.red(MODULE), 'Error name:', accountError?.name || 'Unknown error type');
                    
                    if (accountError?.status) {
                        console.error(chalk.red(MODULE), 'Error status:', accountError.status);
                    }
                    
                    if (accountError?.error) {
                        console.error(chalk.red(MODULE), 'Error details:', 
                            typeof accountError.error === 'object' ? 
                                JSON.stringify(accountError.error) : accountError.error);
                    }
                    
                    // Check specific error types for Dropbox
                    if (accountError?.status === 401) {
                        console.error(chalk.red(MODULE), 'Authentication failed: Invalid access token');
                        break; // Don't retry on auth failure
                    }
                    
                    if (accountError?.status === 429) {
                        console.error(chalk.red(MODULE), 'Rate limit exceeded. Waiting before retry...');
                        // Wait longer between retries for rate limiting
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                    
                    retryAttempt++;
                    
                    // If we've reached max retries, fail
                    if (retryAttempt > maxRetries) {
                        console.error(chalk.red(MODULE), 'Max retries reached. Giving up.');
                        break;
                    }
                    
                    // Wait before retry (exponential backoff)
                    const waitTime = Math.pow(2, retryAttempt) * 1000;
                    console.log(chalk.yellow(MODULE), `Waiting ${waitTime}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
            
            // If we're here, all retries failed
            console.error(chalk.red(MODULE), 'All attempts to connect to Dropbox failed');
            dropboxClient = null;
            accessToken = null;
            return false;
        }
        
        // If client creation failed, we have nothing more to do
        return false;
    } catch (error: any) {
        // Unexpected top-level error
        console.error(chalk.red(MODULE), 'Unexpected error initializing Dropbox client:');
        console.error(chalk.red(MODULE), 'Error message:', error?.message || 'No message');
        console.error(chalk.red(MODULE), 'Error name:', error?.name || 'Unknown error type');
        console.error(chalk.red(MODULE), 'Error stack:', error?.stack || 'No stack trace');
        
        // Reset state
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
        // Read the character file as a buffer
        const characterContent = fs.readFileSync(characterPath);
        const filename = path.basename(characterPath);
        
        // Check if it's a PNG file (character card)
        if (filename.endsWith('.png')) {
            // For PNG character cards, we need to extract the embedded JSON to check tags
            console.log(chalk.blue(MODULE), `Processing PNG character card: ${filename}`);
            
            let characterData = null;
            let extractionMethod = '';
            
            try {
                // Extract metadata from PNG using CommonJS import
                const metadata = pngMetadata.readMetadata(characterContent);
                extractionMethod = 'png-metadata library';
                
                // Look for the 'chara' field which contains the base64-encoded character data
                const charaField = metadata.find((field: any) => field.keyword === 'chara');
                
                if (charaField && charaField.text) {
                    try {
                        // Decode the base64 data
                        const jsonStr = Buffer.from(charaField.text, 'base64').toString('utf8');
                        
                        // Parse the JSON data
                        characterData = JSON.parse(jsonStr);
                    } catch (jsonError) {
                        console.error(chalk.yellow(MODULE), `Error processing JSON for ${filename}:`, jsonError);
                    }
                } else {
                    // Try alternative field names (some cards might use different metadata field names)
                    const alternativeFields = ['character', 'tavern', 'card', 'data'];
                    
                    for (const fieldName of alternativeFields) {
                        const field = metadata.find((f: any) => f.keyword === fieldName);
                        if (field && field.text) {
                            try {
                                const jsonStr = Buffer.from(field.text, 'base64').toString('utf8');
                                characterData = JSON.parse(jsonStr);
                                if (characterData) break;
                            } catch (err) {
                                // Continue to next field
                            }
                        }
                    }
                }
            } catch (metadataError) {
                console.error(chalk.yellow(MODULE), `Error using png-metadata library for ${filename}:`, metadataError);
                
                // Fallback to our custom PNG metadata extractor
                try {
                    console.log(chalk.blue(MODULE), `Falling back to custom PNG extractor for ${filename}`);
                    characterData = extractCharacterData(characterContent);
                    extractionMethod = 'custom extractor';
                } catch (customError) {
                    console.error(chalk.red(MODULE), `Custom extractor also failed for ${filename}:`, customError);
                }
            }
            
            // Check if the character has any excluded tags
            if (characterData && characterData.tags) {
                const tags = Array.isArray(characterData.tags) 
                    ? characterData.tags 
                    : characterData.tags.split(',').map((tag: string) => tag.trim());
                    
                if (tags.some((tag: string) => excludeTags.includes(tag))) {
                    console.log(chalk.yellow(MODULE), `Skipping character with excluded tag (using ${extractionMethod}):`, filename);
                    return false;
                }
            }
            
            if (!characterData) {
                console.log(chalk.yellow(MODULE), `No character data found in ${filename} metadata, uploading anyway`);
            } else {
                console.log(chalk.green(MODULE), `Successfully processed character metadata (using ${extractionMethod}) for: ${filename}`);
            }
        } else if (filename.endsWith('.json')) {
            // For plain JSON files, directly parse the content
            try {
                const characterData = JSON.parse(characterContent.toString('utf8'));
                
                // Check if the character has any excluded tags
                if (characterData.tags) {
                    const tags = Array.isArray(characterData.tags) 
                        ? characterData.tags 
                        : characterData.tags.split(',').map((tag: string) => tag.trim());
                        
                    if (tags.some((tag: string) => excludeTags.includes(tag))) {
                        console.log(chalk.yellow(MODULE), 'Skipping character with excluded tag:', filename);
                        return false;
                    }
                }
            } catch (jsonError) {
                console.error(chalk.yellow(MODULE), `Error parsing JSON in ${filename}:`, jsonError);
                // Continue with upload anyway
            }
        } else {
            // Not a PNG or JSON - skip this file
            console.log(chalk.yellow(MODULE), 'Skipping non-character file:', filename);
            return false;
        }
        
        // Upload the character file
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
 * Perform sync of characters to Dropbox
 */
export async function performSync(charactersDir: string, excludeTags: string[]): Promise<{success: boolean, count: number}> {
    if (!dropboxClient) {
        console.error(chalk.red(MODULE), 'Dropbox client not initialized');
        return { success: false, count: 0 };
    }
    
    try {
        // Create characters folder if it doesn't exist
        try {
            await dropboxClient.filesCreateFolderV2({
                path: '/characters',
                autorename: false
            });
            console.log(chalk.green(MODULE), 'Created characters folder in Dropbox');
        } catch (error: any) {
            if (error?.status === 409) {
                console.log(chalk.blue(MODULE), 'Characters folder already exists in Dropbox');
            } else {
                console.error(chalk.red(MODULE), 'Error creating characters folder:', error);
                throw error;
            }
        }
        
        // List all character files in directory
        console.log(chalk.blue(MODULE), `Looking for character files in: ${charactersDir}`);
        const files = fs.readdirSync(charactersDir);
        
        // Filter for PNG and JSON files only
        const characterFiles = files.filter(file => 
            file.endsWith('.png') || file.endsWith('.json')
        );
        
        console.log(chalk.blue(MODULE), `Found ${characterFiles.length} potential character files`);
        
        // Upload each character
        let uploadedCount = 0;
        for (const file of characterFiles) {
            const fullPath = path.join(charactersDir, file);
            
            // Skip directories
            if (fs.statSync(fullPath).isDirectory()) {
                continue;
            }
            
            const success = await uploadCharacter(fullPath, excludeTags);
            if (success) {
                uploadedCount++;
            }
        }
        
        console.log(chalk.green(MODULE), `Successfully uploaded ${uploadedCount} characters to Dropbox`);
        
        // Update shared characters count (for stats)
        sharedCharactersCount = uploadedCount;
        
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