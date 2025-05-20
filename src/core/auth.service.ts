import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import {
  IAuthService,
  DropboxTokenData,
  ISettingsService,
  IStatusService,
} from '../types';

const TOKEN_FILE_NAME = 'character-distributor-token.json';
const TOKEN_FILE_DIR = 'data'; // Relative to process.cwd()

export class AuthService implements IAuthService {
  private tokenData: DropboxTokenData | null = null;
  private settingsService!: ISettingsService;
  private statusService!: IStatusService;
  private readonly tokenFilePath: string;
  private proactiveRefreshTimer: NodeJS.Timeout | null = null;

  // Refresh 15 minutes before actual expiry
  private readonly PROACTIVE_REFRESH_BUFFER_MS = 15 * 60 * 1000;
  // If token expires in less than this, refresh immediately or very soon
  private readonly MIN_TIME_TO_SCHEDULE_PROACTIVE_MS = 5 * 60 * 1000;
  // Fallback buffer for getAccessToken check
  private readonly EXPIRY_BUFFER_MS_ONDEMAND = 5 * 60 * 1000;


  constructor() {
    this.tokenFilePath = path.join(process.cwd(), TOKEN_FILE_DIR, TOKEN_FILE_NAME);
    console.log(`[AuthService] Token file path set to: ${this.tokenFilePath}`);
  }

  async init(settingsService: ISettingsService, statusService: IStatusService): Promise<void> {
    this.settingsService = settingsService;
    this.statusService = statusService;

    console.log('[AuthService] Initializing...');
    try {
      await this._loadTokenFromFile();
      if (this.tokenData) {
        console.log('[AuthService] Loaded token from file.');
        // Check if immediate refresh is needed or schedule proactive
        const expiresInMs = (this.tokenData.issuedAt + this.tokenData.expiresIn * 1000) - Date.now();
        if (expiresInMs < this.PROACTIVE_REFRESH_BUFFER_MS) {
          console.log('[AuthService] Token is close to expiry or expired, attempting immediate refresh on init.');
          await this._refreshAccessToken(); // This will also schedule next proactive if successful
        } else {
          this._scheduleProactiveRefresh();
        }
      } else {
        console.log('[AuthService] No persisted token found or failed to load.');
      }
    } catch (error) {
      console.error('[AuthService] Error during initialization:', error);
      this.tokenData = null;
    }
    await this.statusService.setAuthenticated(this.isAuthenticated());
    console.log(`[AuthService] Initialized. Authenticated: ${this.isAuthenticated()}`);
  }

  private _clearProactiveRefreshTimer(): void {
    if (this.proactiveRefreshTimer) {
      clearTimeout(this.proactiveRefreshTimer);
      this.proactiveRefreshTimer = null;
      console.log('[AuthService] Cleared existing proactive refresh timer.');
    }
  }

  private _scheduleProactiveRefresh(): void {
    this._clearProactiveRefreshTimer();

    if (!this.tokenData || !this.tokenData.refreshToken) {
      console.log('[AuthService] Cannot schedule proactive refresh: No token data or refresh token.');
      return;
    }

    const now = Date.now();
    const actualExpiryTimeMs = this.tokenData.issuedAt + (this.tokenData.expiresIn * 1000);
    const timeUntilExpiryMs = actualExpiryTimeMs - now;

    // Calculate when to run the refresh: PROACTIVE_REFRESH_BUFFER_MS before actual expiry
    let refreshInMs = timeUntilExpiryMs - this.PROACTIVE_REFRESH_BUFFER_MS;

    if (refreshInMs < this.MIN_TIME_TO_SCHEDULE_PROACTIVE_MS) {
      // If the calculated refresh time is too soon (or in the past),
      // schedule it for a short delay, e.g., 1 minute, to avoid tight loops
      // or if the token is already very close to expiry.
      // getAccessToken will handle immediate needs.
      // Or, if it's already very close, _refreshAccessToken might be called directly by init or getAccessToken.
      // For proactive, we ensure it's not an immediate re-fire.
      console.log(`[AuthService] Calculated proactive refresh time (${refreshInMs}ms) is too soon. Adjusting.`);
      refreshInMs = Math.max(refreshInMs, this.MIN_TIME_TO_SCHEDULE_PROACTIVE_MS / 5); // e.g. 1 min if MIN_TIME is 5 min
      if (timeUntilExpiryMs < this.MIN_TIME_TO_SCHEDULE_PROACTIVE_MS) {
         // If token is already critically close to expiry, don't schedule, rely on on-demand or init refresh.
         console.log('[AuthService] Token too close to expiry for proactive scheduling, relying on on-demand/init refresh.');
         return;
      }
    }
    
    if (refreshInMs <= 0) {
        console.log('[AuthService] Token already expired or refresh time is in the past. Not scheduling proactive refresh. On-demand refresh will handle.');
        return;
    }


    console.log(`[AuthService] Scheduling proactive token refresh in ${Math.round(refreshInMs / 1000 / 60)} minutes.`);
    this.proactiveRefreshTimer = setTimeout(async () => {
      console.log('[AuthService] Proactive refresh timer triggered.');
      await this._refreshAccessToken();
      // _refreshAccessToken will call _scheduleProactiveRefresh again if successful
    }, refreshInMs);
  }

  private async _ensureDataDirectory(): Promise<void> {
    try {
      const dirPath = path.dirname(this.tokenFilePath);
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      console.error(`[AuthService] Error ensuring data directory ${path.dirname(this.tokenFilePath)} exists:`, error);
    }
  }

  private async _loadTokenFromFile(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.tokenFilePath, 'utf-8');
      const parsedToken = JSON.parse(fileContent) as DropboxTokenData;
      if (
        parsedToken &&
        typeof parsedToken.accessToken === 'string' &&
        typeof parsedToken.expiresIn === 'number' &&
        typeof parsedToken.issuedAt === 'number'
      ) {
        this.tokenData = parsedToken;
      } else {
        console.warn('[AuthService] Loaded token file has invalid structure. Ignoring.');
        this.tokenData = null;
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('[AuthService] Token file not found. Normal for first run.');
      } else {
        console.error('[AuthService] Error loading token from file:', error);
      }
      this.tokenData = null;
    }
  }

  private async _saveTokenToFile(): Promise<void> {
    if (!this.tokenData) {
      await this._clearTokenFile();
      return;
    }
    try {
      await this._ensureDataDirectory();
      const fileContent = JSON.stringify(this.tokenData, null, 2);
      await fs.writeFile(this.tokenFilePath, fileContent, 'utf-8');
      console.log('[AuthService] Token data saved to file.');
    } catch (error) {
      console.error('[AuthService] Error saving token to file:', error);
    }
  }

  private async _clearTokenFile(): Promise<void> {
    try {
      await fs.unlink(this.tokenFilePath);
      console.log('[AuthService] Token file cleared.');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('[AuthService] Error clearing token file:', error);
      }
    }
  }

  async handleNewToken(tokenResponse: { access_token: string; refresh_token?: string; expires_in: number }): Promise<void> {
    console.log('[AuthService] Handling new token data.');
    this.tokenData = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresIn: tokenResponse.expires_in,
      issuedAt: Date.now(),
    };
    await this._saveTokenToFile();
    await this.statusService.setAuthenticated(true);
    this._scheduleProactiveRefresh(); // Schedule refresh for the new token
    console.log('[AuthService] New token processed, saved, and proactive refresh scheduled.');
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.tokenData || !this.tokenData.accessToken) {
      console.log('[AuthService] getAccessToken: No current token data.');
      return null;
    }

    const now = Date.now();
    const expiryTime = this.tokenData.issuedAt + this.tokenData.expiresIn * 1000;

    if (expiryTime < now + this.EXPIRY_BUFFER_MS_ONDEMAND) {
      console.log('[AuthService] getAccessToken: Token expired or nearing expiry (on-demand check). Attempting refresh.');
      if (this.tokenData.refreshToken) {
        const refreshed = await this._refreshAccessToken(); // This will also schedule next proactive
        if (!refreshed) {
          console.log('[AuthService] getAccessToken: Token refresh failed.');
          return null;
        }
        console.log('[AuthService] getAccessToken: Token refreshed successfully via on-demand check.');
      } else {
        console.log('[AuthService] getAccessToken: Token expired (on-demand), but no refresh token available. Logging out.');
        await this.logout();
        return null;
      }
    }
    return this.tokenData ? this.tokenData.accessToken : null;
  }

  private async _refreshAccessToken(): Promise<boolean> {
    this._clearProactiveRefreshTimer(); // Clear any pending proactive refresh before attempting a new one

    if (!this.tokenData || !this.tokenData.refreshToken) {
      console.error('[AuthService] _refreshAccessToken: No refresh token available.');
      // If called proactively and fails here, it won't reschedule.
      // If called by getAccessToken, that will handle the null return.
      return false;
    }

    const appKey = this.settingsService.getDropboxAppKey();
    const appSecret = this.settingsService.getDropboxAppSecret();

    if (!appKey || !appSecret) {
      console.error('[AuthService] _refreshAccessToken: Dropbox App Key or Secret is not configured. Cannot refresh token.');
      return false;
    }

    console.log('[AuthService] _refreshAccessToken: Attempting to refresh access token...');
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', this.tokenData.refreshToken);
      params.append('client_id', appKey);
      params.append('client_secret', appSecret);

      const response = await axios.post<{
        access_token: string;
        expires_in: number;
        refresh_token?: string;
        token_type: string;
      }>('https://api.dropbox.com/oauth2/token', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });

      if (response.status === 200 && response.data && response.data.access_token) {
        this.tokenData = {
          accessToken: response.data.access_token,
          refreshToken: response.data.refresh_token || this.tokenData.refreshToken,
          expiresIn: response.data.expires_in,
          issuedAt: Date.now(),
        };
        await this._saveTokenToFile();
        await this.statusService.setAuthenticated(true);
        this._scheduleProactiveRefresh(); // Schedule the *next* proactive refresh
        console.log('[AuthService] _refreshAccessToken: Access token refreshed successfully.');
        return true;
      } else {
        console.error('[AuthService] _refreshAccessToken: Failed to refresh token, unexpected response status:', response.status, 'Data:', response.data);
        return false;
      }
    } catch (error: any) {
      console.error('[AuthService] _refreshAccessToken: Error during token refresh:', error.message);
      if (error.response) {
        console.error('[AuthService] _refreshAccessToken: Error response status:', error.response.status);
        console.error('[AuthService] _refreshAccessToken: Error response data:', JSON.stringify(error.response.data));
        if (error.response.status === 400 || error.response.status === 401) {
          console.warn('[AuthService] _refreshAccessToken: Refresh token seems invalid. Logging out.');
          await this.logout(); // This will clear timer and token
        }
      }
      return false;
    }
  }

  isAuthenticated(): boolean {
    if (!this.tokenData || !this.tokenData.accessToken) {
      return false;
    }
    const expiryTime = this.tokenData.issuedAt + this.tokenData.expiresIn * 1000;
    // Use a small buffer even for isAuthenticated to be slightly conservative
    return expiryTime > Date.now() + 10000; // e.g. 10 seconds buffer
  }

  async logout(): Promise<void> {
    console.log('[AuthService] Logging out...');
    this._clearProactiveRefreshTimer();
    this.tokenData = null;
    await this._clearTokenFile();
    await this.statusService.setAuthenticated(false);
    console.log('[AuthService] Logged out successfully.');
  }
}