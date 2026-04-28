import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { extractCharacterData } from '../utils/pngUtils';

const MODULE = '[Character-Distributor-Dropbox-Index]';

export interface DropboxIndexEntry {
    filename: string;
    downloadUrl: string;
    metadata: Record<string, any>;
    serverModified: string;
    size: number;
}

function toDirectDownloadUrl(sharedUrl: string): string {
    if (!sharedUrl) return '';
    try {
        const url = new URL(sharedUrl);
        url.searchParams.set('dl', '1');
        return url.toString();
    } catch {
        return sharedUrl.includes('?')
            ? `${sharedUrl}&dl=1`
            : `${sharedUrl}?dl=1`;
    }
}

async function getSharedDownloadUrl(dropboxClient: any, filePath: string, filename: string): Promise<string> {
    const sharedLinks = await dropboxClient.sharingListSharedLinks({ path: filePath });
    if (sharedLinks.result.links?.length > 0) {
        return toDirectDownloadUrl(sharedLinks.result.links[0].url);
    }

    const created = await dropboxClient.sharingCreateSharedLinkWithSettings({ path: filePath });
    return toDirectDownloadUrl(created.result.url);
}

function readLocalMetadata(localPath: string): Record<string, any> {
    if (!fs.existsSync(localPath)) return {};

    try {
        if (localPath.endsWith('.png')) {
            const content = fs.readFileSync(localPath);
            return extractCharacterData(content) || {};
        }

        if (localPath.endsWith('.json')) {
            const content = fs.readFileSync(localPath, 'utf8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.error(chalk.yellow(MODULE), `Failed to read metadata for ${path.basename(localPath)}`, error);
    }

    return {};
}

export async function compileDropboxIndex(
    dropboxClient: any,
    charactersDir: string,
    entries: Array<{ name: string; path_display?: string | null; size?: number; server_modified?: string }>
): Promise<DropboxIndexEntry[]> {
    const indexEntries: DropboxIndexEntry[] = [];

    for (const entry of entries) {
        const filePath = entry.path_display || `/characters/${entry.name}`;
        const localPath = path.join(charactersDir, entry.name);
        const metadata = readLocalMetadata(localPath);
        
        let downloadUrl = '';
        try {
            downloadUrl = await getSharedDownloadUrl(dropboxClient, filePath, entry.name);
        } catch (error) {
            console.error(chalk.yellow(MODULE), `Could not create shared download URL for ${entry.name}`, error);
        }

        indexEntries.push({
            filename: entry.name,
            downloadUrl,
            metadata,
            serverModified: entry.server_modified || new Date().toISOString(),
            size: entry.size || 0,
        });
    }

    return indexEntries;
}

export async function uploadDropboxIndex(
    dropboxClient: any,
    indexEntries: DropboxIndexEntry[]
): Promise<string | null> {
    const indexJson = JSON.stringify(indexEntries, null, 2);

    await dropboxClient.filesUpload({
        path: '/characters/index.json',
        contents: Buffer.from(indexJson, 'utf8'),
        mode: { '.tag': 'overwrite' }
    });

    try {
        return await getSharedDownloadUrl(dropboxClient, '/characters/index.json', 'index.json');
    } catch (error) {
        console.error(chalk.yellow(MODULE), 'Could not create shared download URL for index.json', error);
        return null;
    }
}