import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from './logger';

const logger = createLogger('FileUtils');

/**
 * Ensures a directory exists, creating it if necessary
 * @param dirPath Path to the directory
 * @returns true if successful, false otherwise
 */
export async function ensureDirectory(dirPath: string): Promise<boolean> {
    try {
        if (!fs.existsSync(dirPath)) {
            logger.info(`Creating directory: ${dirPath}`);
            fs.mkdirSync(dirPath, { recursive: true });
            logger.success(`Successfully created directory: ${dirPath}`);
        }
        
        // Verify write access
        try {
            fs.accessSync(dirPath, fs.constants.W_OK);
            return true;
        } catch (accessError) {
            logger.error(`Directory is not writable: ${dirPath}`, accessError);
            return false;
        }
    } catch (error) {
        logger.error(`Failed to ensure directory exists: ${dirPath}`, error);
        return false;
    }
}

/**
 * Reads and parses a JSON file with error handling
 * @param filePath Path to the JSON file
 * @param defaultValue Default value to return if file doesn't exist or has errors
 * @returns Parsed JSON object or the default value
 */
export async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
    try {
        logger.debug(`Reading JSON file: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            logger.info(`File not found, using default value: ${filePath}`);
            return defaultValue;
        }
        
        const data = fs.readFileSync(filePath, 'utf8');
        logger.debug(`Raw file content read: ${filePath}`);
        
        try {
            const parsed = JSON.parse(data) as T;
            logger.debug(`Successfully parsed JSON from: ${filePath}`);
            return parsed;
        } catch (parseError) {
            logger.error(`Error parsing JSON from file: ${filePath}`, parseError);
            return defaultValue;
        }
    } catch (error) {
        logger.error(`Error reading file: ${filePath}`, error);
        return defaultValue;
    }
}

/**
 * Writes an object to a JSON file with error handling
 * @param filePath Path to the JSON file
 * @param data Data to write
 * @param pretty Whether to format the JSON with indentation
 * @returns true if successful, false otherwise
 */
export async function writeJsonFile<T>(filePath: string, data: T, pretty = true): Promise<boolean> {
    try {
        // Ensure the directory exists
        const dir = path.dirname(filePath);
        const dirExists = await ensureDirectory(dir);
        if (!dirExists) {
            return false;
        }
        
        // Convert to JSON string
        const jsonString = pretty 
            ? JSON.stringify(data, null, 2)
            : JSON.stringify(data);
        
        // Write to file
        fs.writeFileSync(filePath, jsonString, 'utf8');
        logger.debug(`Successfully wrote to file: ${filePath}`);
        
        // Verify the file was written correctly
        if (fs.existsSync(filePath)) {
            const savedContent = fs.readFileSync(filePath, 'utf8');
            if (savedContent !== jsonString) {
                logger.warn(`Warning: saved content differs from what we tried to save in ${filePath}`);
                return false;
            }
            logger.debug(`Verification successful: saved content matches in ${filePath}`);
            return true;
        } else {
            logger.error(`File not found after writing: ${filePath}`);
            return false;
        }
    } catch (error) {
        logger.error(`Error writing to file: ${filePath}`, error);
        return false;
    }
}

/**
 * Reads a binary file with error handling
 * @param filePath Path to the file
 * @returns Buffer containing the file contents or null if error
 */
export async function readBinaryFile(filePath: string): Promise<Buffer | null> {
    try {
        logger.debug(`Reading binary file: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            logger.warn(`File not found: ${filePath}`);
            return null;
        }
        
        const data = fs.readFileSync(filePath);
        logger.debug(`Successfully read binary file: ${filePath}, size: ${data.length} bytes`);
        return data;
    } catch (error) {
        logger.error(`Error reading binary file: ${filePath}`, error);
        return null;
    }
}

/**
 * Writes a binary buffer to a file with error handling
 * @param filePath Path to the file
 * @param data Buffer to write
 * @returns true if successful, false otherwise
 */
export async function writeBinaryFile(filePath: string, data: Buffer): Promise<boolean> {
    try {
        // Ensure the directory exists
        const dir = path.dirname(filePath);
        const dirExists = await ensureDirectory(dir);
        if (!dirExists) {
            return false;
        }
        
        // Write to file
        fs.writeFileSync(filePath, data);
        logger.debug(`Successfully wrote binary file: ${filePath}, size: ${data.length} bytes`);
        return true;
    } catch (error) {
        logger.error(`Error writing binary file: ${filePath}`, error);
        return false;
    }
}

/**
 * Deletes a file with error handling
 * @param filePath Path to the file
 * @returns true if successful, false otherwise
 */
export async function deleteFile(filePath: string): Promise<boolean> {
    try {
        if (!fs.existsSync(filePath)) {
            logger.info(`File already doesn't exist: ${filePath}`);
            return true;
        }
        
        fs.unlinkSync(filePath);
        logger.debug(`Successfully deleted file: ${filePath}`);
        return true;
    } catch (error) {
        logger.error(`Error deleting file: ${filePath}`, error);
        return false;
    }
}

/**
 * Lists files in a directory with optional filtering
 * @param dirPath Path to the directory
 * @param options Optional filtering options
 * @returns Array of file paths or empty array if error
 */
export async function listFiles(
    dirPath: string, 
    options?: { 
        extensions?: string[],
        includeSubdirectories?: boolean
    }
): Promise<string[]> {
    try {
        if (!fs.existsSync(dirPath)) {
            logger.warn(`Directory not found: ${dirPath}`);
            return [];
        }
        
        const files: string[] = [];
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item.name);
            
            if (item.isDirectory() && options?.includeSubdirectories) {
                // Recursively scan subdirectories if requested
                const subFiles = await listFiles(fullPath, options);
                files.push(...subFiles);
            } else if (item.isFile()) {
                // Filter by extension if requested
                if (options?.extensions && options.extensions.length > 0) {
                    const ext = path.extname(item.name).toLowerCase();
                    if (options.extensions.includes(ext)) {
                        files.push(fullPath);
                    }
                } else {
                    files.push(fullPath);
                }
            }
        }
        
        return files;
    } catch (error) {
        logger.error(`Error listing files in directory: ${dirPath}`, error);
        return [];
    }
} 