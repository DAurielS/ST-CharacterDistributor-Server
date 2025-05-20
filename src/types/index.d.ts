// ST-CharacterDistributor-Server/src/types/index.d.ts
import { files } from 'dropbox'; // Added for IDropboxClientService

/**
 * Defines the structure for plugin settings.
 */
export interface PluginSettings {
  dropboxAppKey: string | null;
  dropboxAppSecret: string | null; // Consider if this is still needed on server if UI handles auth fully
  autoSync: boolean;
  syncIntervalMinutes: number;
  excludeTags: string[];
  // Add other relevant settings fields based on existing logic or future needs
  // For example:
  // lastSyncTimestamp?: number;
  // serverPort?: number;
}

/**
 * Interface for the Settings Service.
 * Manages loading, saving, and accessing plugin settings.
 */
export interface ISettingsService {
  /**
   * Loads settings from the persistence layer (e.g., a JSON file).
   * This should be called once during service initialization.
   */
  loadSettings(): Promise<void>;

  /**
   * Retrieves the current settings.
   * @returns The current plugin settings.
   */
  getSettings(): PluginSettings;

  /**
   * Updates specified settings and persists them.
   * @param newSettings - An object containing the settings to update.
   */
  updateSettings(newSettings: Partial<PluginSettings>): Promise<void>;

  /**
   * Gets the Dropbox App Key.
   * @returns The Dropbox App Key or null if not set.
   */
  getDropboxAppKey(): string | null;

  /**
   * Gets the Dropbox App Secret.
   * @returns The Dropbox App Secret or null if not set.
   */
  getDropboxAppSecret(): string | null; // See note in PluginSettings

  /**
   * Gets the list of tags to exclude during synchronization.
   * @returns An array of exclude tags.
   */
  getExcludeTags(): string[];

  /**
   * Gets the synchronization interval in minutes.
   * @returns The sync interval.
   */
  getSyncIntervalMinutes(): number;

  /**
   * Checks if auto-synchronization is enabled.
   * @returns True if auto-sync is enabled, false otherwise.
   */
  isAutoSyncEnabled(): boolean;
}

/**
 * Defines the structure for Dropbox OAuth token data.
 */
export interface DropboxTokenData {
  accessToken: string;
  refreshToken?: string; // May not always be present initially, but crucial for refresh
  expiresIn: number; // Seconds until expiry from time of issue
  issuedAt: number; // Timestamp (ms) when tokens were issued/last refreshed
}

/**
 * Interface for the Authentication Service.
 * Manages Dropbox OAuth tokens, including loading, saving, refreshing, and validation.
 */
export interface IAuthService {
  /**
   * Initializes the authentication service.
   * Loads any persisted token and sets up dependencies.
   * @param settingsService - Service to access application settings (e.g., Dropbox app key/secret).
   * @param statusService - Service to update the global authentication status.
   */
  init(settingsService: ISettingsService, statusService: IStatusService): Promise<void>;

  /**
   * Handles new token data received, typically after a successful OAuth callback.
   * Persists the new token data.
   * @param tokenData - The raw token data from the OAuth provider.
   *                  Expected structure: { access_token: string; refresh_token?: string; expires_in: number }
   */
  handleNewToken(tokenData: { access_token: string; refresh_token?: string; expires_in: number }): Promise<void>;

  /**
   * Retrieves a valid access token.
   * If the current token is expired or nearing expiry, it attempts to refresh it.
   * @returns A promise that resolves to the access token string, or null if not authenticated or refresh fails.
   */
  getAccessToken(): Promise<string | null>;

  /**
   * Checks if the service currently holds a valid, non-expired access token.
   * This is a quick check and does not attempt to refresh the token.
   * @returns True if authenticated, false otherwise.
   */
  isAuthenticated(): boolean;

  /**
   * Clears any stored authentication token data from memory and persistence.
   * Effectively logs the user out.
   */
  logout(): Promise<void>;

  // Optional: Direct refresh method if other parts of the application
  // need to trigger a refresh explicitly, though getAccessToken should typically handle this.
  // refreshAccessToken(): Promise<boolean>;
}

/**
 * Defines the detailed structure of a character.
 */
export interface CharacterDetail {
  fileName: string; // e.g., "MyChar.png"
  filePath: string; // Full path to the local file
  name: string | null; // Character's display name
  version: string | null; // Character's version string
  tags: string[];
  charData?: any; // The actual character data object, optional here
}

/**
 * Interface for the Character Service.
 * Manages discovery, processing, and details of character files.
 */
export interface ICharacterService {
  /**
   * Initializes the character service.
   * @param settingsService - Service to access application settings (e.g., exclude tags, character paths).
   */
  init(settingsService: ISettingsService): void;

  /**
   * Retrieves details for all local character files, applying exclusion tags.
   * @returns A promise that resolves to an array of CharacterDetail objects.
   */
  getLocalCharacters(): Promise<CharacterDetail[]>;

  /**
   * Retrieves details for a single character file.
   * @param filePath - The full path to the character file.
   * @returns A promise that resolves to a CharacterDetail object, or null if not found or processing fails.
   */
  getCharacterDetails(filePath: string): Promise<CharacterDetail | null>;

  // Potential private helper, not part of the public interface:
  // extractCharacterVersion(data: any): string | null;
}

/**
 * Placeholder for Synchronization Service Interface.
 * To be fleshed out in later tasks.
 */
export interface ISyncService {
  // Example method:
  // performSync(): Promise<void>;
}

/**
 * Defines the synchronization status of the plugin.
 */
export interface SyncStatus {
  isSyncing: boolean;
  lastSyncTime: number | null; // Timestamp
  lastSyncAttemptTime: number | null; // Timestamp
  lastSyncSuccess: boolean | null;
  sharedCharactersCount: number;
  lastSyncMessage: string | null;
}

/**
 * Defines the overall operational status of the plugin.
 */
export interface PluginStatus {
  isAuthenticated: boolean;
  syncStatus: SyncStatus;
  serverVersion: string; // Could be package.json version
  // Add other relevant status fields
}

/**
 * Interface for the Status Service.
 * Manages loading, saving, and accessing plugin operational status.
 */
export interface IStatusService {
  /**
   * Initializes the status service, loads existing status, and sets the plugin version.
   * @param pluginVersion - The current version of the plugin/server.
   */
  init(pluginVersion: string): Promise<void>;

  /**
   * Loads status from the persistence layer (e.g., a JSON file).
   * This is typically called by `init()`.
   */
  loadStatus(): Promise<void>;

  /**
   * Retrieves the current plugin status.
   * @returns The current plugin status.
   */
  getStatus(): PluginStatus;

  /**
   * Updates specified parts of the plugin status and persists them.
   * @param newStatus - An object containing the status fields to update.
   */
  updateStatus(newStatus: Partial<PluginStatus>): Promise<void>;

  /**
   * Updates specified parts of the synchronization status and persists them.
   * @param syncUpdate - An object containing the sync status fields to update.
   */
  updateSyncStatus(syncUpdate: Partial<SyncStatus>): Promise<void>;

  /**
   * Sets the authentication status and persists it.
   * @param isAuthenticated - True if authenticated, false otherwise.
   */
  setAuthenticated(isAuthenticated: boolean): Promise<void>;

  /**
   * Sets the syncing state, updates the last sync attempt time, and optionally a message.
   * @param isSyncing - True if sync is starting, false if stopping (though recordSyncCompletion is preferred for completion).
   * @param message - Optional message related to the sync attempt.
   */
  setSyncing(isSyncing: boolean, message?: string): Promise<void>;

  /**
   * Records the completion of a synchronization attempt.
   * @param success - True if the sync was successful, false otherwise.
   * @param count - The number of characters shared/synced.
   * @param message - Optional message describing the sync outcome.
   */
  recordSyncCompletion(success: boolean, count: number, message?: string): Promise<void>;
}

/**
 * Type alias for Dropbox file metadata, covering files, folders, and deleted entries.
 */
export type DropboxFileMetadata = files.FileMetadataReference | files.FolderMetadataReference | files.DeletedMetadataReference;

/**
 * Interface for the Dropbox Client Service.
 * Provides a lean client for direct Dropbox API interactions,
 * delegating authentication to IAuthService.
 */
export interface IDropboxClientService {
  /**
   * Initializes the Dropbox SDK instance using the configured AuthService and SettingsService.
   * This must be called before any other methods can be used.
   */
  init(): Promise<void>;

  /**
   * Lists files and folders in a given Dropbox folder path.
   * @param folderPath - The path to the folder in Dropbox (e.g., "/Apps/MyApp/MyFolder").
   * @returns A promise that resolves to an array of Dropbox file/folder entries.
   */
  listFiles(folderPath: string): Promise<files.ListFolderResult['entries']>;

  /**
   * Downloads a file from Dropbox.
   * @param dropboxPath - The full path to the file in Dropbox (e.g., "/Apps/MyApp/MyFile.txt").
   * @returns A promise that resolves to a Buffer containing the file content.
   */
  downloadFile(dropboxPath: string): Promise<Buffer>;

  /**
   * Uploads a file to Dropbox.
   * @param localPathOrBuffer - The local file system path (string) to the file to upload, or a Buffer containing the file content.
   * @param dropboxPath - The full path where the file should be saved in Dropbox (e.g., "/Apps/MyApp/MyNewFile.txt").
   * @param mode - Optional. The write mode for the upload (e.g., add, overwrite, update). Defaults to 'add'.
   * @returns A promise that resolves to the metadata of the uploaded file.
   */
  uploadFile(localPathOrBuffer: string | Buffer, dropboxPath: string, mode?: files.WriteMode): Promise<files.FileMetadata>;

  /**
   * Deletes a file or folder from Dropbox.
   * @param dropboxPath - The full path to the file or folder to delete in Dropbox.
   * @returns A promise that resolves to the result of the delete operation.
   */
  deleteFile(dropboxPath: string): Promise<files.DeleteResult>;

  /**
   * Ensures a folder exists at the specified path in Dropbox.
   * If the folder does not exist, it will be created.
   * @param folderPath - The path to the folder in Dropbox.
   * @returns A promise that resolves to the metadata of the folder.
   */
  createFolder(folderPath: string): Promise<files.FolderMetadata>;

  /**
   * Retrieves metadata for a file or folder in Dropbox.
   * @param path - The path to the file or folder in Dropbox.
   * @returns A promise that resolves to the metadata object, or null if the path does not exist.
   */
  getMetadata(path: string): Promise<DropboxFileMetadata | null>;
}