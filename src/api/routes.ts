import { Router, Request, Response } from 'express';

/**
 * Settings interface
 */
export interface Settings {
    dropboxAppKey: string;
    dropboxAppSecret: string;
    autoSync: boolean;
    syncInterval: number;
    excludeTags: string[];
}

/**
 * Sync status interface
 */
export interface SyncStatus {
    lastSync: string;
    running: boolean;
    sharedCharacters: number;
}

/**
 * Sets up additional API routes for the server plugin
 */
export function setupApiRoutes(router: Router, settings: Settings, syncStatus: SyncStatus) {
    // This is a placeholder for future API endpoints
    // The main endpoints are currently defined in the index.ts file
    
    // Add additional endpoints here if needed
    router.get('/info', (req: Request, res: Response) => {
        res.status(200).json({
            name: 'Character Distributor',
            version: '1.0.0',
            description: 'Share and discover AI characters through Dropbox integration.'
        });
    });
} 