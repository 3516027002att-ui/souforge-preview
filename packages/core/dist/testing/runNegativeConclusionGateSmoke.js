/**
 * 治理检查：`negativeConclusionAllowed` 只能由**查询级覆盖度来源**决定。
 *
 * 背景：这个字段在 5 个工具里被错误赋值过——它只表示“索引结构完整”或
 * “资源读全了”，却被调用方当成“查询结论可信”。结果是“没看见”被输出成
 * “没有”：参数化实体实参（X0_4）在引用图里不可见，`overall === 'complete'`
 * 却仍然允许否定。
 *
 * 规则（静态扫描 + 白名单）：
 * 1. 任何在工具输出对象里写 `negativeConclusionAllowed` 的模块，其赋值必须
 *    引用查询级覆盖度来源：
 *      - `conclusion.negativeConclusionAllowed`（buildQueryScopedNegativeConclusion 的结果）
 *      - `assessment` / `parameterizedEntityCoverage` / `blocksNegative`
 *      - `nativeSearch.complete` / `nativeSearchComplete`
 *      - 显式常量 `false`
 * 2. 直接透传整体完整性（`overall`、`coverageComplete`、`*.coverage.status`、
 *    `index.coverage.*` 等）一律失败。
 * 3. 已确认安全的调用点写进 `ALLOWLIST`，并附上理由；新增调用点必须自己
 *    证明是查询级来源，而不是把整体完整性改个名字。
 *
 * 这个检查必须能失败：`selfTest()` 用一段已知的旧写法（`overall === 'complete'`）
 * 断言扫描器会报错，再用一段合法写法断言通过。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const FIELD = 'negativeConclusionAllowed';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCAN_ROOTS = ['packages/core/src', 'packages/shared/src'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'output']);
const SKIP_FILE = /(?:\.test|\.d)\.ts$/u;
/** 测试夹具/冒烟脚本手工构造 DTO，不是工具输出；它们由单元测试自己断言。 */
const SKIP_PREFIXES = ['packages/core/src/testing/'];
/** 查询级来源的标记：出现任意一个就视为“引用了查询级覆盖度”。 */
const SANCTIONED_SOURCES = [
    { token: 'conclusion.negativeConclusionAllowed', reason: 'buildQueryScopedNegativeConclusion 的查询级结论' },
    { token: 'buildQueryScopedNegativeConclusion', reason: '查询级结论构造器' },
    { token: 'applyReferenceQueryConclusion', reason: '关联页只接受查询级结论' },
    { token: 'assessment.', reason: 'parameterizedEntityCoverage 的查询范围评估' },
    { token: 'parameterizedEntityCoverage', reason: '参数化实参的查询范围评估' },
    { token: 'blocksNegative', reason: '查询范围内是否存在不可归属实参' },
    { token: 'parameterizedBlocksNegative', reason: '查询范围内是否存在不可归属的实体实参' },
    { token: 'blockedReasons.length === 0', reason: '本次查询的 blockedReasons 为空才允许否定' },
    { token: 'nativeSearch.complete', reason: '本次原生搜索自己的覆盖度' },
    { token: 'nativeSearchComplete', reason: '本次原生搜索自己的覆盖度' },
    { token: 'queryScope', reason: '查询自己的来源域覆盖证书' }
];
/**
 * 白名单：调用点 + 赋值表达式 + 为什么它仍然是查询级的。
 * 键是相对仓库根的 POSIX 路径；表达式按源码原文（去空白）比较。
 */
const ALLOWLIST = [
    {
        file: 'packages/core/src/ai/toolRegistrySupport.ts',
        expression: 'result.complete',
        reason: 'searchScopedNativeEvents 的 selected-source 覆盖：本次查询选中的那个文件是否读全；数字查询另有显式 false 覆盖，不涉及工作区整体完整性'
    },
    {
        file: 'packages/core/src/references/referencePageProjection.ts',
        expression: 'coverage.negativeConclusionAllowed',
        reason: '纯投影：复制已经由查询级结论写入的字段，不重新判定；判定发生在 buildCoverage（显式 false）和 applyReferenceQueryConclusion'
    },
    {
        file: 'packages/core/src/ai/tools/search_events.ts',
        expression: 'input.structuralNegativeAllowed',
        reason: 'buildNegativeConclusion 的 structuralNegativeAllowed 是本次查询自己构建的事件参数索引的结构完整性（查询范围就是该索引），参数化评估在同一函数里先行把否定降级为 false'
    }
];
function normalizeExpression(text) {
    return text.replace(/\s+/gu, '');
}
function walkSources(root) {
    const files = [];
    const walk = (directory) => {
        for (const item of readdirSync(directory, { withFileTypes: true })) {
            if (item.isDirectory()) {
                if (SKIP_DIRECTORIES.has(item.name))
                    continue;
                walk(join(directory, item.name));
                continue;
            }
            if (!item.name.endsWith('.ts') || SKIP_FILE.test(item.name))
                continue;
            files.push(join(directory, item.name));
        }
    };
    for (const scanRoot of SCAN_ROOTS) {
        try {
            walk(resolve(root, scanRoot));
        }
        catch {
            // A checkout without that workspace is not a failure; the other root still runs.
        }
    }
    return files.sort();
}
function localInitializer(sourceFile, name) {
    let found;
    const visit = (node) => {
        if (found !== undefined)
            return;
        if (ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.name.text === name
            && node.initializer !== undefined) {
            found = node.initializer;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}
function sanctionedReason(expression) {
    return SANCTIONED_SOURCES.find((entry) => expression.includes(entry.token))?.reason;
}
/** 扫描一段源码；导出以便自测。返回违规点与放行点。 */
export function scanSource(file, text) {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations = [];
    const allowed = [];
    const allowlist = ALLOWLIST.find((entry) => entry.file === file);
    const record = (node, expression) => {
        if (expression === undefined) {
            violations.push({
                file,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
                expression: '(unresolved)',
                reason: `无法解析 ${FIELD} 的赋值来源`
            });
            return;
        }
        const text = expression.getText(sourceFile);
        const normalized = normalizeExpression(text);
        if (normalized === 'false') {
            allowed.push({ file, expression: text, source: 'sanctioned', reason: '显式常量 false' });
            return;
        }
        const sanctioned = sanctionedReason(text);
        if (sanctioned !== undefined) {
            allowed.push({ file, expression: text, source: 'sanctioned', reason: sanctioned });
            return;
        }
        if (allowlist !== undefined && normalizeExpression(allowlist.expression) === normalized) {
            allowed.push({ file, expression: text, source: 'allowlist', reason: allowlist.reason });
            return;
        }
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push({
            file,
            line,
            expression: text,
            reason: `把 ${FIELD} 赋成整体完整性/未归类来源「${text}」；必须引用查询级覆盖度来源或显式 false`
        });
    };
    const visit = (node) => {
        if (ts.isPropertyAssignment(node)
            && ((ts.isIdentifier(node.name) && node.name.text === FIELD)
                || (ts.isStringLiteral(node.name) && node.name.text === FIELD))) {
            record(node, node.initializer);
        }
        else if (ts.isShorthandPropertyAssignment(node) && node.name.text === FIELD) {
            record(node, localInitializer(sourceFile, FIELD));
        }
        else if (ts.isBinaryExpression(node)
            && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isPropertyAccessExpression(node.left)
            && node.left.name.text === FIELD) {
            record(node, node.right);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return { violations, allowed };
}
const GOOD_SNIPPET = `const conclusion = buildQueryScopedNegativeConclusion(input);
return { negativeConclusionAllowed: conclusion.negativeConclusionAllowed };`;
const BAD_SNIPPET = `const overall = 'complete';
return { negativeConclusionAllowed: overall === 'complete' };`;
const BAD_SHORTHAND = `const negativeConclusionAllowed = coverageComplete;
return { negativeConclusionAllowed };`;
/* ---- 规则 2：完整性声明字段（has760 那一族） -------------------------------
 * `has760: range760.length > 0` 与 `negativeConclusionAllowed: overall === 'complete'`
 * 是同一个病：字段名承诺的是一个否定结论，证据却可能只读了一半。分类器把
 * 「不存在的断言」收敛成两类可机检的形状：
 *   1. 布尔/计数声明必须在同一对象里带自己的 `…Complete`（或同值为 null）；
 *   2. 聚合计数不得裸奔：要么同对象有 `…Semantics` 口径说明，要么写成分段计数。
 * 范围只覆盖会产出否定结论的字段，避免把普通计数（eventCount 之类）也套进来。
 */
const GUARDED_CLAIM_FIELDS = new Map([
    ['has760', '760 的存在性（否定结论）'],
    ['has760Count', '760 的聚合计数'],
    ['bulletActionCount', 'Bullet 动作聚合计数'],
    ['spEffectActionCount', 'SpEffect 动作聚合计数'],
    ['uniqueJudgeCount', '唯一判定的聚合计数'],
    ['judgeUnique', '判定唯一性（否定性判断）']
]);
/**
 * 聚合计数比布尔更严：一个口径说明不等于把数字拆开。`has760Count: 0` 在 partial 扫描里
 * 必须能自己说清「其中多少是没读全」，所以它的值本身要携带 complete/partial 含义
 * （分段计数构造器或 null），不能靠旁边写一句解释过关。
 */
const COUNT_CLAIM_FIELDS = new Set(['has760Count', 'bulletActionCount', 'spEffectActionCount', 'uniqueJudgeCount']);
const COMPLETION_SUFFIXES = ['Complete', 'Known', 'Status'];
/** 表达式里出现这些词，说明值本身已经是「可判定/未知」的表达，而不是裸的肯定。 */
const COMPLETION_TOKENS = /(?:complete|partial|unknown|null)/iu;
function objectLiteralPropertyNames(node) {
    const names = new Set();
    for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
            const name = property.name;
            if (ts.isIdentifier(name))
                names.add(name.text);
            else if (ts.isStringLiteral(name))
                names.add(name.text);
        }
    }
    return names;
}
/** 扫描一段源码里的完整性声明；导出以便自测。 */
export function scanCompletenessClaims(file, text) {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const violations = [];
    const visit = (node) => {
        if (ts.isObjectLiteralExpression(node)) {
            const names = objectLiteralPropertyNames(node);
            for (const property of node.properties) {
                const fieldName = ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
                    ? (ts.isIdentifier(property.name) ? property.name.text
                        : ts.isStringLiteral(property.name) ? property.name.text : undefined)
                    : undefined;
                if (fieldName === undefined || !GUARDED_CLAIM_FIELDS.has(fieldName))
                    continue;
                const expressionText = ts.isPropertyAssignment(property)
                    ? property.initializer.getText(sourceFile)
                    : fieldName;
                const hasOwnCompletion = COMPLETION_SUFFIXES.some((suffix) => names.has(`${fieldName}${suffix}`));
                const carriesCompleteness = COMPLETION_TOKENS.test(expressionText);
                // 布尔声明：自己的完成度字段 或 值本身表达「未知」即可。
                // 聚合计数：必须值本身携带完成度（分段构造器/partial/null），旁边的口径说明不算数。
                const accepted = COUNT_CLAIM_FIELDS.has(fieldName)
                    ? carriesCompleteness || /^\s*null\s*$/u.test(expressionText)
                    : hasOwnCompletion || carriesCompleteness;
                if (accepted)
                    continue;
                violations.push({
                    file,
                    line: sourceFile.getLineAndCharacterOfPosition(property.getStart(sourceFile)).line + 1,
                    field: fieldName,
                    expression: expressionText.replace(/\s+/gu, ' '),
                    reason: COUNT_CLAIM_FIELDS.has(fieldName)
                        ? `${fieldName}（${GUARDED_CLAIM_FIELDS.get(fieldName)}）是一个裸计数：`
                            + 'partial 扫描时「0」会被读成确定的「一个都没有」。值本身必须携带完成度（分段计数或 null）。'
                        : `${fieldName}（${GUARDED_CLAIM_FIELDS.get(fieldName)}）没有完成度限定：`
                            + `同一对象里既没有 ${fieldName}Complete/Known/Status，表达式本身也没有 null/unknown/complete 的含义 —— `
                            + '未读全的扫描会被读成确定的否定。'
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return violations;
}
const CLAIM_GOOD_SNIPPET = `return {
  has760: eventsComplete ? range760.length > 0 : null,
  has760Complete: eventsComplete,
  range760
};`;
/** 旧写法原文：没有自己的完成度字段，表达式也是裸的「长度 > 0」。 */
const CLAIM_BAD_SNIPPET = `return {
  has760: range760.length > 0,
  range760,
  eventsComplete
};`;
const CLAIM_BAD_AGGREGATE = `const summary = {
  has760Count: ranked.filter((candidate) => candidate.has760).length,
  countSemantics: '说明写在旁边也不算：数字本身没有拆开'
};`;
const CLAIM_GOOD_AGGREGATE = `const summary = {
  has760Count: observedCountByCompleteness(ranked, (candidate) => candidate.eventsComplete, (candidate) => candidate.has760 === true),
  countSemantics: 'complete = 已判定; incomplete = 未读全'
};`;
const CLAIM_BAD_JUDGE_UNIQUE = `return { ...candidate, judgeUnique };`;
const CLAIM_GOOD_JUDGE_UNIQUE = `return { ...candidate, judgeUnique, judgeUniqueComplete };`;
/** 自测：检查必须能对旧写法报红、对新写法放行。 */
function selfTest() {
    const problems = [];
    const good = scanSource('good.ts', GOOD_SNIPPET);
    if (good.violations.length > 0) {
        problems.push(`合法写法被误报：${good.violations.map((item) => item.expression).join(', ')}`);
    }
    const bad = scanSource('bad.ts', BAD_SNIPPET);
    if (bad.violations.length !== 1) {
        problems.push(`旧写法 overall === 'complete' 没有被拦下（violations=${bad.violations.length}）`);
    }
    const shorthand = scanSource('shorthand.ts', BAD_SHORTHAND);
    if (shorthand.violations.length !== 1) {
        problems.push(`简写 negativeConclusionAllowed（整体完整性变量）没有被拦下（violations=${shorthand.violations.length}）`);
    }
    // 规则 2：完整性声明字段。合法写法必须放行，旧写法必须各报一条。
    const claimGood = scanCompletenessClaims('claim-good.ts', CLAIM_GOOD_SNIPPET);
    if (claimGood.length > 0) {
        problems.push(`合法的 has760 写法被误报：${claimGood.map((item) => item.expression).join(', ')}`);
    }
    const claimBad = scanCompletenessClaims('claim-bad.ts', CLAIM_BAD_SNIPPET);
    if (claimBad.length !== 1 || claimBad[0]?.field !== 'has760') {
        problems.push(`旧写法 has760: range760.length > 0 没有被拦下（violations=${claimBad.length}）`);
    }
    const claimBadAggregate = scanCompletenessClaims('claim-bad-aggregate.ts', CLAIM_BAD_AGGREGATE);
    if (claimBadAggregate.length !== 1 || claimBadAggregate[0]?.field !== 'has760Count') {
        problems.push(`裸聚合计数 has760Count 没有被拦下（violations=${claimBadAggregate.length}）`);
    }
    const claimGoodAggregate = scanCompletenessClaims('claim-good-aggregate.ts', CLAIM_GOOD_AGGREGATE);
    if (claimGoodAggregate.length > 0) {
        problems.push(`合法的分段聚合计数被误报：${claimGoodAggregate.map((item) => item.expression).join(', ')}`);
    }
    const claimBadJudgeUnique = scanCompletenessClaims('claim-bad-judge-unique.ts', CLAIM_BAD_JUDGE_UNIQUE);
    if (claimBadJudgeUnique.length !== 1) {
        problems.push(`裸 judgeUnique 没有被拦下（violations=${claimBadJudgeUnique.length}）`);
    }
    const claimGoodJudgeUnique = scanCompletenessClaims('claim-good-judge-unique.ts', CLAIM_GOOD_JUDGE_UNIQUE);
    if (claimGoodJudgeUnique.length > 0) {
        problems.push(`带 judgeUniqueComplete 的写法被误报：${claimGoodJudgeUnique.map((item) => item.expression).join(', ')}`);
    }
    return problems;
}
function main() {
    const problems = selfTest();
    if (problems.length > 0) {
        console.error('NEGATIVE_CONCLUSION_GATE_SELFTEST_FAILED');
        for (const problem of problems)
            console.error(`  - ${problem}`);
        process.exitCode = 1;
        return;
    }
    const violations = [];
    const allowed = [];
    const claimViolations = [];
    const files = walkSources(REPO_ROOT);
    for (const file of files) {
        const relativePath = relative(REPO_ROOT, file).replaceAll('\\', '/');
        if (SKIP_PREFIXES.some((prefix) => relativePath.startsWith(prefix)))
            continue;
        const text = readFileSync(file, 'utf8');
        const scanned = scanSource(relativePath, text);
        violations.push(...scanned.violations);
        allowed.push(...scanned.allowed);
        claimViolations.push(...scanCompletenessClaims(relativePath, text));
    }
    console.log(`NEGATIVE_CONCLUSION_GATE scanned=${files.length} assignments=${allowed.length + violations.length}`
        + ` completenessClaims=${claimViolations.length}`);
    for (const site of allowed) {
        console.log(`  ok   ${site.file}: ${site.expression} [${site.source}] ${site.reason}`);
    }
    if (violations.length > 0) {
        console.error(`NEGATIVE_CONCLUSION_GATE_FAILED violations=${violations.length}`);
        for (const violation of violations) {
            console.error(`  FAIL ${violation.file}:${violation.line}: ${violation.reason}`);
        }
        process.exitCode = 1;
        return;
    }
    if (claimViolations.length > 0) {
        console.error(`NEGATIVE_CONCLUSION_GATE_FAILED completenessClaims=${claimViolations.length}`);
        for (const claim of claimViolations) {
            console.error(`  FAIL ${claim.file}:${claim.line}: ${claim.reason}`);
        }
        process.exitCode = 1;
        return;
    }
    console.log('NEGATIVE_CONCLUSION_GATE passed');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
//# sourceMappingURL=runNegativeConclusionGateSmoke.js.map