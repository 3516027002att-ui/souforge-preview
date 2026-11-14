/** T11 本地会话客户端：连接、身份校验、请求与结果传输（进程内绑定；命名管道传输为后续接线）。 */
import { type LocalSessionHost, type SessionRequest, type SessionResult } from './localSessionHost.js';
export interface SessionIdentity {
    sessionName: string;
    workspaceId: string;
    principal: string;
    authToken: string;
}
export declare class LocalSessionClient {
    private host;
    private readonly identity;
    constructor(identity: SessionIdentity);
    get session(): LocalSessionHost;
    call(request: SessionRequest, handler: (tool: string, args: Record<string, unknown>) => Promise<unknown>): Promise<SessionResult>;
    close(): void;
}
