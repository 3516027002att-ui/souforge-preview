/**
 * Content-addressed staging area scaffold.
 */
export interface StagingBlob {
    hash: string;
    absolutePath: string;
    byteLength: number;
}
export interface ContentAddressedStaging {
    stagingId: string;
    root: string;
    blobs: Map<string, StagingBlob>;
}
export declare function createContentAddressedStaging(baseDir?: string): Promise<ContentAddressedStaging>;
export declare function stageBytes(staging: ContentAddressedStaging, bytes: Buffer | Uint8Array): Promise<StagingBlob>;
export declare function stageFile(staging: ContentAddressedStaging, sourcePath: string): Promise<StagingBlob>;
export declare function materializeBlob(staging: ContentAddressedStaging, hash: string, destinationRelativePath: string): Promise<string>;
export declare function stagingWorkRoot(staging: ContentAddressedStaging): string;
