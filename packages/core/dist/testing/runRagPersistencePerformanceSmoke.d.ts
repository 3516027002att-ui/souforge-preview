/**
 * 有界 RAG SQLite/FTS 持久化计时。
 *
 * 这是诊断/回归，不是 native 或 Electron 启动证明：在临时 SQLite 中把
 * synthetic PARAM 行按桌面层相同的 512 行批次写入，记录每个事务耗时，并
 * 验证增量更新不会删除同一 source 的未变化 chunk。默认只写 5000 行；需要
 * 复核真实 50295 行量时显式设置 SF_RAG_PERF_ROWS=50295，避免普通回归误占
 * 满桌面/磁盘资源。
 */
export {};
