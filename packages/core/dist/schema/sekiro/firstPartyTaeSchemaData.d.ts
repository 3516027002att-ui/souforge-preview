export interface FirstPartyTaeSchemaField {
    offset: number;
    size: number;
    type: string;
    name: string;
    assert?: number;
    default?: string;
    requiresActivation?: boolean;
    enum?: Array<{
        value: number;
        name: string;
    }>;
}
export interface FirstPartyTaeSchemaEvent {
    id: number;
    name: string;
    paramSize: number;
    fields: FirstPartyTaeSchemaField[];
    bankId: number;
    bankName: string;
    variant?: boolean;
    variantOf?: number;
    variantKind?: string;
}
export interface FirstPartyTaeSchemaBank {
    id: number;
    name: string;
    events: FirstPartyTaeSchemaEvent[];
}
export interface FirstPartyTaeSchemaDocument {
    package: string;
    schemaVersion: string;
    game: string;
    format: string;
    nativeFormatAuthority: boolean;
    contentDigest: string;
    eventCount: number;
    fieldCount: number;
    banks: FirstPartyTaeSchemaBank[];
}
export declare const FIRST_PARTY_TAE_SCHEMA: FirstPartyTaeSchemaDocument;
export declare const FIRST_PARTY_TAE_SCHEMA_METADATA: Readonly<{
    origin: "first-party";
    package: string;
    version: string;
    contentDigest: string;
    game: string;
    format: string;
    nativeFormatAuthority: boolean;
    bankCount: number;
    eventCount: number;
    fieldCount: number;
}>;
export declare function firstPartyTaeEventVariants(eventTypeId: number): FirstPartyTaeSchemaEvent[];
