/** Persistent per-user data, independent from Electron and the Mod workspace. */
export declare function localApplicationDataDirectory(input?: {
    platform?: NodeJS.Platform;
    home?: string;
    env?: NodeJS.ProcessEnv;
}): string;
