/**
 * SoulForge 更新协议的 renderer 侧投影。
 *
 * 这里故意不暴露下载地址、文件路径、下载句柄、HTTP 响应或凭据。主进程
 * 负责 GitHub Release 信任校验和 NSIS 更新器；preload 只转发这些 DTO。
 */
export const UPDATE_IPC_CHANNELS = Object.freeze({
    getState: 'update.state',
    setChannel: 'update.setChannel',
    check: 'update.check',
    download: 'update.download',
    cancel: 'update.cancel',
    install: 'update.install',
    openRelease: 'update.openRelease',
    event: 'update:event'
});
export function updateDiagnostic(code, phase, message, retryable, httpStatus) {
    return {
        code,
        phase,
        message,
        retryable,
        ...(httpStatus === undefined ? {} : { httpStatus })
    };
}
export function isUpdateChannel(value) {
    return value === 'stable' || value === 'prerelease';
}
//# sourceMappingURL=update-ipc.js.map