'use strict';
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error(`此预览包需要 Windows x64 与 x64 版 Node.js，当前为 ${process.platform}/${process.arch}。`);
  process.exit(1);
}
const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(process.versions.node);
if (!version || Number(version[1]) !== 22 || Number(version[2]) < 22 || process.versions.modules !== "127") {
  console.error(`此预览包需要 Node.js 22.22.0 或更新的 22.x（ABI 127），当前为 ${process.version}（ABI ${process.versions.modules}）。`);
  process.exit(1);
}
try {
  const Database = require('../node_modules/better-sqlite3');
  const database = new Database(':memory:');
  try {
    if (database.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite self-check failed');
  } finally {
    database.close();
  }
} catch (error) {
  console.error(`SQLITE_BINDING_UNAVAILABLE: 无法加载随包的 SQLite；请核对 Node.js 版本和安装包。\n${error.message}`);
  process.exit(1);
}
