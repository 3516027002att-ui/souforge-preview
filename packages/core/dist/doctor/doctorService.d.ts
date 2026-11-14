export type DoctorStatus = 'Pass' | 'Warn' | 'Fail';
export interface DoctorItem {
    key: string;
    title: string;
    status: DoctorStatus;
    message: string;
    details?: unknown;
    fixable: boolean;
    fixDescription?: string | null;
}
export interface DoctorReport {
    timestamp: string;
    overallStatus: DoctorStatus;
    detectedSekiroPath?: string | null;
    detectedModsPath?: string | null;
    items: DoctorItem[];
}
export interface AutoFixActionRecord {
    name: string;
    success: boolean;
    message: string;
}
export interface AutoFixResult {
    success: boolean;
    message: string;
    actions: AutoFixActionRecord[];
    sekiroPath?: string | null;
    modsPath?: string | null;
}
export interface DoctorOptions {
    sekiroPath?: string;
    modsPath?: string;
    doctorExecutablePath?: string;
}
export declare function runDoctorDiagnosis(options?: DoctorOptions): Promise<DoctorReport>;
export declare function runDoctorAutoFix(options?: DoctorOptions): Promise<AutoFixResult>;
