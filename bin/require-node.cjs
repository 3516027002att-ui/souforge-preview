'use strict';
// Node 22.x is the validated runtime; refuse earlier versions outright and warn on later ones.
const major = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(major) || major < 22) {
  console.error(`需要 Node.js 22 或更新版本，当前 ${process.version}。`);
  process.exit(1);
}
if (major > 22) {
  console.error(`提示：本包在 Node 22.22.0 上验证；当前 ${process.version} 未经验证。`);
}
