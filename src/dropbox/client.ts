import { Dropbox } from 'dropbox';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { nanoid } from 'nanoid';

const MODULE = '[Character-Distributor-Dropbox]';

// Dropbox client instance
let dropboxClient: Dropbox | null = null;

// Access token
let accessToken: string | null = null;

/**
 * Initialize the Dropbox client with the provided access token
 */
export async function initializeDropbox(token: string, appKey: string, appSecret: string): Promise<boolean> {
    try {
        accessToken = token;
        
        // Initialize Dropbox client
        dropboxClient = new Dropbox({
            accessToken: token,
            clientId: appKey,
            clientSecret: appSecret
        });
        
        // Test the connection by getting account info
        const account = await dropboxClient.usersGetCurrentAccount();
        console.log(chalk.green(MODULE), 'Successfully connected to Dropbox as', account.result.name.display_name);
        
        // Create the characters folder if it doesn't exist
        await ensureCharactersFolder();
        
        return true;
    } catch (error) {
        console.error(chalk.red(MODULE), 'Error initializing Dropbox client:', error);
        dropboxClient = null;
        accessToken = null;
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