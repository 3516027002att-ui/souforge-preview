/**
 * Renderer-safe container workbench DTOs (BND4 工作台).
 *
 * Projection of `packages/core/src/containers/containerIr.ts` types for the
 * renderer. Absolute path fields (`rootPath`, ...) are stripped in the preload
 * before these cross the context bridge; URIs stay file:// logical URIs.
 *
 * `bytes` is a plain Uint8Array on the renderer side (Electron serializes
 * Node Buffer as Uint8Array over IPC); the renderer never touches Node Buffer.
 */
export {};
//# sourceMappingURL=container-workbench.js.map