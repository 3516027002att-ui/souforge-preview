import { CoreToolSession } from '../runtime/coreToolSession.js';
import { LocalSessionHost } from './localSessionHost.js';
export interface DaemonHandshake {
    protocol: number;
    workspaceKey: string;
    sessionName: string;
    authToken: string;
}
export interface DaemonConfig {
    workspaceId: string;
    workspaceKey: string;
    sessionName: string;
    principal: string;
    pipePath: string;
    lockPath: string;
    authTokenPath: string;
}
export declare const DAEMON_PROTOCOL = 1;
export declare function daemonPaths(workspaceKey: string, sessionName: string): Omit<DaemonConfig, 'workspaceId' | 'workspaceKey' | 'sessionName' | 'principal'> & {
    dir: string;
};
export interface SessionDaemon {
    config: DaemonConfig;
    coreSession: CoreToolSession;
    /** 帧/排队/id 去重的请求宿主（证明归桥接会话，本宿主只做传输语义）。 */
    requestHost: LocalSessionHost;
    close(): Promise<void>;
}
/** 同一 key 只产生一个有效 host：独占锁 + 拥有者存活检查。 */
export declare function tryAcquireStartLock(lockPath: string): boolean;
export declare function startSessionDaemon(input: {
    workspaceId: string;
    workspaceKey: string;
    sessionName: string;
    principal: string;
    /** 复用 openLocalCliSession 持有的真实 CoreToolSession。 */
    coreSession?: CoreToolSession;
    /** 宿主进程注入的真实执行（注册表 + 桥接 + 会话）；daemon 只做传输与握手。 */
    dispatch: (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
}): Promise<SessionDaemon>;
