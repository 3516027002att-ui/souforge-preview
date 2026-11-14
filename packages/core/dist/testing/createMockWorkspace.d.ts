export interface MockWorkspace {
    root: string;
    files: {
        eventText: string;
        mapJson: string;
        paramJson: string;
        msgText: string;
    };
}
export interface CreateMockWorkspaceOptions {
    root?: string;
}
/**
 * Creates a tiny synthetic ModEngine-style workspace.
 *
 * It contains no real game assets. The data is deliberately small and fake, but
 * shaped like SoulForge's v0.1 resource chain:
 *
 * event -> map entity/region -> param row -> msg entry
 */
export declare function createMockWorkspace(options?: CreateMockWorkspaceOptions): Promise<MockWorkspace>;
