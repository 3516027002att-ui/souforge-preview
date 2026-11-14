/**
 * Compact TAE event for action search results and compact action reads (#52): the event's exact address, index,
 * type, timing and decoded values. Field layout (offsets, sizes, enum tables), padding that holds its asserted
 * value, per-event source identity and the raw copy stay in the full read. Pages hold a fixed number of events,
 * independent of their content, so a search preview and the read_tae_events continuation number the same pages.
 *
 * Page size from three Sekiro character anibnds (c0000, c5080, c5400; 86,137 events): a 64-event compact page is
 * at most 30.9 KB with the `fieldName` alias (21.9 KB without it), well inside the 64 KiB tool-result bound.
 */
export declare const TAE_COMPACT_PAGE_SIZE = 64;
export interface TaeCompactField {
    name: string;
    /** Same value as `name`; the selector mutate_tae_event_fields accepts. */
    fieldName: string;
    value: string | number | boolean;
    /** Enum label, only when it is not just another spelling of value. */
    display?: string;
    /** Schema field index, only when the name repeats within the event (fieldName alone would be ambiguous). */
    index?: number;
    /** Padding kept because it does not hold its asserted value; not writable. */
    padding?: true;
}
export interface TaeCompactEvent {
    index: number;
    /** Exact event address for read_tae_events, mutations and insert templates. */
    address?: string;
    eventTypeId: number;
    typeName?: string;
    startFrame: number;
    endFrame: number;
    startTime: number;
    endTime: number;
    fields?: TaeCompactField[];
    decodeStatus?: 'partial' | 'unknown';
    /** Only when decoded fields do not represent the parameter body. */
    parameterBytesHex?: string;
    parameterBytesHexTruncated?: true;
    parameterByteLength?: number;
}
/** Either an indexed TaeEventSymbol (`index`, `uri`) or a read_tae_events snapshot (`eventIndex`, `address`). */
interface TaeEventLike {
    index?: number;
    eventIndex?: number;
    address?: string;
    uri?: string;
    eventTypeId: number;
    typeName?: string;
    startFrame: number;
    endFrame: number;
    startTime: number;
    endTime: number;
    fields?: Array<{
        name: string;
        value: string | number | boolean;
        displayValue?: string;
        index?: number;
        isPadding?: boolean;
        assert?: number;
        assertValid?: boolean;
    }>;
    decodeStatus?: 'decoded' | 'partial' | 'unknown';
    parameterBytesHex?: string;
}
export declare function compactTaeEvent(event: TaeEventLike): TaeCompactEvent;
export {};
