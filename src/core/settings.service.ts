// ST-CharacterDistributor-Server/src/core/settings.service.ts

import * as fs from 'fs/promises';
import * as path from 'path';
import { ISettingsService, PluginSettings } from '../types';

// Default settings for the plugin
const DEFAULT_SETTINGS: PluginSettings = {
  dropboxAppKey: null,
  dropboxAppSecret: null,
  autoSync: false,
  syncIntervalMinutes: 60,
  excludeTags: [],
  // serverPort: 3000, // Example of another default setting
};

// Define the settings file name
const SETTINGS_FILE_NAME = 'character-distributor-settings.json';

export class SettingsService implements ISettingsService {
  private currentSettings: PluginSettings;
  private readonly settingsFilePath: string;

  /**
   * Constructs the SettingsService.
   * @param pluginDataPath Optional path to the plugin's specific data directory.
   *                       If not provided, defaults to a 'data' subdirectory within the current working directory.
   */
  constructor(pluginDataPath?: string) {
    // Determine the settings file path.
    // SillyTavern server plugins typically have a 'data' folder in their own directory.
    // process.cwd() should be the plugin's root directory.
    // If pluginDataPath is provided (e.g. by ST loader), use it. Otherwise, default.
    const dataDir = pluginDataPath ? path.resolve(pluginDataPath) : path.join(process.cwd(), 'data');
    this.settingsFilePath = path.join(dataDir, SETTINGS_FILE_NAME);
    this.currentSettings = { ...DEFAULT_SETTINGS };

    // Note: Directory creation is handled in saveSettingsToFile to ensure it exists before writing.
    // Initialization (loading settings) should be done via an explicit init() call.
  }

  /**
   * Initializes the service by loading settings.
   * Should be called after service instantiation.
   */
  public async init(): Promise<void> {
    await this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    try {
      const data = await fs.readFile(this.settingsFilePath, 'utf-8');
      const loadedSettings = JSON.parse(data) as PluginSettings;
      // Merge with defaults to ensure all keys are present, even if new ones were added to DEFAULT_SETTINGS
      this.currentSettings = { ...DEFAULT_SETTINGS, ...loadedSettings };
      console.log(`[SettingsService] Settings loaded successfully from: ${this.settingsFilePath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.warn(`[SettingsService] Settings file not found at ${this.settingsFilePath}. Using default settings and creating the file.`);
        // Save default settings if file doesn't exist
        this.currentSettings = { ...DEFAULT_SETTINGS };
        await this.saveSettingsToFile(); // This will also create the directory if needed
      } else if (error instanceof SyntaxError) {
        console.error(`[SettingsService] Error parsing settings file ${this.settingsFilePath}. Using default settings. Please check the file format.`, error);
        this.currentSettings = { ...DEFAULT_SETTINGS };
        // Optionally, could try to backup the corrupted file here
      } else {
        console.error(`[SettingsService] Failed to load settings from ${this.settingsFilePath}. Using default settings.`, error);
        this.currentSettings = { ...DEFAULT_SETTINGS };
      }
    }
  }

  private async saveSettingsToFile(): Promise<void> {
    try {
      // Ensure the directory exists before writing
      await fs.mkdir(path.dirname(this.settingsFilePath), { recursive: true });
      const data = JSON.stringify(this.currentSettings, null, 2);
      await fs.writeFile(this.settingsFilePath, data, 'utf-8');
      console.log(`[SettingsService] Settings saved successfully to: ${this.settingsFilePath}`);
    } catch (error) {
      console.error(`[SettingsService] Failed to save settings to ${this.settingsFilePath}.`, error);
      // Depending on the error, might want to throw or handle differently
      throw error; // Re-throw for now, so the caller is aware
    }
  }

  getSettings(): PluginSettings {
    // Return a deep copy to prevent external modification of the internal state
    return JSON.parse(JSON.stringify(this.currentSettings));
  }

  async updateSettings(newSettings: Partial<PluginSettings>): Promise<void> {
    this.currentSettings = { ...this.currentSettings, ...newSettings };
    await this.saveSettingsToFile();
    console.log('[SettingsService] Settings updated and saved.');
  }

  getDropboxAppKey(): string | null {
    return this.currentSettings.dropboxAppKey;
  }

  getDropboxAppSecret(): string | null {
    return this.currentSettings.dropboxAppSecret;
  }

  getExcludeTags(): string[] {
    // Return a copy to prevent modification of the internal array
    return [...this.currentSettings.excludeTags];
  }

  getSyncIntervalMinutes(): number {
    return this.currentSettings.syncIntervalMinutes;
  }

  isAutoSyncEnabled(): boolean {
    return this.currentSettings.autoSync;
  }
}