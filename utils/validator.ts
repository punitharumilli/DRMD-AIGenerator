import { DRMD } from '../types';

export type ValidationSeverity = 'error' | 'conditional-error' | 'warning';

export interface ValidationIssue {
    ruleId: string;
    severity: ValidationSeverity;
    section: string;
    message: string;
}

export interface ValidationReport {
    errors: ValidationIssue[];
    conditionalErrors: ValidationIssue[];
    warnings: ValidationIssue[];
    isCompliant: boolean;
}

export function validateDrmd(data: DRMD): ValidationReport {
    const issues: ValidationIssue[] = [];

    // ─── SHARED RULES ───────────────────────────────────────────────────

    // DRMD-001: title must be non-empty
    if (!data.administrativeData.title || data.administrativeData.title.trim() === '') {
        issues.push({
            ruleId: 'DRMD-001',
            severity: 'error',
            section: 'Administrative',
            message: 'Document title must be specified.',
        });
    }

    // DRMD-002: at least one material
    if (!data.materials || data.materials.length === 0) {
        issues.push({
            ruleId: 'DRMD-002',
            severity: 'error',
            section: 'Materials',
            message: 'At least one material must be defined.',
        });
    }

    // DRMD-003: at least one properties block
    if (!data.properties || data.properties.length === 0) {
        issues.push({
            ruleId: 'DRMD-003',
            severity: 'error',
            section: 'Properties',
            message: 'At least one properties block must be defined.',
        });
    }

    // DRMD-004: intendedUse must be non-empty
    if (!data.statements.official.intendedUse || data.statements.official.intendedUse.trim() === '') {
        issues.push({
            ruleId: 'DRMD-004',
            severity: 'error',
            section: 'Statements',
            message: 'Intended use statement must be provided.',
        });
    }

    // DRMD-005: storageInformation must be non-empty
    if (!data.statements.official.storageInformation || data.statements.official.storageInformation.trim() === '') {
        issues.push({
            ruleId: 'DRMD-005',
            severity: 'error',
            section: 'Statements',
            message: 'Storage information statement must be provided.',
        });
    }

    // DRMD-006: handlingInstructions must be non-empty
    if (!data.statements.official.handlingInstructions || data.statements.official.handlingInstructions.trim() === '') {
        issues.push({
            ruleId: 'DRMD-006',
            severity: 'error',
            section: 'Statements',
            message: 'Handling instructions statement must be provided.',
        });
    }

    // DRMD-007: every material must have a name
    if (data.materials) {
        data.materials.forEach((mat, i) => {
            if (!mat.name || mat.name.trim() === '') {
                issues.push({
                    ruleId: 'DRMD-007',
                    severity: 'error',
                    section: 'Materials',
                    message: `Material at index ${i} must have a name.`,
                });
            }
        });
    }

    // DRMD-008: every material should have minimumSampleSize non-empty
    if (data.materials) {
        data.materials.forEach((mat, i) => {
            if (!mat.minimumSampleSize || String(mat.minimumSampleSize).trim() === '') {
                issues.push({
                    ruleId: 'DRMD-008',
                    severity: 'conditional-error',
                    section: 'Materials',
                    message: `Material "${mat.name || i}" should specify a minimum sample size.`,
                });
            }
        });
    }

    // DRMD-009: every properties block must have at least one result
    if (data.properties) {
        data.properties.forEach((prop, i) => {
            if (!prop.results || prop.results.length === 0) {
                issues.push({
                    ruleId: 'DRMD-009',
                    severity: 'error',
                    section: 'Properties',
                    message: `Property "${prop.name || i}" must have at least one measurement result.`,
                });
            }
        });
    }

    // DRMD-010: at least one producer must exist AND first producer must have a name
    if (!data.administrativeData.producers || data.administrativeData.producers.length === 0) {
        issues.push({
            ruleId: 'DRMD-010',
            severity: 'error',
            section: 'Administrative',
            message: 'At least one producer must be defined.',
        });
    } else if (
        !data.administrativeData.producers[0].name ||
        data.administrativeData.producers[0].name.trim() === ''
    ) {
        issues.push({
            ruleId: 'DRMD-010',
            severity: 'error',
            section: 'Administrative',
            message: 'The first producer must have a name.',
        });
    }

    // DRMD-012: validity type constraints
    if (data.administrativeData.validityType === 'Specific Time') {
        if (!data.administrativeData.specificTime || data.administrativeData.specificTime.trim() === '') {
            issues.push({
                ruleId: 'DRMD-012',
                severity: 'error',
                section: 'Administrative',
                message: 'Specific Time validity requires a non-empty specificTime value.',
            });
        }
    } else if (data.administrativeData.validityType === 'Time After Dispatch') {
        if (
            (!data.administrativeData.durationY || data.administrativeData.durationY <= 0) &&
            (!data.administrativeData.durationM || data.administrativeData.durationM <= 0)
        ) {
            issues.push({
                ruleId: 'DRMD-012',
                severity: 'error',
                section: 'Administrative',
                message:
                    'Time After Dispatch validity requires at least durationY or durationM to be greater than 0.',
            });
        }
    }

    // DRMD-013: commutability should be non-empty
    if (!data.statements.official.commutability || data.statements.official.commutability.trim() === '') {
        issues.push({
            ruleId: 'DRMD-013',
            severity: 'conditional-error',
            section: 'Statements',
            message: 'Commutability statement should be provided.',
        });
    }

    // DRMD-014: each properties block should have procedures non-empty
    if (data.properties) {
        data.properties.forEach((prop, i) => {
            if (!prop.procedures || prop.procedures.trim() === '') {
                issues.push({
                    ruleId: 'DRMD-014',
                    severity: 'conditional-error',
                    section: 'Properties',
                    message: `Property "${prop.name || i}" should have procedures specified.`,
                });
            }
        });
    }

    // DRMD-015: healthAndSafety should be non-empty
    if (!data.statements.official.healthAndSafety || data.statements.official.healthAndSafety.trim() === '') {
        issues.push({
            ruleId: 'DRMD-015',
            severity: 'warning',
            section: 'Statements',
            message: 'Health and safety information should be provided.',
        });
    }

    // ─── CERTIFICATE-ONLY RULES ─────────────────────────────────────────

    const isCertificate = data.administrativeData.title === 'referenceMaterialCertificate';
    const isPIS = data.administrativeData.title === 'productInformationSheet';

    if (isCertificate) {
        // RMC-001: metrologicalTraceability must be non-empty
        if (
            !data.statements.official.metrologicalTraceability ||
            data.statements.official.metrologicalTraceability.trim() === ''
        ) {
            issues.push({
                ruleId: 'RMC-001',
                severity: 'error',
                section: 'Statements',
                message: 'Metrological traceability statement is required for certificates.',
            });
        }

        // RMC-002: at least one properties block must have isCertified === true
        if (data.properties && !data.properties.some((p) => p.isCertified === true)) {
            issues.push({
                ruleId: 'RMC-002',
                severity: 'error',
                section: 'Properties',
                message: 'At least one property must be certified for a reference material certificate.',
            });
        }

        // RMC-005: certified properties blocks should have procedures non-empty
        if (data.properties) {
            data.properties.forEach((prop, i) => {
                if (prop.isCertified === true && (!prop.procedures || prop.procedures.trim() === '')) {
                    issues.push({
                        ruleId: 'RMC-005',
                        severity: 'warning',
                        section: 'Properties',
                        message: `Certified property "${prop.name || i}" should have procedures specified.`,
                    });
                }
            });
        }

        // RMC-006: for certified properties, every quantity in every result must have non-empty uncertainty
        if (data.properties) {
            data.properties.forEach((prop, pi) => {
                if (prop.isCertified === true && prop.results) {
                    prop.results.forEach((result, ri) => {
                        if (result.quantities) {
                            result.quantities.forEach((q, qi) => {
                                if (!q.uncertainty || String(q.uncertainty).trim() === '') {
                                    issues.push({
                                        ruleId: 'RMC-006',
                                        severity: 'error',
                                        section: 'Properties',
                                        message: `Certified property "${prop.name || pi}", result ${ri}, quantity "${q.name || qi}" must have an uncertainty value.`,
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }

        // RMC-010: at least one responsible person with a non-empty name
        if (
            !data.administrativeData.responsiblePersons ||
            data.administrativeData.responsiblePersons.length === 0
        ) {
            issues.push({
                ruleId: 'RMC-010',
                severity: 'error',
                section: 'Administrative',
                message: 'At least one responsible person must be defined for a certificate.',
            });
        } else if (!data.administrativeData.responsiblePersons.some((rp) => rp.name && rp.name.trim() !== '')) {
            issues.push({
                ruleId: 'RMC-010',
                severity: 'error',
                section: 'Administrative',
                message: 'At least one responsible person must have a non-empty name.',
            });
        }

        // RMC-011: every material must have a non-empty description
        if (data.materials) {
            data.materials.forEach((mat, i) => {
                if (!mat.description || mat.description.trim() === '') {
                    issues.push({
                        ruleId: 'RMC-011',
                        severity: 'error',
                        section: 'Materials',
                        message: `Material "${mat.name || i}" must have a description for a certificate.`,
                    });
                }
            });
        }
    }

    // ─── PIS-ONLY RULES ─────────────────────────────────────────────────

    if (isPIS) {
        // PIS-001: no properties block may have isCertified === true
        if (data.properties) {
            data.properties.forEach((prop, i) => {
                if (prop.isCertified === true) {
                    issues.push({
                        ruleId: 'PIS-001',
                        severity: 'error',
                        section: 'Properties',
                        message: `Property "${prop.name || i}" must not be certified in a product information sheet.`,
                    });
                }
            });
        }

        // PIS-002: at least one properties block must have results with data
        if (data.properties) {
            const hasResultsWithData = data.properties.some(
                (prop) => prop.results && prop.results.length > 0
            );
            if (!hasResultsWithData) {
                issues.push({
                    ruleId: 'PIS-002',
                    severity: 'error',
                    section: 'Properties',
                    message: 'At least one property must have measurement results in a product information sheet.',
                });
            }
        }

        // PIS-005: every material should have a description (recommended)
        if (data.materials) {
            data.materials.forEach((mat, i) => {
                if (!mat.description || mat.description.trim() === '') {
                    issues.push({
                        ruleId: 'PIS-005',
                        severity: 'warning',
                        section: 'Materials',
                        message: `Material "${mat.name || i}" should have a description.`,
                    });
                }
            });
        }
    }

    // ─── BUILD REPORT ───────────────────────────────────────────────────

    const errors = issues.filter((i) => i.severity === 'error');
    const conditionalErrors = issues.filter((i) => i.severity === 'conditional-error');
    const warnings = issues.filter((i) => i.severity === 'warning');

    return {
        errors,
        conditionalErrors,
        warnings,
        isCompliant: errors.length === 0,
    };
}
