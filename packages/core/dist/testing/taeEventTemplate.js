/**
 * Development/validation-only parser for the public DSAnimStudio SDT XML.
 *
 * Production TAE reads use `FirstParty.TaeFirstPartySchema` in the Bridge.
 * This parser exists only to compare the checked-in first-party registry with
 * a locally available reference during development; it is deliberately kept
 * below `src/testing` and is never exported by the production barrel.
 */
import { readFile } from 'node:fs/promises';
import { SaxesParser } from 'saxes';
const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 10_000;
const MAX_FIELDS_PER_EVENT = 256;
export const TAE_EVENT_FIELD_KINDS = ['s32', 'u32', 'f32', 's16', 'u16', 's8', 'u8', 'b'];
function templateError(code, message) {
    const error = new Error(message);
    error.name = code;
    return error;
}
function attributeValue(tag, name) {
    const value = tag.attributes[name];
    return typeof value === 'string' ? value : undefined;
}
export function parseTaeEventTemplateXml(xml) {
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
        throw templateError('TAE_TEMPLATE_DTD_FORBIDDEN', 'TAE 模板禁止 DTD 与实体声明。');
    }
    const byEventTypeId = new Map();
    const diagnostics = [];
    let currentEvent;
    let currentEventId = 0;
    let eventCount = 0;
    let parseFailure;
    const parser = new SaxesParser({ xmlns: false });
    parser.on('doctype', () => {
        parseFailure = templateError('TAE_TEMPLATE_DTD_FORBIDDEN', 'TAE 模板禁止 DTD。');
    });
    parser.on('opentag', (tag) => {
        if (tag.name === 'event') {
            const idText = attributeValue(tag, 'id');
            const name = attributeValue(tag, 'name') ?? '';
            if (idText === undefined || !/^-?\d+$/u.test(idText)) {
                parseFailure = templateError('TAE_TEMPLATE_EVENT_ID_INVALID', 'TAE 模板事件缺少合法 id。');
                return;
            }
            currentEventId = Number(idText);
            if (eventCount >= MAX_EVENTS) {
                parseFailure = templateError('TAE_TEMPLATE_TOO_MANY_EVENTS', 'TAE 模板事件数超出安全上限。');
                return;
            }
            if (byEventTypeId.has(currentEventId)) {
                diagnostics.push({
                    severity: 'info',
                    code: 'TAE_TEMPLATE_DUPLICATE_EVENT_ID',
                    message: `TAE 模板事件 id ${currentEventId} 重复（${byEventTypeId.get(currentEventId)?.name ?? ''} / ${name}）。先见者优先。`
                });
                currentEvent = undefined;
                return;
            }
            currentEvent = { name, fields: [] };
            byEventTypeId.set(currentEventId, currentEvent);
            eventCount += 1;
            return;
        }
        if (currentEvent && TAE_EVENT_FIELD_KINDS.includes(tag.name)) {
            const fieldName = (attributeValue(tag, 'name') ?? '').trim();
            if (!fieldName)
                return;
            if (currentEvent.fields.length >= MAX_FIELDS_PER_EVENT) {
                parseFailure = templateError('TAE_TEMPLATE_TOO_MANY_FIELDS', `TAE 模板事件 ${currentEventId} 字段数超出安全上限。`);
                return;
            }
            currentEvent.fields.push({ name: fieldName, kind: tag.name, slotSize: 4 });
        }
    });
    parser.on('error', (error) => { parseFailure = error; });
    try {
        parser.write(xml).close();
    }
    catch (error) {
        parseFailure = error instanceof Error ? error : new Error('invalid XML');
    }
    if (parseFailure)
        throw templateError('TAE_TEMPLATE_XML_INVALID', parseFailure.message);
    if (byEventTypeId.size === 0)
        throw templateError('TAE_TEMPLATE_EMPTY', 'TAE 模板不含任何事件词条。');
    return { ok: true, byEventTypeId, eventCount, diagnostics };
}
export async function readTaeEventTemplateFile(path) {
    const diagnostics = [];
    let xml;
    try {
        const buffer = await readFile(path);
        if (buffer.byteLength > MAX_TEMPLATE_BYTES) {
            diagnostics.push({ severity: 'error', code: 'TAE_TEMPLATE_TOO_LARGE', message: `TAE 模板 ${path} 超出 2MiB 上限，忽略。` });
            return { ok: false, byEventTypeId: new Map(), eventCount: 0, diagnostics };
        }
        xml = buffer.toString('utf8');
    }
    catch (error) {
        diagnostics.push({ severity: 'error', code: 'TAE_TEMPLATE_READ_FAILED', message: `TAE 模板读取失败：${error instanceof Error ? error.message : String(error)}` });
        return { ok: false, byEventTypeId: new Map(), eventCount: 0, diagnostics };
    }
    try {
        const parsed = parseTaeEventTemplateXml(xml);
        return { ...parsed, diagnostics: [...diagnostics, ...parsed.diagnostics] };
    }
    catch (error) {
        diagnostics.push({ severity: 'error', code: 'TAE_TEMPLATE_PARSE_FAILED', message: `TAE 模板解析失败：${error instanceof Error ? error.message : String(error)}` });
        return { ok: false, byEventTypeId: new Map(), eventCount: 0, diagnostics };
    }
}
//# sourceMappingURL=taeEventTemplate.js.map