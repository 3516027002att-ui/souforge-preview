/** T07 资源 provider：FMG/TAE/容器确定连接适配，无语义规则即报缺口。 */
export interface FmgTextInput {
    sourceUri: string;
    childChain: string[];
    category: string;
    language?: string;
    textId: number;
    text: string;
}
export interface TaeFieldInput {
    sourceUri: string;
    childChain: string[];
    taeEntryIndex: number;
    animId: number;
    decoded: boolean;
    fields: Array<{
        name: string;
        value: string | number | boolean;
    }>;
}
export interface ContainerMemberInput {
    outerSourceUri: string;
    childChain: string[];
}
export declare function resolveFmgTextIdentity(input: FmgTextInput): string;
export declare function buildTaeSemanticEdges(input: TaeFieldInput): {
    edges: Array<{
        from: string;
        to: string;
        relationKind: string;
        certainty: 'confirmed';
    }>;
    diagnostics: string[];
};
export declare function buildContainerMembershipEdge(input: ContainerMemberInput): {
    from: string;
    to: string;
    relationKind: 'member';
};
