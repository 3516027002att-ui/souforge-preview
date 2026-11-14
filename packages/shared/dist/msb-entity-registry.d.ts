/**
 * Sekiro MSB 实体类型注册表（跨 C#/TS 的权威投影）。
 *
 * 全集 = 9 个真实地图（m10, m11, m11_01, m11_02, m13, m15, m17, m20, m25）的实体类型并集，
 * 由独立枚举（output/msb-analysis/full_parse.mjs，gitignored）产出，并经 Bridge 偏移表驱动
 * parser 在 9 图全量 smoke 中交叉验证：注册表不得多出或遗漏任何真实出现的类型。
 *
 * 布局对照 SoulsFormats MSBS（仅格式对照，不复制其实现）：文件由 8 个连续 param 组成，
 * 条目偏移绝对化。各家族 type 判别字段偏移（相对条目起点）：
 *   Model  : type@+0x08
 *   Part   : type@+0x08
 *   Region : type@+0x08
 *   Event  : type@+0x0C
 *   Route  : type@+0x10
 * TypeId 0xFFFFFFFF（即 -1）为 Other 哨兵值，属注册表内类型。
 *
 * 「PartsReference 族」：Sekiro MSB 二进制没有独立 reference param（SoulsFormats MSBS
 * 同样只读 8 个 param，无 PartsReference 类）。part 对 model/part 的引用是 Part 条目内
 * 字段：ModelIndex@+0x10（引用 MODEL_PARAM_ST 条目索引）、sibRel@+0x18（可选引用另一
 * part 名）、typeData 内按名引用。引用类型由引用方 part type 决定，故注册表将其列为
 * 派生族（derivedFrom='part'），复用 part 族枚举，不另设判别字段。
 */
export type MsbEntityFamilyKey = 'model' | 'part' | 'region' | 'event' | 'route' | 'partsReference';
export interface MsbEntityFamilyDef {
    label: string;
    paramName: string;
    /** 判别字段相对条目起点的字节偏移。派生族不设判别字段时省略。 */
    typeOffset?: number;
    types: Record<number, string>;
}
export interface MsbPartsReferenceFamilyDef {
    label: string;
    paramName: string;
    derivedFrom: 'part';
    note: string;
}
export declare const SEKIRO_MSB_ENTITY_TYPE_REGISTRY: {
    readonly schemaVersion: 1;
    readonly game: "sekiro";
    readonly resourceKind: "map";
    readonly corpus: readonly ["m10", "m11", "m11_01", "m11_02", "m13", "m15", "m17", "m20", "m25"];
    readonly families: {
        readonly model: {
            readonly label: "Model 族";
            readonly paramName: "MODEL_PARAM_ST";
            readonly typeOffset: 8;
            readonly types: {
                readonly 0: "MapPiece";
                readonly 1: "Object";
                readonly 2: "Enemy";
                readonly 4: "Player";
                readonly 5: "Collision";
            };
        };
        readonly part: {
            readonly label: "Part 族";
            readonly paramName: "PARTS_PARAM_ST";
            readonly typeOffset: 8;
            readonly types: {
                readonly 0: "MapPiece";
                readonly 1: "Object";
                readonly 2: "Enemy";
                readonly 4: "Player";
                readonly 5: "Collision";
                readonly 9: "DummyObject";
                readonly 10: "DummyEnemy";
                readonly 11: "ConnectCollision";
            };
        };
        readonly region: {
            readonly label: "Region 族";
            readonly paramName: "POINT_PARAM_ST";
            readonly typeOffset: 8;
            readonly types: {
                readonly 0: "Logic";
                readonly 1: "InvasionPoint";
                readonly 2: "EnvironmentMapPoint";
                readonly 4: "Sound";
                readonly 5: "SFX";
                readonly 6: "WindSFX";
                readonly 8: "SpawnPoint";
                readonly 11: "PatrolRoute";
                readonly 13: "WarpPoint";
                readonly 14: "ActivationArea";
                readonly 15: "Event";
                readonly 17: "EnvironmentMapEffectBox";
                readonly 18: "WindArea";
                readonly 20: "MufflingBox";
                readonly 21: "MufflingPortal";
                readonly 23: "SoundSpaceOverride";
                readonly 24: "MufflingPlane";
                readonly 25: "PartsGroupArea";
                readonly 26: "AutoDrawGroupPoint";
                readonly '-1': "Other";
            };
        };
        readonly event: {
            readonly label: "Event 族";
            readonly paramName: "EVENT_PARAM_ST";
            readonly typeOffset: 12;
            readonly types: {
                readonly 4: "Treasure";
                readonly 5: "Generator";
                readonly 7: "ObjAct";
                readonly 9: "MapOffset";
                readonly 14: "PatrolInfo";
                readonly 15: "PlatoonInfo";
                readonly 17: "ResourceItemInfo";
                readonly 18: "GrassLodParam";
                readonly 20: "SkitInfo";
                readonly 21: "PlacementGroup";
                readonly 22: "PartsGroup";
                readonly 23: "Talk";
                readonly 24: "AutoDrawGroupCollision";
                readonly '-1': "Other";
            };
        };
        readonly route: {
            readonly label: "Route 族";
            readonly paramName: "ROUTE_PARAM_ST";
            readonly typeOffset: 16;
            readonly types: {
                readonly 3: "MufflingPortalLink";
                readonly 4: "MufflingBoxLink";
            };
        };
        readonly partsReference: {
            readonly label: "PartsReference 族（派生：part→model/part 引用层）";
            readonly paramName: "PARTS_PARAM_ST";
            readonly derivedFrom: "part";
            readonly note: "Sekiro MSB 无独立 reference param；引用由 Part 条目字段承载（ModelIndex@+0x10、sibRel@+0x18、typeData 按名引用），类型随引用方 part type。";
        };
    };
};
export type MsbEntityTypeRegistry = typeof SEKIRO_MSB_ENTITY_TYPE_REGISTRY;
/** 家族在注册表内是否有对应类型判别。 */
export declare function isRegisteredMsbFamily(family: string): family is MsbEntityFamilyKey;
/**
 * 判断 family+typeId 是否属于注册表。
 * typeId 以有符号 32 位归一化（0xFFFFFFFF → -1）。
 */
export declare function isRegisteredMsbType(family: MsbEntityFamilyKey, typeId: number): boolean;
/** 返回 family+typeId 的类型名；未注册返回 undefined。 */
export declare function lookupMsbTypeName(family: MsbEntityFamilyKey, typeId: number): string | undefined;
/** 0xFFFFFFFF（uint32）归一化为有符号 -1，便于与 C# int 一致。 */
export declare function normalizeMsbTypeId(typeId: number): number;
