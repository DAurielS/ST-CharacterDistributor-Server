// ST-CharacterDistributor-Server/src/types/index.d.ts

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
 * Placeholder for Character Service Interface.
 * To be fleshed out in later tasks.
 */
export interface ICharacterService {
  // Example method:
  // getCharacterById(id: string): Promise<any>;
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
 * Placeholder for Dropbox Client Service Interface.
 * To be fleshed out in later tasks.
 */
export interface IDropboxClientService {
  // Example method:
  // listFiles(path: string): Promise<any[]>;
}