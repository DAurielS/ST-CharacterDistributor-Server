# ST-CharacterDistributor

A comprehensive character sharing solution for SillyTavern, enabling users to distribute and discover AI character cards through Dropbox integration.

## Project Overview

The Character Distributor consists of two components:
1. **UI Extension** - Frontend interface for SillyTavern users
2. **Server Plugin** - Backend TypeScript implementation for file handling and Dropbox integration

## Features

- 🔄 **Seamless Sync**: Automatically synchronize your character cards with Dropbox
- 🏷️ **Tag Filtering**: Exclude private characters using tags
- 🔗 **Character Sharing**: Generate shareable links for individual characters
- 🔒 **Secure Authentication**: Uses Dropbox OAuth for secure account access
- ⏱️ **Automated Sync**: Set and forget with configurable sync intervals

## Prerequisites

- SillyTavern v1.12.0+
- A Dropbox account
- A Dropbox API application (instructions below)

## Installation

### Step 1: Dropbox API Setup

1. Go to [Dropbox Developer Console](https://www.dropbox.com/developers/apps)
2. Click "Create app"
3. Choose "Scoped access" and "App Folder" access
4. Name your app (e.g., "ST Character Distributor")
5. Add the following redirect URLS:
   ```
   http://localhost:8000/scripts/extensions/third-party/ST-CharacterDistributor/dist/public/oauth_callback.html
   http://127.0.0.1:8000/scripts/extensions/third-party/ST-CharacterDistributor/dist/public/oauth_callback.html
   ```
6. Go to the Permissions menu within the app configuration page
7. Enable everything under "Files and folders"
8. Enable "sharing.read" under "Collaboration"
9. Click "Submit"
10. Note your App Key and App Secret for later use

### Step 2: Install UI Extension

1. In SillyTavern, click the Extensions icon (puzzle piece)
2. Go to "Install Extension" tab
3. Paste the UI extension GitHub URL: `https://github.com/DAurielS/ST-CharacterDistributor-UI`
4. Click "Install"

### Step 3: Install Server Plugin

Find the config.yaml file in your SillyTavern directory and change enableServerPlugins (usually around line 80~90) to true.
```
enableServerPlugins: true
```

#### As a ZIP:
1. Download the server plugin from: `https://github.com/DAurielS/ST-CharacterDistributor-Server`
2. Extract the contents to your SillyTavern plugins directory:
   ```
   YOUR_SILLYTAVERN_DIRECTORY/plugins/
   ```
3. Restart SillyTavern with the plugins system enabled

#### With Git:
1. Navigate to your SillyTavern plugins directory:
   ```
   YOUR_SILLYTAVERN_DIRECTORY/plugins/
   ```
2. Clone the repository:
   ```
   git clone https://github.com/DAurielS/ST-CharacterDistributor-Server.git
   ```
3. Restart SillyTavern with the plugins system enabled

## Configuration

1. Open SillyTavern and go to Extensions → Character Distributor
2. Enter your Dropbox App Key and App Secret
3. Configure sync settings:
   - Enable/disable automatic synchronization
   - Set sync interval (in minutes)
   - Configure tags to exclude (e.g., "Private, WIP")
4. Click "Save Settings"
5. Authenticate with Dropbox by clicking the "Authenticate with Dropbox" button
6. Once authenticated, the status will show "Authenticated"

## Usage

### Sharing Characters

1. Ensure characters are properly tagged (those with excluded tags won't be shared)
2. Click "Force Sync Now" to manually trigger synchronization
3. The sync status will update with the number of characters synced

### Automatic Syncing

When enabled, the extension will automatically sync characters at the specified interval.

## Troubleshooting

### Authentication Issues

If automatic authentication fails:
1. Use the manual token input option
2. Get a token directly from Dropbox
3. Paste it in the "Access Token" field
4. Click "Submit Token"

### Character Detection Problems

If characters aren't being detected properly:
1. Ensure SillyTavern is fully loaded
2. Try clicking "Refresh Auth Status"
3. Check the browser console for detailed logs
4. Verify that characters have proper file extensions (.png)

### Server Plugin Issues

If the server plugin shows as "Not running":
1. Verify the plugin is installed in the correct directory
```
YOUR_SILLYTAVERN_DIRECTORY/plugins/
```
2. Check SillyTavern logs for plugin loading errors

## Development

### Project Structure

```
ST-CharacterDistributor/
├── ST-CharacterDistributor-UI/     # Frontend extension
│   ├── index.js                    # Main extension code
│   ├── settings.html               # Settings UI
│   ├── manifest.json               # Extension metadata
│   └── public/
│       └── oauth_callback.html     # OAuth handler
│
└── ST-CharacterDistributor-Server/ # Backend plugin
    ├── src/
    │   ├── index.ts                # Main plugin entry point
    │   ├── dropbox/
    │   │   └── client.ts           # Dropbox API client
    │   └── utils/
    │       └── pngUtils.ts         # PNG handling utilities
    ├── tsconfig.json               # TypeScript configuration
    └── webpack.config.js           # Build configuration
```

### Building from Source

For UI Extension:
```bash
# No build required - direct JavaScript
```

For Server Plugin:
```bash
cd ST-CharacterDistributor-Server
npm install
npm run build
```

## Acknowledgements

- SillyTavern team for creating the platform
- Dropbox for providing the API
- All contributors and users of this extension

---

Developed by MonGauss 
