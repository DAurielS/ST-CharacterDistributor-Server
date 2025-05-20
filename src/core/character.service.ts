import * as fs from 'fs/promises';
import * as path from 'path';
import { ISettingsService } from '../types';
import { ICharacterService, CharacterDetail } from '../types';
import { extractCharacterData, CharacterData as PngCharacterData } from '../utils/pngUtils'; // Renamed to avoid conflict
import chalk from 'chalk'; // For logging, consistent with pngUtils

const MODULE = '[CharacterService]';

export class CharacterService implements ICharacterService {
  private settingsService!: ISettingsService;
  private characterDirs: string[] = []; // To be configured

  constructor() {
    // Determine character directory paths, prioritizing environment variables
    // then falling back to defaults relative to process.cwd().
    const sillyTavernDir = process.env.SILLY_TAVERN_DIR || process.cwd(); // process.cwd() is the fallback for ST root

    const defaultCharPath = path.join(sillyTavernDir, 'data', 'default-user', 'characters');

    // Allow specific override for characters directory
    const charactersPath = process.env.CHARACTERS_DIR || defaultCharPath;

    if (process.env.CHARACTERS_DIR) {
        this.characterDirs = [charactersPath];
    } else {
        // If CHARACTERS_DIR is not set, only use the default 'characters' path.
        this.characterDirs = [defaultCharPath];
    }
  }

  public init(settingsService: ISettingsService): void {
    this.settingsService = settingsService;
    console.log(chalk.blue(MODULE), 'Initialized.');
    // Potentially load character directory paths from settingsService here in the future
  }

  public async getLocalCharacters(): Promise<CharacterDetail[]> {
    const allCharacterDetails: CharacterDetail[] = [];
    const excludeTags = new Set(this.settingsService.getExcludeTags().map(tag => tag.toLowerCase()));

    for (const dir of this.characterDirs) {
      try {
        await fs.access(dir); // Check if directory exists
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file.endsWith('.png') || file.endsWith('.json')) {
            const filePath = path.join(dir, file);
            const details = await this._processCharacterFile(filePath);
            if (details) {
              allCharacterDetails.push(details);
            }
          }
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          console.warn(chalk.yellow(MODULE), `Character directory not found or not accessible: ${dir}`);
        } else {
          console.error(chalk.red(MODULE), `Error reading character directory ${dir}:`, error);
        }
      }
    }

    // Apply excludeTags
    const filteredCharacters = allCharacterDetails.filter(char => {
      if (!char.tags || char.tags.length === 0) {
        return true; // No tags, so not excluded
      }
      return !char.tags.some(tag => excludeTags.has(tag.toLowerCase()));
    });

    return filteredCharacters;
  }

  public async getCharacterDetails(filePath: string): Promise<CharacterDetail | null> {
    try {
      // Basic validation: ensure it's within one of the known character dirs (optional security measure)
      const isWithinKnownDir = this.characterDirs.some(dir => filePath.startsWith(path.resolve(dir)));
      if (!isWithinKnownDir) {
          // Attempt to resolve relative paths if filePath is not absolute
          let resolvedFilePath = filePath;
          if (!path.isAbsolute(filePath)) {
              // Try resolving against each known character directory
              for (const dir of this.characterDirs) {
                  const potentialPath = path.resolve(dir, filePath);
                  try {
                      await fs.access(potentialPath);
                      resolvedFilePath = potentialPath;
                      break;
                  } catch { /* ignore, try next dir */ }
              }
          }
           // Re-check if the resolved path is within known dirs
          if (!this.characterDirs.some(dir => resolvedFilePath.startsWith(path.resolve(dir)))) {
            console.warn(chalk.yellow(MODULE), `Requested file path ${filePath} (resolved: ${resolvedFilePath}) is not within configured character directories.`);
            // Depending on security policy, you might return null or throw an error.
            // For now, we'll proceed if the file exists, but log a warning.
          }
      }


      await fs.access(filePath); // Check if file exists
      return this._processCharacterFile(filePath);
    } catch (error) {
      console.error(chalk.red(MODULE), `Error accessing character file ${filePath}:`, error);
      return null;
    }
  }

  private async _processCharacterFile(filePath: string): Promise<CharacterDetail | null> {
    try {
      const fileName = path.basename(filePath);
      let charData: PngCharacterData | any | null = null; // Use 'any' for JSON flexibility

      if (fileName.endsWith('.png')) {
        const buffer = await fs.readFile(filePath);
        charData = extractCharacterData(buffer);
      } else if (fileName.endsWith('.json')) {
        const content = await fs.readFile(filePath, 'utf-8');
        charData = JSON.parse(content);
      }

      if (!charData) {
        console.warn(chalk.yellow(MODULE), `Could not extract data from ${fileName}`);
        return {
          fileName,
          filePath,
          name: this._extractCharacterNameFromFile(fileName), // Fallback to filename
          version: null,
          tags: [],
          charData: null,
        };
      }
      
      // Handle cases where charData might be nested (e.g. in a 'data' property)
      const effectiveData = charData.data && typeof charData.data === 'object' ? charData.data : charData;

      const name = this._extractCharacterName(effectiveData, fileName);
      const version = this._extractCharacterVersion(effectiveData);
      const tags = this._extractCharacterTags(effectiveData);

      return {
        fileName,
        filePath,
        name,
        version,
        tags,
        charData: charData, // Store the original full data
      };
    } catch (error) {
      console.error(chalk.red(MODULE), `Error processing character file ${filePath}:`, error);
      return null;
    }
  }

  private _extractCharacterNameFromFile(fileName: string): string {
    return path.parse(fileName).name; // Removes extension
  }
  
  private _extractCharacterName(data: any, fallbackFileName: string): string | null {
    if (typeof data?.name === 'string' && data.name.trim()) return data.name.trim();
    if (typeof data?.char_name === 'string' && data.char_name.trim()) return data.char_name.trim();
    
    // Deeper checks for nested structures, common in various card formats
    if (data?.spec?.v2_spec?.character?.name && typeof data.spec.v2_spec.character.name === 'string') {
        return data.spec.v2_spec.character.name.trim();
    }
    if (data?.spec?.name && typeof data.spec.name === 'string') {
        return data.spec.name.trim();
    }
    if (data?.v2_spec?.name && typeof data.v2_spec.name === 'string') {
        return data.v2_spec.name.trim();
    }

    // Fallback to filename if no name found in data
    return this._extractCharacterNameFromFile(fallbackFileName);
  }

  private _extractCharacterVersion(data: any): string | null {
    // Prioritize specific fields, then more general ones
    const versionCandidates = [
      data?.character_version,
      data?.char_version,
      data?.version,
      data?.meta?.version, // Common in some formats
      data?.metadata?.version,
      data?.spec?.version,
      data?.spec?.v2_spec?.character?.version,
      // Add other potential locations based on observed card formats
    ];

    for (const candidate of versionCandidates) {
      if (candidate !== undefined && candidate !== null) {
        const versionStr = String(candidate).trim();
        if (versionStr) {
          // Basic validation: check if it looks like a version (e.g., "1.0", "v2", "2.3.1")
          // This is a simple check; more complex validation could be added.
          if (/^v?[0-9]+(\.[0-9]+)*([a-zA-Z-_.]*)?$/.test(versionStr) || /^[a-zA-Z0-9]+$/.test(versionStr)) {
             return versionStr;
          }
        }
      }
    }
    return null;
  }

  private _extractCharacterTags(data: any): string[] {
    let tags: string[] = [];
    if (Array.isArray(data?.tags)) {
      tags = data.tags.filter((tag: any) => typeof tag === 'string' && tag.trim()).map((tag: string) => tag.trim());
    } else if (Array.isArray(data?.meta?.tags)) { // Common in some formats
        tags = data.meta.tags.filter((tag: any) => typeof tag === 'string' && tag.trim()).map((tag: string) => tag.trim());
    }
    // Add other potential locations for tags if necessary
    return tags.filter(tag => tag.length > 0); // Ensure no empty strings
  }
}