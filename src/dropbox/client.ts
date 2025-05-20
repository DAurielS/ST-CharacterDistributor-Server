import { Dropbox, files, DropboxResponseError } from 'dropbox';
import * as fs from 'fs';
import fetch from 'node-fetch'; // Dropbox SDK requires a fetch implementation in Node.js

import {
  IAuthService,
  ISettingsService,
  IDropboxClientService,
  DropboxFileMetadata,
} from '../types';

export class DropboxClientService implements IDropboxClientService {
  private dbx: Dropbox | null = null;
  private authService: IAuthService;
  private settingsService: ISettingsService;

  constructor(authService: IAuthService, settingsService: ISettingsService) {
    if (!authService) {
      throw new Error('AuthService is required for DropboxClientService.');
    }
    if (!settingsService) {
      throw new Error('SettingsService is required for DropboxClientService.');
    }
    this.authService = authService;
    this.settingsService = settingsService;
  }

  private async ensureSdkInitializedAndAuthenticated(): Promise<void> {
    const currentAccessToken = await this.authService.getAccessToken();
    if (!currentAccessToken) {
      this.dbx = null; // Ensure dbx is null if not authenticated
      throw new Error('Dropbox client not authenticated: No access token available from AuthService.');
    }

    const appKey = this.settingsService.getDropboxAppKey();
    if (!appKey) {
      this.dbx = null; // Ensure dbx is null if essential config missing
      throw new Error('Dropbox App Key not configured in SettingsService. Cannot initialize Dropbox SDK.');
    }

    // Re-initialize the dbx instance with the latest token to ensure it's fresh
    try {
      this.dbx = new Dropbox({ accessToken: currentAccessToken, clientId: appKey, fetch });
    } catch (error) {
        console.error('Error creating Dropbox SDK instance during ensureSdkInitializedAndAuthenticated:', error);
        this.dbx = null;
        throw new Error(`Failed to create Dropbox SDK instance: ${error instanceof Error ? error.message : String(error)}`);
    }


    if (!this.dbx) {
      // This case should ideally be caught by the try-catch above, but as a safeguard:
      throw new Error('Dropbox SDK instance (this.dbx) is null after attempting re-initialization.');
    }
  }

  public async init(): Promise<void> {
    console.log('Initializing DropboxClientService...');
    try {
      await this.ensureSdkInitializedAndAuthenticated();
      console.log('DropboxClientService initialized and authenticated successfully.');
    } catch (error) {
      console.error('DropboxClientService initialization failed:', error);
      // Propagate the error to allow the application to handle initialization failures.
      throw error;
    }
  }

  public async listFiles(folderPath: string): Promise<files.ListFolderResult['entries']> {
    await this.ensureSdkInitializedAndAuthenticated();
    try {
      const response = await this.dbx!.filesListFolder({ path: folderPath });
      return response.result.entries;
    } catch (error) {
      console.error(`Error listing files in Dropbox path '${folderPath}':`, error);
      throw error;
    }
  }

  public async downloadFile(dropboxPath: string): Promise<Buffer> {
    await this.ensureSdkInitializedAndAuthenticated();
    try {
      const response = await this.dbx!.filesDownload({ path: dropboxPath });
      // The Dropbox SDK types this as 'any' for fileBinary, so we cast.
      return (response.result as any).fileBinary as Buffer;
    } catch (error) {
      console.error(`Error downloading file from Dropbox path '${dropboxPath}':`, error);
      throw error;
    }
  }

  public async uploadFile(
    localPathOrBuffer: string | Buffer,
    dropboxPath: string,
    mode?: files.WriteMode
  ): Promise<files.FileMetadata> {
    await this.ensureSdkInitializedAndAuthenticated();
    try {
      const contents = typeof localPathOrBuffer === 'string'
        ? fs.readFileSync(localPathOrBuffer)
        : localPathOrBuffer;

      const writeMode = mode || { '.tag': 'add' }; // Default to 'add' if no mode is specified

      const response = await this.dbx!.filesUpload({
        path: dropboxPath,
        contents,
        mode: writeMode,
        autorename: false, // Explicitly false, can be configurable if needed
      });
      return response.result as files.FileMetadata;
    } catch (error) {
      console.error(`Error uploading file to Dropbox path '${dropboxPath}':`, error);
      throw error;
    }
  }

  public async deleteFile(dropboxPath: string): Promise<files.DeleteResult> {
    await this.ensureSdkInitializedAndAuthenticated();
    try {
      const response = await this.dbx!.filesDeleteV2({ path: dropboxPath });
      return response.result as files.DeleteResult;
    } catch (error) {
      console.error(`Error deleting file/folder from Dropbox path '${dropboxPath}':`, error);
      throw error;
    }
  }

  public async createFolder(folderPath: string): Promise<files.FolderMetadata> {
    await this.ensureSdkInitializedAndAuthenticated();
    try {
      // First, try to get metadata to see if it already exists and is a folder
      const existingMetadata = await this.dbx!.filesGetMetadata({ path: folderPath });
      if (existingMetadata.result['.tag'] === 'folder') {
        return existingMetadata.result as files.FolderMetadata;
      } else {
        // Path exists but is not a folder, this is an issue.
        throw new Error(`Cannot create folder: Path '${folderPath}' exists but is not a folder.`);
      }
    } catch (error: any) {
      // If error is 409, it means path_lookup/not_found for filesGetMetadata
      if (error instanceof DropboxResponseError && error.status === 409 && error.error?.error?.['.tag'] === 'path' && error.error?.error?.path?.['.tag'] === 'not_found') {
        // Folder does not exist, so create it
        try {
          const createResponse = await this.dbx!.filesCreateFolderV2({ path: folderPath, autorename: false });
          return createResponse.result.metadata as files.FolderMetadata;
        } catch (createError: any) {
          // Handle potential race condition: if folder was created between getMetadata and createFolderV2
           if (createError instanceof DropboxResponseError && createError.status === 409 && createError.error?.error?.['.tag'] === 'path' && createError.error?.error?.path?.['.tag'] === 'conflict' && createError.error.error.path.conflict['.tag'] === 'folder') {
            console.warn(`Race condition: Folder '${folderPath}' created concurrently. Fetching its metadata.`);
            const raceMetadata = await this.dbx!.filesGetMetadata({ path: folderPath });
            if (raceMetadata.result['.tag'] === 'folder') {
                return raceMetadata.result as files.FolderMetadata;
            } else {
                throw new Error(`Race condition resolved but path '${folderPath}' is not a folder.`);
            }
          }
          console.error(`Error creating folder '${folderPath}' after not_found error:`, createError?.error || createError);
          throw createError; // Re-throw the creation error
        }
      } else {
        // Different error during filesGetMetadata (e.g., auth issue, network issue)
        console.error(`Error checking folder metadata for '${folderPath}' before creation:`, error?.error || error);
        throw error; // Re-throw the initial getMetadata error
      }
    }
  }

  public async getMetadata(path: string): Promise<DropboxFileMetadata | null> {
    await this.ensureSdkInitializedAndAuthenticated();
    try {
      const response = await this.dbx!.filesGetMetadata({ path });
      return response.result as DropboxFileMetadata;
    } catch (error: any) {
       // If error is 409, it means path_lookup/not_found for filesGetMetadata
      if (error instanceof DropboxResponseError && error.status === 409 && error.error?.error?.['.tag'] === 'path' && error.error?.error?.path?.['.tag'] === 'not_found') {
        return null; // Path does not exist
      }
      console.error(`Error getting metadata for Dropbox path '${path}':`, error?.error || error);
      throw error; // Re-throw other errors
    }
  }
}