import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
function resolveDoctorExecutable(customPath) {
    if (customPath && existsSync(customPath)) {
        return { executable: resolve(customPath), args: [] };
    }
    // 1. 尝试当前工作目录或上层打包工具路径
    const candidates = [
        join(process.cwd(), 'release', 'tools', 'SoulForge.Doctor.exe'),
        join(process.cwd(), 'bridge', 'SoulForge.Doctor', 'bin', 'Release', 'net6.0', 'win-x64', 'publish', 'SoulForge.Doctor.exe'),
        join(process.cwd(), 'bridge', 'SoulForge.Doctor', 'bin', 'Debug', 'net6.0', 'win-x64', 'SoulForge.Doctor.exe')
    ];
    for (const c of candidates) {
        if (existsSync(c)) {
            return { executable: c, args: [] };
        }
    }
    return null;
}
export async function runDoctorDiagnosis(options = {}) {
    const doctor = resolveDoctorExecutable(options.doctorExecutablePath);
    if (doctor) {
        const args = [...doctor.args, '--json'];
        if (options.sekiroPath)
            args.push('--game-dir', options.sekiroPath);
        if (options.modsPath)
            args.push('--mods-dir', options.modsPath);
        const proc = spawnSync(doctor.executable, args, {
            encoding: 'utf8',
            windowsHide: true
        });
        if (proc.stdout) {
            try {
                const parsed = JSON.parse(proc.stdout.trim());
                return parsed;
            }
            catch {
                // Fallthrough
            }
        }
    }
    // 纯 Node 兜底快速诊断
    return fallbackNodeDiagnosis(options);
}
export async function runDoctorAutoFix(options = {}) {
    const doctor = resolveDoctorExecutable(options.doctorExecutablePath);
    if (doctor) {
        const args = [...doctor.args, '--fix', '--json'];
        if (options.sekiroPath)
            args.push('--game-dir', options.sekiroPath);
        if (options.modsPath)
            args.push('--mods-dir', options.modsPath);
        const proc = spawnSync(doctor.executable, args, {
            encoding: 'utf8',
            windowsHide: true
        });
        if (proc.stdout) {
            try {
                const parsed = JSON.parse(proc.stdout.trim());
                return parsed;
            }
            catch {
                // Fallthrough
            }
        }
    }
    return {
        success: false,
        message: '未能启动 SoulForge.Doctor 修复程序',
        actions: []
    };
}
function fallbackNodeDiagnosis(options) {
    const items = [];
    const defaultSekiro = options.sekiroPath || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Sekiro';
    const sekiroExists = existsSync(join(defaultSekiro, 'sekiro.exe'));
    items.push({
        key: 'sekiro_game_path',
        title: '《只狼》游戏安装路径',
        status: sekiroExists ? 'Pass' : 'Warn',
        message: sekiroExists ? `已定位只狼游戏安装目录: ${defaultSekiro}` : '未找到只狼游戏目录，请指定路径',
        fixable: false
    });
    const oodleExists = sekiroExists && existsSync(join(defaultSekiro, 'oo2core_6_win64.dll'));
    items.push({
        key: 'oodle_library',
        title: 'Oodle 动态解密库 (oo2core_6_win64.dll)',
        status: oodleExists ? 'Pass' : 'Warn',
        message: oodleExists ? '已在只狼目录中找到合法的 oo2core_6_win64.dll' : '未找到 oo2core_6_win64.dll',
        fixable: true,
        fixDescription: '自动从只狼游戏目录安全复制 oo2core_6_win64.dll'
    });
    return {
        timestamp: new Date().toISOString(),
        overallStatus: sekiroExists ? 'Pass' : 'Warn',
        detectedSekiroPath: sekiroExists ? defaultSekiro : null,
        detectedModsPath: sekiroExists ? join(defaultSekiro, 'mods') : null,
        items
    };
}
//# sourceMappingURL=doctorService.js.map