export function isCharacterPreviewBundle(value) {
    if (!isRecord(value)
        || !isNonNegativeInteger(value.meshCount)
        || !isNonNegativeInteger(value.vertexCount)
        || !isNonNegativeInteger(value.boneCount)
        || typeof value.leaderModelId !== 'string'
        || !Array.isArray(value.models)
        || (value.assemblyMode !== undefined
            && value.assemblyMode !== 'explicit'
            && value.assemblyMode !== 'compatibility-preview')
        || (value.assemblyParts !== undefined
            && (!Array.isArray(value.assemblyParts)
                || !value.assemblyParts.every((part) => typeof part === 'string'))))
        return false;
    return value.models.every((candidate) => {
        if (!isRecord(candidate)
            || typeof candidate.modelId !== 'string'
            || !isNonNegativeInteger(candidate.meshCount)
            || !isNonNegativeInteger(candidate.boneCount)
            || !Array.isArray(candidate.meshes)
            || !Array.isArray(candidate.bones)
            || (candidate.bindingBones !== undefined
                && (!Array.isArray(candidate.bindingBones)
                    || !candidate.bindingBones.every(isPreviewBone)))
            || (candidate.bindingBoneMap !== undefined
                && (!Array.isArray(candidate.bindingBoneMap)
                    || !candidate.bindingBoneMap.every((index) => Number.isInteger(index) && index >= -1)))
            || !isRecord(candidate.entry)
            || (candidate.texturePreviewToken !== undefined && typeof candidate.texturePreviewToken !== 'string')
            || (candidate.texturePreviews !== undefined
                && (!Array.isArray(candidate.texturePreviews)
                    || !candidate.texturePreviews.every(isPreviewTexture))))
            return false;
        const entry = candidate.entry;
        if (!isNonNegativeInteger(entry.index)
            || !Number.isInteger(entry.id)
            || typeof entry.name !== 'string'
            || !isNonNegativeInteger(entry.duplicateOrdinal)
            || typeof entry.contentHash !== 'string')
            return false;
        if (candidate.meshes.length !== candidate.meshCount || candidate.bones.length !== candidate.boneCount)
            return false;
        if ((candidate.bindingBones === undefined) !== (candidate.bindingBoneMap === undefined))
            return false;
        if (candidate.bindingBones && candidate.bindingBoneMap) {
            const maxSourceIndex = candidate.bindingBones.reduce((max, bone) => Math.max(max, bone.index), -1);
            if (candidate.bindingBoneMap.length <= maxSourceIndex)
                return false;
        }
        return candidate.meshes.every(isPreviewMesh) && candidate.bones.every(isPreviewBone);
    });
}
function isPreviewMesh(value) {
    if (!isRecord(value)
        || !isNonNegativeInteger(value.meshIndex)
        || (value.materialIndex !== undefined && !Number.isInteger(value.materialIndex))
        || !isNonNegativeInteger(value.vertexCount)
        || (value.indexSize !== 16 && value.indexSize !== 32)
        || typeof value.positionsBase64 !== 'string'
        || typeof value.indicesBase64 !== 'string'
        || (value.cullBackfaces !== undefined && typeof value.cullBackfaces !== 'boolean')
        || (value.skinningMode !== 'weighted' && value.skinningMode !== 'rigid' && value.skinningMode !== 'static')
        || (value.boneIndexSpace !== 'flver-global' && value.boneIndexSpace !== 'none')
        || (value.skinningTransformMode !== undefined
            && value.skinningTransformMode !== 'absolute'
            && value.skinningTransformMode !== 'delta')
        || (value.vertexColorStatus !== undefined && !isPreviewVertexColorStatus(value.vertexColorStatus))
        || (value.positionStatus !== undefined && !isPreviewVertexColorStatus(value.positionStatus))
        || (value.normalStatus !== undefined && !isPreviewVertexColorStatus(value.normalStatus))
        || (value.tangentStatus !== undefined && !isPreviewVertexColorStatus(value.tangentStatus))
        || (value.bitangentStatus !== undefined && !isPreviewVertexColorStatus(value.bitangentStatus))
        || (value.renderMode !== undefined
            && value.renderMode !== 'surface'
            && value.renderMode !== 'projected-decal'
            && value.renderMode !== 'compatibility-projected'))
        return false;
    const optionalStrings = [
        'uvsBase64',
        'normalsBase64',
        'positionFailure',
        'normalFailure',
        'vertexColorFailure',
        'tangentFailure',
        'bitangentFailure',
        'vertexAlphaBase64',
        'boneWeightsBase64',
        'boneIndicesBase64',
        'sourceBoneIndicesBase64',
        'skeletonId'
    ];
    if (!optionalStrings.every((key) => value[key] === undefined || typeof value[key] === 'string'))
        return false;
    if (value.uvSetsBase64 !== undefined
        && (!Array.isArray(value.uvSetsBase64)
            || !value.uvSetsBase64.every((set) => typeof set === 'string')))
        return false;
    if (value.vertexColorDiagnostics !== undefined
        && (!Array.isArray(value.vertexColorDiagnostics)
            || !value.vertexColorDiagnostics.every(isPreviewVertexColorDiagnostic)))
        return false;
    for (const key of ['positionDiagnostics', 'normalDiagnostics']) {
        if (value[key] !== undefined && (!Array.isArray(value[key]) || !value[key].every((member) => isPreviewVector3Diagnostic(member, key === 'normalDiagnostics'))))
            return false;
    }
    for (const key of ['tangentDiagnostics', 'bitangentDiagnostics']) {
        if (value[key] !== undefined && (!Array.isArray(value[key]) || !value[key].every(isPreviewVector4Diagnostic)))
            return false;
    }
    return ['projectionTextureName', 'projectionTexturePreviewToken', 'projectionTextureColorSpace']
        .every((key) => value[key] === undefined || value[key] === null || typeof value[key] === 'string');
}
function isPreviewVertexColorStatus(value) {
    return value === 'absent'
        || value === 'decoded'
        || value === 'unsupported'
        || value === 'truncated'
        || value === 'invalid';
}
function isPreviewVertexColorDiagnostic(value) {
    if (!isRecord(value)
        || !isNonNegativeInteger(value.memberOrdinal)
        || !isNonNegativeInteger(value.memberIndex)
        || !isNonNegativeInteger(value.layoutType)
        || !isNonNegativeInteger(value.vertexBufferIndex)
        || !isNonNegativeInteger(value.bufferLayoutIndex)
        || !isNonNegativeInteger(value.structOffset)
        || typeof value.rgbaBase64 !== 'string')
        return false;
    return (value.layoutTypeName === 'Float4' && value.layoutType === 3)
        || (value.layoutTypeName === 'Color' && value.layoutType === 16)
        || (value.layoutTypeName === 'UByte4Norm' && value.layoutType === 19);
}
function isPreviewVector3Diagnostic(value, normal) {
    if (!isRecord(value)
        || !['memberOrdinal', 'memberIndex', 'layoutType', 'vertexBufferIndex', 'bufferLayoutIndex', 'structOffset'].every((key) => isNonNegativeInteger(value[key]))
        || typeof value.xyzBase64 !== 'string'
        || (value.normalWBase64 !== undefined && (!normal || typeof value.normalWBase64 !== 'string')))
        return false;
    const layouts = normal
        ? { Float3: 2, Float4: 3, Color: 16, UByte4: 17, UByte4Norm: 19, Byte4Norm: 20, Short4Norm: 26, Half4: 46, Byte4E: 47 }
        : { Float3: 2, Float4: 3 };
    return typeof value.layoutTypeName === 'string' && layouts[value.layoutTypeName] === value.layoutType;
}
function isPreviewVector4Diagnostic(value) {
    return isRecord(value)
        && ['memberOrdinal', 'memberIndex', 'layoutType', 'vertexBufferIndex', 'bufferLayoutIndex', 'structOffset'].every((key) => isNonNegativeInteger(value[key]))
        && typeof value.xyzwBase64 === 'string'
        && ((value.layoutTypeName === 'Float4' && value.layoutType === 3)
            || (value.layoutTypeName === 'Color' && value.layoutType === 16)
            || (value.layoutTypeName === 'UByte4' && value.layoutType === 17)
            || (value.layoutTypeName === 'UByte4Norm' && value.layoutType === 19)
            || (value.layoutTypeName === 'Byte4Norm' && value.layoutType === 20)
            || (value.layoutTypeName === 'Short4Norm' && value.layoutType === 26)
            || (value.layoutTypeName === 'Byte4E' && value.layoutType === 47));
}
function isPreviewTexture(value) {
    return isRecord(value)
        && isNonNegativeInteger(value.materialIndex)
        && typeof value.textureName === 'string'
        && typeof value.texturePreviewToken === 'string'
        && isPositiveInteger(value.width)
        && isPositiveInteger(value.height)
        && typeof value.colorSpace === 'string'
        && (value.alphaMode === undefined || value.alphaMode === 'opaque' || value.alphaMode === 'cutout')
        && (value.albedo2 === undefined || isPreviewTextureLayer(value.albedo2))
        && (value.normal2 === undefined || isPreviewTextureLayer(value.normal2))
        && (value.diffuseBlend === undefined || isPreviewDiffuseBlend(value.diffuseBlend))
        && ['normalTextureName', 'normalTexturePreviewToken', 'normalTextureColorSpace',
            'metalnessTextureName', 'metalnessTexturePreviewToken', 'metalnessTextureColorSpace',
            'mask1TextureName', 'mask1TexturePreviewToken', 'mask1TextureColorSpace']
            .every((key) => value[key] === undefined || typeof value[key] === 'string');
}
function isPreviewTextureLayer(value) {
    return isRecord(value)
        && typeof value.textureName === 'string'
        && typeof value.texturePreviewToken === 'string'
        && isPositiveInteger(value.width)
        && isPositiveInteger(value.height)
        && typeof value.colorSpace === 'string';
}
function isPreviewDiffuseBlend(value) {
    return isRecord(value)
        && value.mode === 'multiply'
        && isNonNegativeInteger(value.albedo2UvIndex)
        && isNonNegativeInteger(value.blendMaskUvIndex)
        && typeof value.undefinedBlendMaskValue === 'number'
        && Number.isFinite(value.undefinedBlendMaskValue)
        && typeof value.enableTextureAlpha === 'boolean'
        && typeof value.multiplyBlendMaskByAlbedo2Alpha === 'boolean';
}
function isPreviewBone(value) {
    return isRecord(value)
        && isNonNegativeInteger(value.index)
        && typeof value.name === 'string'
        && Number.isInteger(value.parentIndex)
        && Number.isInteger(value.childIndex)
        && Number.isInteger(value.nextSiblingIndex)
        && typeof value.hierarchyId === 'string'
        && isNumberTuple(value.translation, 3)
        && isNumberTuple(value.rotation, 3)
        && isNumberTuple(value.scale, 3)
        && (value.referenceFkMatrix === undefined || isNumberTuple(value.referenceFkMatrix, 16))
        && value.rotationOrder === 'XZY';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
}
function isPositiveInteger(value) {
    return isNonNegativeInteger(value) && value > 0;
}
function isNumberTuple(value, length) {
    return Array.isArray(value)
        && value.length === length
        && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}
//# sourceMappingURL=flver-preview.js.map