

/**
 * Utility to convert human-readable units to machine-readable D-SI format.
 * Follows guidelines from the D-SI specifications (Platinum/Gold class).
 */

export interface DsiConversion {
    dsiUnit: string;
    factor: number;
    offset?: number;
}

// STRICT D-SI MAPPING according to SmartCom D-SI Guide (Platinum/Gold)
// Note: Factors are set to 1 when the D-SI unit string explicitly matches the input unit's scale (e.g., mg -> \milli\gram).
// Factors are only used when the unit changes completely (e.g., lb -> \kilogram).
const UNIT_MAP: Record<string, DsiConversion> = {
    // --- Dimensionless / Ratios ---
    '%': { dsiUnit: '\\percent', factor: 1 },
    'percent': { dsiUnit: '\\percent', factor: 1 },
    'ppm': { dsiUnit: '\\one', factor: 1e-6 },
    'ppb': { dsiUnit: '\\one', factor: 1e-9 },
    'one': { dsiUnit: '\\one', factor: 1 },
    '/one': { dsiUnit: '\\one', factor: 1 },
    '\\one': { dsiUnit: '\\one', factor: 1 },

    // --- Mass Fractions ---
    'mg/kg': { dsiUnit: '\\milli\\gram\\kilogram\\tothe{-1}', factor: 1 }, 
    'mgkg-1': { dsiUnit: '\\milli\\gram\\kilogram\\tothe{-1}', factor: 1 },
    'mgkg⁻¹': { dsiUnit: '\\milli\\gram\\kilogram\\tothe{-1}', factor: 1 },
    
    'µg/kg': { dsiUnit: '\\micro\\gram\\kilogram\\tothe{-1}', factor: 1 },
    'ug/kg': { dsiUnit: '\\micro\\gram\\kilogram\\tothe{-1}', factor: 1 },
    'μg/kg': { dsiUnit: '\\micro\\gram\\kilogram\\tothe{-1}', factor: 1 }, // Greek mu
    'µgkg-1': { dsiUnit: '\\micro\\gram\\kilogram\\tothe{-1}', factor: 1 },
    'ugkg-1': { dsiUnit: '\\micro\\gram\\kilogram\\tothe{-1}', factor: 1 },
    'µgkg⁻¹': { dsiUnit: '\\micro\\gram\\kilogram\\tothe{-1}', factor: 1 },

    'ng/kg': { dsiUnit: '\\nano\\gram\\per\\kilo\\gram', factor: 1 },
    'ngkg-1': { dsiUnit: '\\nano\\gram\\per\\kilo\\gram', factor: 1 },

    'g/kg': { dsiUnit: '\\gram\\kilogram\\tothe{-1}', factor: 1 },
    'gkg-1': { dsiUnit: '\\gram\\kilogram\\tothe{-1}', factor: 1 },
    'gkg⁻¹': { dsiUnit: '\\gram\\kilogram\\tothe{-1}', factor: 1 },

    'mg/g': { dsiUnit: '\\milli\\gram\\gram\\tothe{-1}', factor: 1 },
    'mgg-1': { dsiUnit: '\\milli\\gram\\gram\\tothe{-1}', factor: 1 },

    'ug/g': { dsiUnit: '\\micro\\gram\\gram\\tothe{-1}', factor: 1 },
    'µg/g': { dsiUnit: '\\micro\\gram\\gram\\tothe{-1}', factor: 1 },
    'μg/g': { dsiUnit: '\\micro\\gram\\gram\\tothe{-1}', factor: 1 },
    
    'g/100g': { dsiUnit: '\\gram\\hecto\\gram\\tothe{-1}', factor: 1 }, 

    // --- Amount of Substance ---
    'mol/mol': { dsiUnit: '\\mole\\per\\mole', factor: 1 },
    'molmol-1': { dsiUnit: '\\mole\\per\\mole', factor: 1 }, 

    // --- Specific Surface Area ---
    'm2/g': { dsiUnit: '\\metre\\tothe{2}\\gram\\tothe{-1}', factor: 1 },
    'm²/g': { dsiUnit: '\\metre\\tothe{2}\\gram\\tothe{-1}', factor: 1 },
    'cm2/g': { dsiUnit: '\\centi\\metre\\tothe{2}\\gram\\tothe{-1}', factor: 1 },
    'cm²/g': { dsiUnit: '\\centi\\metre\\tothe{2}\\gram\\tothe{-1}', factor: 1 },

    // --- Mass ---
    'mg': { dsiUnit: '\\milli\\gram', factor: 1 }, 
    'g': { dsiUnit: '\\gram', factor: 1 },       
    'kg': { dsiUnit: '\\kilogram', factor: 1 },
    'ug': { dsiUnit: '\\micro\\gram', factor: 1 },
    'µg': { dsiUnit: '\\micro\\gram', factor: 1 },
    'μg': { dsiUnit: '\\micro\\gram', factor: 1 },
    
    'lb': { dsiUnit: '\\kilogram', factor: 0.45359237 },
    'oz': { dsiUnit: '\\kilogram', factor: 0.02834959 },
    't': { dsiUnit: '\\tonne', factor: 1000 }, // tonne to kg

    // --- Length ---
    'nm': { dsiUnit: '\\nano\\metre', factor: 1 },
    'µm': { dsiUnit: '\\micro\\metre', factor: 1 },
    'μm': { dsiUnit: '\\micro\\metre', factor: 1 }, // Greek mu
    'um': { dsiUnit: '\\micro\\metre', factor: 1 },
    'mm': { dsiUnit: '\\milli\\metre', factor: 1 },
    'cm': { dsiUnit: '\\centi\\metre', factor: 1 },
    'm': { dsiUnit: '\\metre', factor: 1 },
    'km': { dsiUnit: '\\kilo\\metre', factor: 1 },
    
    'inch': { dsiUnit: '\\metre', factor: 0.0254 },
    'in': { dsiUnit: '\\metre', factor: 0.0254 },
    'ft': { dsiUnit: '\\metre', factor: 0.3048 },
    'mi': { dsiUnit: '\\metre', factor: 1609.344 },

    // --- Area ---
    'm2': { dsiUnit: '\\metre\\tothe{2}', factor: 1 },
    'm²': { dsiUnit: '\\metre\\tothe{2}', factor: 1 },
    'cm2': { dsiUnit: '\\centi\\metre\\tothe{2}', factor: 1 },
    'cm²': { dsiUnit: '\\centi\\metre\\tothe{2}', factor: 1 },
    
    // --- Density ---
    'g/cm3': { dsiUnit: '\\gram\\centi\\metre\\tothe{-3}', factor: 1 },
    'g/cm³': { dsiUnit: '\\gram\\centi\\metre\\tothe{-3}', factor: 1 },

    // --- Temperature ---
    '°C': { dsiUnit: '\\degreecelsius', factor: 1 },
    'C': { dsiUnit: '\\degreecelsius', factor: 1 },
    'K': { dsiUnit: '\\kelvin', factor: 1 },
    
    // --- Time ---
    'h': { dsiUnit: '\\hour', factor: 1 }, 
    'min': { dsiUnit: '\\minute', factor: 1 },
    's': { dsiUnit: '\\second', factor: 1 },
    
    // --- Volume ---
    'L': { dsiUnit: '\\litre', factor: 1 }, 
    'l': { dsiUnit: '\\litre', factor: 1 },
    'mL': { dsiUnit: '\\milli\\litre', factor: 1 },
    'ml': { dsiUnit: '\\milli\\litre', factor: 1 },
    
    // --- Pressure ---
    'Pa': { dsiUnit: '\\pascal', factor: 1 },
    'bar': { dsiUnit: '\\pascal', factor: 100000 },
    'mbar': { dsiUnit: '\\pascal', factor: 100 },
    'hPa': { dsiUnit: '\\pascal', factor: 100 },
};

export const convertToDSI = (value: string | undefined | null | number, unit: string | undefined | null): { dsiValue: string, dsiUnit: string } => {
    // 1. Safety check for inputs
    let valStr = "";
    if (value !== undefined && value !== null) {
        valStr = String(value);
    }

    if (unit === undefined || unit === null) {
         // Some values are dimensionless or just don't have units
         return { dsiValue: "", dsiUnit: "" };
    }

    const safeUnit = String(unit);
    
    // 2. Normalize Unit for Lookup
    // Remove "in " prefix (case insensitive), often found in table headers like "in mg/kg"
    let cleanUnit = safeUnit.replace(/^\s*in\s+/i, '').trim();
    
    // Remove all whitespace for map key
    cleanUnit = cleanUnit.replace(/\s+/g, '');
    
    // 3. Find Conversion Rule
    let conversion: DsiConversion | undefined = UNIT_MAP[cleanUnit];
    
    // Try case-insensitive lookup
    if (!conversion) {
         const lowerKey = Object.keys(UNIT_MAP).find(k => k.toLowerCase() === cleanUnit.toLowerCase());
         if (lowerKey) conversion = UNIT_MAP[lowerKey];
    }

    // Fallback: Try normalizing complex units manually
    if (!conversion) {
        // Replace unicode superscript -1 with -1
        cleanUnit = cleanUnit.replace(/⁻¹/g, '-1').replace(/⁻/g, '-').replace(/¹/g, '1').replace(/²/g, '2').replace(/³/g, '3');
        conversion = UNIT_MAP[cleanUnit];
        
        // Try case-insensitive again after normalization
        if (!conversion) {
             const lowerKey = Object.keys(UNIT_MAP).find(k => k.toLowerCase() === cleanUnit.toLowerCase());
             if (lowerKey) conversion = UNIT_MAP[lowerKey];
        }
    }

    let dsiUnit = "";
    let factor = 1;

    // Determine target DSI Unit
    if (conversion) {
        dsiUnit = conversion.dsiUnit;
        factor = conversion.factor;
    } else if (cleanUnit.startsWith('\\')) {
        // If unit already starts with backslash, assume it is valid DSI and pass through
        dsiUnit = cleanUnit;
        factor = 1;
    } else {
        // No conversion found, return empty strings
        return { dsiValue: "", dsiUnit: "" };
    }

    // 4. Calculate DSI Value
    let dsiValue = "";
    const numValue = parseFloat(numStr(valStr));

    if (!isNaN(numValue)) {
        if (factor !== 1) {
             let finalValue = numValue * factor;
             // Avoid 0.500000001 artifacts for conversions
             dsiValue = Number(finalValue.toPrecision(6)).toString();
        } else {
            // If factor is 1, preserve original string format (trimmed)
            // This allows preserving symbols like "<" or ">" if they were present in valStr, 
            // provided we want to keep them. The calling code usually splits value/uncertainty.
            // However, numStr stripped non-numeric. 
            // If factor is 1, we trust the original string value more.
            dsiValue = valStr.trim();
        }
    } else {
        // Value is not a valid number (e.g., empty string, or complex text)
        // If factor is 1, we can just pass the string through (e.g. "< 0.05")
        if (factor === 1 && valStr.trim().length > 0) {
            dsiValue = valStr.trim();
        }
        // If factor != 1, we cannot convert non-numeric text, so dsiValue remains empty.
    }

    return { dsiValue, dsiUnit };
};

// Helper to clean value string for number parsing
const numStr = (s: string) => s.replace(/[^0-9.eE-]/g, '');

/**
 * Parses a raw string (e.g., "4.9 g" or "10 ml") and returns a DSI formatted preview string (e.g., "4.9 \gram").
 * Returns empty string if the format is not recognized or input is empty.
 */
export const getDsiPreview = (raw: string): string => {
    if (!raw) return "";
    
    // Regex to find "Number" then "Unit"
    // e.g. "4.9 g", "10 ml", "100 %"
    // Does NOT match "approx 5 g" (starts with text)
    const regex = /^([\d.]+(?:[eE][+-]?\d+)?)\s*(\S.*)$/;
    const match = raw.trim().match(regex);
    
    if (match) {
        const numPart = match[1];
        const unitPart = match[2];
        const dsi = convertToDSI(numPart, unitPart);
        if (dsi.dsiUnit) {
            return `${dsi.dsiValue} ${dsi.dsiUnit}`;
        }
    }
    return "";
};
