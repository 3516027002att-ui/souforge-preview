/** T11 本地会话客户端：连接、身份校验、请求与结果传输（进程内绑定；命名管道传输为后续接线）。 */
import { openLocalSession } from './localSessionHost.js';
export class LocalSessionClient {
    host;
    identity;
    constructor(identity) {
        this.host = openLocalSession(identity.sessionName, identity.workspaceId, identity.principal);
        if (this.host.authToken !== identity.authToken && identity.authToken !== '') {
            throw new Error('CLI_SESSION_AUTH_FAILED');
        }
        this.identity = identity;
    }
    get session() {
        return this.host;
    }
    async call(request, handler) {
        return await this.host.dispatch(request, handler);
    }
    close() {
        this.host.close();
    }
}
//# sourceMappingURL=localSessionClient.js.map