// ST-CharacterDistributor-Server/src/core/status.service.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { IStatusService, PluginStatus, SyncStatus } from '../types';

const STATUS_FILE_NAME = 'character-distributor-status.json';
const DATA_DIR_NAME = 'data';

export class StatusService implements IStatusService {
  private statusFilePath: string;
  private currentStatus: PluginStatus;

  private readonly defaultStatus: PluginStatus = {
    isAuthenticated: false,
    syncStatus: {
      isSyncing: false,
      lastSyncTime: null,
      lastSyncAttemptTime: null,
      lastSyncSuccess: null,
      sharedCharactersCount: 0,
      lastSyncMessage: null,
    },
    serverVersion: '0.0.0', // Default, will be updated in init
  };

  constructor() {
    // process.cwd() should point to the root of ST-CharacterDistributor-Server if run via npm start from there
    // If the plugin is loaded by SillyTavern, process.cwd() might be SillyTavern's root.
    // For robustness, it might be better to have a dedicated data path passed in or determined differently.
    // For now, assuming process.cwd() is the server's root directory.
    const baseDir = process.cwd(); // Or a more reliable way to get the plugin's root/data directory
    this.statusFilePath = path.join(baseDir, DATA_DIR_NAME, STATUS_FILE_NAME);
    this.currentStatus = JSON.parse(JSON.stringify(this.defaultStatus)); // Deep clone
  }

  async init(pluginVersion: string): Promise<void> {
    try {
      await this.loadStatus();
      this.currentStatus.serverVersion = pluginVersion;
      await this._saveStatus(); // Save initial status with version
      console.log('StatusService initialized.');
    } catch (error) {
      console.error('Error initializing StatusService:', error);
      // Fallback to default status if init fails to load/save
      this.currentStatus = JSON.parse(JSON.stringify(this.defaultStatus));
      this.currentStatus.serverVersion = pluginVersion;
    }
  }

  async loadStatus(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.statusFilePath), { recursive: true });
      const fileContent = await fs.readFile(this.statusFilePath, 'utf-8');
      const loadedStatus = JSON.parse(fileContent) as PluginStatus;
      
      // Merge loaded status with defaults to ensure all keys are present
      this.currentStatus = {
        ...JSON.parse(JSON.stringify(this.defaultStatus)), // Start with a fresh default clone
        ...loadedStatus,
        syncStatus: {
          ...this.defaultStatus.syncStatus,
          ...(loadedStatus.syncStatus || {}),
        },
      };
      console.log('Plugin status loaded from file.');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('Status file not found. Using default status and creating file.');
        this.currentStatus = JSON.parse(JSON.stringify(this.defaultStatus));
        // serverVersion will be set in init
        await this._saveStatus(); // Create the file with default status
      } else {
        console.error('Error loading plugin status, using defaults:', error);
        this.currentStatus = JSON.parse(JSON.stringify(this.defaultStatus));
      }
    }
  }

  private async _saveStatus(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.statusFilePath), { recursive: true });
      const fileContent = JSON.stringify(this.currentStatus, null, 2);
      await fs.writeFile(this.statusFilePath, fileContent, 'utf-8');
      console.log('Plugin status saved to file.');
    } catch (error) {
      console.error('Error saving plugin status:', error);
      // Potentially re-throw or handle more gracefully depending on requirements
      throw error;
    }
  }

  getStatus(): PluginStatus {
    return JSON.parse(JSON.stringify(this.currentStatus)); // Return a clone to prevent direct modification
  }

  async updateStatus(newStatus: Partial<PluginStatus>): Promise<void> {
    this.currentStatus = {
      ...this.currentStatus,
      ...newStatus,
      // Deep merge for syncStatus if it's part of newStatus
      ...(newStatus.syncStatus && { 
        syncStatus: {
          ...this.currentStatus.syncStatus,
          ...newStatus.syncStatus
        }
      })
    };
    await this._saveStatus();
  }

  async updateSyncStatus(syncUpdate: Partial<SyncStatus>): Promise<void> {
    this.currentStatus.syncStatus = {
      ...this.currentStatus.syncStatus,
      ...syncUpdate,
    };
    await this._saveStatus();
  }

  async setAuthenticated(isAuthenticated: boolean): Promise<void> {
    this.currentStatus.isAuthenticated = isAuthenticated;
    await this._saveStatus();
  }

  async setSyncing(isSyncing: boolean, message?: string): Promise<void> {
    this.currentStatus.syncStatus.isSyncing = isSyncing;
    this.currentStatus.syncStatus.lastSyncAttemptTime = Date.now();
    if (message !== undefined) {
      this.currentStatus.syncStatus.lastSyncMessage = message;
    }
    if (!isSyncing && this.currentStatus.syncStatus.lastSyncSuccess === null) {
        // If stopping sync and no completion was recorded, mark as not successful by default
        // This handles cases where sync might be manually stopped or aborted
        // this.currentStatus.syncStatus.lastSyncSuccess = false; // Decided against this, recordSyncCompletion is explicit
    }
    await this._saveStatus();
  }

  async recordSyncCompletion(
    success: boolean,
    count: number,
    message?: string
  ): Promise<void> {
    this.currentStatus.syncStatus.isSyncing = false;
    this.currentStatus.syncStatus.lastSyncTime = Date.now();
    this.currentStatus.syncStatus.lastSyncSuccess = success;
    this.currentStatus.syncStatus.sharedCharactersCount = count;
    if (message !== undefined) {
      this.currentStatus.syncStatus.lastSyncMessage = message;
    } else {
      this.currentStatus.syncStatus.lastSyncMessage = success ? 'Sync completed successfully.' : 'Sync failed.';
    }
    await this._saveStatus();
  }
}