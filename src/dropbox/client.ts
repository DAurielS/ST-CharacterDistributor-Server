import { Dropbox, DropboxAuth, files } from 'dropbox';
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
let tokenExpirationTime: number | null = null;

// Shared characters count - for stats
let sharedCharactersCount = 0;

/**
 * Save auth token to file
 */
async function saveAuthTokenToFile(token: string, refreshTkn?: string, expiresIn?: number): Promise<void> {
    try {
        // Ensure directory exists
        const dir = path.dirname(tokenFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Calculate expiration time if provided
        const expirationTime = expiresIn ? Date.now() + (expiresIn * 1000) : null;
        
        // Write tokens to file
        const tokenData = {
            accessToken: token,
            refreshToken: refreshTkn || null,
            expirationTime: expirationTime
        };
        
        fs.writeFileSync(tokenFilePath, JSON.stringify(tokenData, null, 2), 'utf8');
        console.log(chalk.green(MODULE), 'Auth tokens saved to file');
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error saving auth tokens to file:', error);
        throw error;
    }
}

/**
 * Load auth token from file
 */
async function loadAuthTokenFromFile(): Promise<{accessToken: string | null, refreshToken: string | null, expirationTime: number | null}> {
    try {
        if (fs.existsSync(tokenFilePath)) {
            const data = fs.readFileSync(tokenFilePath, 'utf8');
            const tokenData = JSON.parse(data);
            
            if (tokenData.accessToken) {
                console.log(chalk.green(MODULE), 'Auth tokens loaded from file');
                return {
                    accessToken: tokenData.accessToken,
                    refreshToken: tokenData.refreshToken || null,
                    expirationTime: tokenData.expirationTime || null
                };
            }
        }
        return { accessToken: null, refreshToken: null, expirationTime: null };
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error loading auth tokens from file:', error);
        return { accessToken: null, refreshToken: null, expirationTime: null };
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
                // Check if the error is specifically an expired token
                if (apiError?.response?.data?.error?.['.tag'] === 'expired_access_token') {
                    return { valid: false, message: 'Access token has expired, refresh required' };
                }
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
 * Refresh access token using refresh token
 */
async function refreshAccessToken(appKey: string, appSecret: string): Promise<boolean> {
    try {
        if (!refreshToken) {
            console.error(chalk.red(MODULE), 'No refresh token available to refresh access token');
            return false;
        }

        console.log(chalk.blue(MODULE), 'Attempting to refresh access token...');
        
        // Create form data for token refresh
        const formData = new URLSearchParams();
        formData.append('grant_type', 'refresh_token');
        formData.append('refresh_token', refreshToken);
        formData.append('client_id', appKey);
        formData.append('client_secret', appSecret);
        
        // Call Dropbox OAuth API to refresh the token
        const response = await axios({
            method: 'post',
            url: 'https://api.dropbox.com/oauth2/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: formData.toString(),
            timeout: 10000 // 10 second timeout
        });
        
        if (response.status === 200 && response.data && response.data.access_token) {
            // Store the new access token
            accessToken = response.data.access_token;
            
            // Update the refresh token if a new one was provided
            if (response.data.refresh_token) {
                refreshToken = response.data.refresh_token;
            }
            
            // Update expiration time if provided
            if (response.data.expires_in) {
                tokenExpirationTime = Date.now() + (response.data.expires_in * 1000);
            }
            
            console.log(chalk.green(MODULE), 'Successfully refreshed access token');
            // Use non-null assertion since we know accessToken is set above
            console.log(chalk.green(MODULE), `New token length: ${accessToken!.length}`);
            console.log(chalk.green(MODULE), `Expires in: ${response.data.expires_in || 'unknown'} seconds`);
            
            // Save the refreshed tokens - we know accessToken is not null here
            await saveAuthTokenToFile(
                accessToken as string, 
                refreshToken || undefined, 
                response.data.expires_in
            );
            
            // Reinitialize the Dropbox client with the new token
            dropboxClient = new Dropbox({
                accessToken: accessToken as string,
                clientId: appKey,
                clientSecret: appSecret,
                fetch: fetch
            });
            
            return true;
        } else {
            console.error(chalk.red(MODULE), 'Failed to refresh access token, unexpected response:', response.status);
            console.error(chalk.red(MODULE), 'Response data:', JSON.stringify(response.data));
            return false;
        }
    } catch (error: any) {
        console.error(chalk.red(MODULE), 'Error refreshing access token:', error.message);
        if (error.response) {
            console.error(chalk.red(MODULE), 'Response status:', error.response.status);
            console.error(chalk.red(MODULE), 'Response data:', JSON.stringify(error.response.data));
        }
        return false;
    }
}

/**
 * Initialize the Dropbox client with the provided access token
 */
export async function initializeDropbox(token: string, appKey: string, appSecret: string, refresh_token?: string, expires_in?: number): Promise<boolean> {
    try {
        // Log sanitized info
        console.log(chalk.green(MODULE), 'Initializing Dropbox client');
        console.log(chalk.green(MODULE), `Access Token length: ${token?.length || 0}`);
        console.log(chalk.green(MODULE), `Access Token first/last 5 chars: ${token?.substring(0, 5)}...${token?.slice(-5)}`);
        console.log(chalk.green(MODULE), `App Key length: ${appKey?.length || 0}`);
        console.log(chalk.green(MODULE), `App Secret length: ${appSecret?.length || 0}`);
        console.log(chalk.green(MODULE), `Refresh Token provided: ${!!refresh_token}`);
        
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
        
        // Store refresh token if provided
        if (refresh_token) {
            refreshToken = refresh_token;
            console.log(chalk.green(MODULE), `Refresh token stored, length: ${refresh_token.length}`);
        }
        
        // Store expiration time if provided
        if (expires_in) {
            tokenExpirationTime = Date.now() + (expires_in * 1000);
            console.log(chalk.green(MODULE), `Token expiration set to: ${new Date(tokenExpirationTime).toISOString()}`);
        }
        
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
                    await saveAuthTokenToFile(token, refreshToken || undefined, expires_in);
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
                        
                        // Check if this is an expired token error that can be refreshed
                        if (accountError?.error?.['.tag'] === 'expired_access_token' && refreshToken) {
                            console.log(chalk.yellow(MODULE), 'Token expired. Attempting to refresh...');
                            const refreshed = await refreshAccessToken(appKey, appSecret);
                            if (refreshed) {
                                console.log(chalk.green(MODULE), 'Token refreshed successfully. Continuing...');
                                continue; // Skip retry count increment and try again with refreshed token
                            } else {
                                console.error(chalk.red(MODULE), 'Failed to refresh token');
                            }
                        }
                        
                        break; // Don't retry on auth failure unless token was refreshed above
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
        }
        
        return false;
    } catch (error: any) {
        console.error(chalk.red(MODULE), 'Unexpected error during Dropbox initialization:', error);
        return false;
    }
}

/**
 * Restore Dropbox client from previously saved token
 */
export async function restoreDropboxClient(appKey: string, appSecret: string): Promise<boolean> {
    try {
        console.log(chalk.green(MODULE), 'Attempting to restore Dropbox client from saved token');
        
        // Load token from file
        const { accessToken: savedToken, refreshToken: savedRefreshToken, expirationTime: savedExpirationTime } = await loadAuthTokenFromFile();
        
        if (!savedToken) {
            console.log(chalk.yellow(MODULE), 'No saved token found');
            return false;
        }
        
        // Check if token is about to expire and refresh it if possible
        if (savedExpirationTime && savedRefreshToken) {
            const currentTime = Date.now();
            // If token is expired or will expire in the next 5 minutes (300000ms)
            if (savedExpirationTime < currentTime + 300000) {
                console.log(chalk.yellow(MODULE), 'Saved token is expired or about to expire. Attempting to refresh...');
                
                // Store the refresh token temporarily so refreshAccessToken can use it
                refreshToken = savedRefreshToken;
                
                const refreshed = await refreshAccessToken(appKey, appSecret);
                if (refreshed) {
                    console.log(chalk.green(MODULE), 'Token refreshed successfully');
                    return true; // refreshAccessToken already initializes the client
                } else {
                    console.error(chalk.red(MODULE), 'Failed to refresh token, will try to use the existing token anyway');
                }
            }
        }
        
        // Initialize client with the saved token (and refresh token if available)
        const expiresIn = savedExpirationTime ? Math.max(0, Math.floor((savedExpirationTime - Date.now()) / 1000)) : undefined;
        return await initializeDropbox(savedToken, appKey, appSecret, savedRefreshToken || undefined, expiresIn);
    } catch (error: any) {
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
        throw new Error('Dropbox client not initialized');
    }
    
    try {
        // Check if the folder exists
        console.log(chalk.blue(MODULE), 'Checking if characters folder exists in Dropbox');
        await dropboxClient.filesGetMetadata({
            path: '/characters'
        });
        
        console.log(chalk.green(MODULE), 'Characters folder exists in Dropbox');
    } catch (error: any) {
        // If the folder doesn't exist (error status 409), create it
        if (error?.status === 409 || error?.status === 404 || error?.status === 400) {
            try {
                console.log(chalk.yellow(MODULE), 'Characters folder does not exist, creating it');
                await dropboxClient.filesCreateFolderV2({
                    path: '/characters',
                    autorename: false
                });
                
                console.log(chalk.green(MODULE), 'Created characters folder in Dropbox');
            } catch (createError: any) {
                console.error(chalk.red(MODULE), 'Error creating characters folder:', createError);
                
                // If the error is that the folder already exists, that's fine
                if (createError?.status === 409) {
                    console.log(chalk.green(MODULE), 'Characters folder already exists (race condition)');
                    return;
                }
                
                throw createError;
            }
        } else {
            console.error(chalk.red(MODULE), 'Error checking if characters folder exists:', error);
            throw error;
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
            let extractionMethod = 'custom extractor';
            
            try {
                // Use our custom extractor directly since it's the only one that works
                console.log(chalk.blue(MODULE), `Using custom PNG extractor for ${filename}`);
                characterData = extractCharacterData(characterContent);
                
                if (!characterData) {
                    console.log(chalk.yellow(MODULE), `No character data could be extracted from ${filename}`);
                }
            } catch (extractionError) {
                console.error(chalk.red(MODULE), `Error extracting character data from ${filename}:`, extractionError);
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
export async function performSync(
    charactersDir: string,
    excludeTags: string[] = [],
    allowedCharacterFiles: string[] = [] // List of files that are allowed to be uploaded
): Promise<{success: boolean, count: number, removed: number}> {
    if (!dropboxClient) {
        console.error(chalk.red(MODULE), 'Dropbox client not initialized');
        return { success: false, count: 0, removed: 0 };
    }
    
    try {
        // Create characters folder if it doesn't exist
        try {
            await ensureCharactersFolder();
        } catch (error) {
            console.error(chalk.red(MODULE), 'Error ensuring characters folder exists:', error);
            throw error;
        }
        
        // First, list what's currently in Dropbox
        console.log(chalk.blue(MODULE), 'Listing existing files in Dropbox /characters folder');
        const dropboxContents = await dropboxClient.filesListFolder({
            path: '/characters'
        });
        
        // Get filenames of all currently uploaded files
        const currentlyUploadedFiles = dropboxContents.result.entries
            .filter(entry => entry['.tag'] === 'file')
            .map(entry => path.basename(entry.path_display || ''));
        
        console.log(chalk.blue(MODULE), `Found ${currentlyUploadedFiles.length} character files already on Dropbox`);
        
        // Step 1: Remove files that shouldn't be there anymore
        let removedCount = 0;
        for (const existingFile of currentlyUploadedFiles) {
            // Skip non-character files
            if (!existingFile.endsWith('.png') && !existingFile.endsWith('.json')) {
                continue;
            }
            
            // Check if this file is in the allowed list
            const shouldExist = allowedCharacterFiles.length === 0 || 
                               allowedCharacterFiles.includes(existingFile);
            
            if (!shouldExist) {
                try {
                    console.log(chalk.yellow(MODULE), `Removing file that no longer meets criteria: ${existingFile}`);
                    await dropboxClient.filesDeleteV2({
                        path: `/characters/${existingFile}`
                    });
                    removedCount++;
                } catch (deleteError) {
                    console.error(chalk.red(MODULE), `Error removing file ${existingFile}:`, deleteError);
                    // Continue with other files even if one fails
                }
            }
        }
        
        // Step 2: Upload files that should be there
        console.log(chalk.blue(MODULE), `Looking for character files in: ${charactersDir}`);
        
        // Check if directory exists
        if (!fs.existsSync(charactersDir)) {
            console.error(chalk.red(MODULE), `Characters directory does not exist: ${charactersDir}`);
            return { success: false, count: 0, removed: removedCount };
        }
        
        const files = fs.readdirSync(charactersDir);
        
        // Filter for PNG and JSON files only
        let characterFiles = files.filter(file => 
            (file.endsWith('.png') || file.endsWith('.json'))
        );
        
        // Further filter by allowed character files if provided
        if (allowedCharacterFiles.length > 0) {
            characterFiles = characterFiles.filter(file => allowedCharacterFiles.includes(file));
            console.log(chalk.blue(MODULE), `Filtered to ${characterFiles.length} allowed character files`);
        }
        
        console.log(chalk.blue(MODULE), `Found ${characterFiles.length} character files to process`);
        
        // Upload each character
        let uploadedCount = 0;
        for (const file of characterFiles) {
            const fullPath = path.join(charactersDir, file);
            
            // Skip directories
            if (fs.statSync(fullPath).isDirectory()) {
                continue;
            }
            
            // Check if the file already exists in Dropbox to avoid unnecessary uploads
            const fileExists = currentlyUploadedFiles.includes(file);
            
            if (fileExists) {
                console.log(chalk.blue(MODULE), `File already exists in Dropbox, skipping upload: ${file}`);
                uploadedCount++;
                continue;
            }
            
            const success = await uploadCharacter(fullPath, excludeTags);
            if (success) {
                uploadedCount++;
            }
        }
        
        console.log(chalk.green(MODULE), `Sync completed: ${uploadedCount} characters uploaded, ${removedCount} removed`);
        
        // Update shared characters count (for stats)
        sharedCharactersCount = currentlyUploadedFiles.length - removedCount + uploadedCount;
        
        return { success: true, count: uploadedCount, removed: removedCount };
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error during sync:', error);
        return { success: false, count: 0, removed: 0 };
    }
}

/**
 * Check if the Dropbox client is authenticated
 */
export function checkDropboxAuth(): boolean {
    return dropboxClient !== null && accessToken !== null;
}

/**
 * Execute a Dropbox API call with automatic token refresh if needed
 * @param apiCall Function that executes the Dropbox API call
 * @param appKey App key for refresh token flow
 * @param appSecret App secret for refresh token flow
 */
async function executeWithTokenRefresh<T>(
    apiCall: () => Promise<T>, 
    appKey: string, 
    appSecret: string
): Promise<T> {
    try {
        // Attempt the API call
        return await apiCall();
    } catch (error: any) {
        // Check if this is an expired token error
        if (error?.status === 401 && error?.error?.['.tag'] === 'expired_access_token' && refreshToken) {
            console.log(chalk.yellow(MODULE), 'Received expired token error. Attempting to refresh token...');
            
            // Try to refresh the token
            const refreshed = await refreshAccessToken(appKey, appSecret);
            
            if (refreshed) {
                console.log(chalk.green(MODULE), 'Token refreshed successfully. Retrying API call...');
                // Retry the API call with the new token
                return await apiCall();
            } else {
                console.error(chalk.red(MODULE), 'Failed to refresh token');
                throw error;
            }
        } else {
            // Not an expired token error or cannot refresh, rethrow
            throw error;
        }
    }
} 