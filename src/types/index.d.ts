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
 * Placeholder for Authentication Service Interface.
 * To be fleshed out in later tasks.
 */
export interface IAuthService {
  // Example method:
  // authenticate(credentials: any): Promise<boolean>;
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
 * Placeholder for Status Service Interface.
 * To be fleshed out in later tasks.
 */
export interface IStatusService {
  // Example method:
  // getPluginStatus(): Promise<any>;
}

/**
 * Placeholder for Dropbox Client Service Interface.
 * To be fleshed out in later tasks.
 */
export interface IDropboxClientService {
  // Example method:
  // listFiles(path: string): Promise<any[]>;
}