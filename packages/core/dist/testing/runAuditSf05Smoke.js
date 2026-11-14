/**
 * SF-05: Map Selection, Batch Transform, and Snapshot Reuse Smoke Runner.
 *
 * Dispatches to unit or native suites in runAuditMapSelectionSmoke.ts.
 */
import { runMapSelectionUnitTests, runMapSelectionNativeTests } from './runAuditMapSelectionSmoke.js';
function parseArgs() {
    const args = process.argv.slice(2);
    let layer = undefined;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--layer' && i + 1 < args.length) {
            layer = args[++i];
        }
    }
    return { layer };
}
async function main() {
    const { layer } = parseArgs();
    if (layer === 'unit') {
        await runMapSelectionUnitTests();
    }
    else if (layer === 'native') {
        await runMapSelectionNativeTests();
    }
    else {
        console.error(`Unknown or missing layer: "${layer}". Must specify --layer unit|native.`);
        process.exit(1);
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=runAuditSf05Smoke.js.map