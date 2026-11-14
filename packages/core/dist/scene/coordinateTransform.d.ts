export type Matrix4 = number[];
export type Vec3 = [number, number, number];
export interface CoordinateProfile {
    profileId: string;
    units: 'native' | 'meters' | 'unknown';
    handedness: 'right' | 'left' | 'unknown';
    upAxis: 'x' | 'y' | 'z' | 'unknown';
    forwardAxis: string;
    eulerOrder: string;
    angleUnit: 'degrees' | 'radians';
    nativeToBlender: Matrix4;
    blenderToNative: Matrix4;
    profileHash: string;
}
export declare function identityMatrix4(): Matrix4;
export declare function assertMatrix4(matrix: readonly number[], name?: string): Matrix4;
export declare function multiplyMatrix4(left: readonly number[], right: readonly number[]): Matrix4;
export declare function invertMatrix4(input: readonly number[]): Matrix4;
export declare function matrixResidual(left: readonly number[], right: readonly number[]): number;
export declare function determinantLinear3(matrix: readonly number[]): number;
export declare function transformPoint(matrix: readonly number[], point: Vec3): Vec3;
export declare function transformNormal(matrix: readonly number[], normal: Vec3): Vec3;
export declare function convertNativeMatrixToBlender(profile: CoordinateProfile, nativeMatrix: readonly number[]): Matrix4;
export declare function convertBlenderMatrixToNative(profile: CoordinateProfile, blenderMatrix: readonly number[]): Matrix4;
export declare function createCoordinateProfile(input: Omit<CoordinateProfile, 'blenderToNative' | 'profileHash'>): CoordinateProfile;
export declare function assertTrsRepresentable(matrix: readonly number[]): {
    translation: Vec3;
    scale: Vec3;
    determinant: number;
};
export declare function reverseTriangleWinding(indices: readonly number[], matrix: readonly number[]): number[];
