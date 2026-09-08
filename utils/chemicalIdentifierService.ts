import { getCasNumber } from './casMapping';

export interface ChemicalApiResults {
    queryName: string;
    matchedName?: string;
    pubchemCid?: string;
    inchiKey?: string;
    molecularFormula?: string;
    iupacName?: string;
    casCandidates: string[];
    knownCas?: string;
}

/**
 * Validates a CAS Registry Number using the standard checksum algorithm:
 * Format: A-B-C where A is 2-7 digits, B is 2 digits, C is 1 check digit.
 * Sum = (d_n * n) + ... + (d_1 * 1) modulo 10 == C
 */
export const isValidCas = (cas: string | undefined | null): boolean => {
    if (!cas || typeof cas !== 'string') return false;
    const trimmed = cas.trim();
    if (!/^\d{2,7}-\d{2}-\d$/.test(trimmed)) return false;
    
    const parts = trimmed.split('-');
    const digits = parts[0] + parts[1];
    const checkDigit = parseInt(parts[2], 10);
    
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        const weight = digits.length - i;
        sum += parseInt(digits[i], 10) * weight;
    }
    
    return sum % 10 === checkDigit;
};

/**
 * Generate candidate search terms from an extracted chemical name.
 * e.g. "Copper (Cu)" -> ["Copper (Cu)", "Copper", "Cu"]
 *      "Mass fraction of Zn" -> ["Mass fraction of Zn", "Zn"]
 *      "Fe (total)" -> ["Fe (total)", "Fe"]
 *      "Carbon, C" -> ["Carbon, C", "Carbon", "C"]
 */
export const generateSearchTerms = (name: string): string[] => {
    const terms: string[] = [];
    if (!name || typeof name !== 'string') return terms;
    
    const trimmed = name.trim();
    if (!trimmed) return terms;
    terms.push(trimmed);

    // 1. Remove prefixes like "Mass fraction of", "Total", "Dissolved", "Elemental"
    const cleanedPrefix = trimmed
        .replace(/^(?:mass fraction of|mass fraction|total|dissolved|elemental|fraction of|content of)\s+/i, '')
        .replace(/\s+(?:total|mass fraction|dissolved|elemental)$/i, '')
        .trim();
    if (cleanedPrefix && !terms.includes(cleanedPrefix)) {
        terms.push(cleanedPrefix);
    }

    // 2. Extract outside and inside parentheses: e.g. "Copper (Cu)" -> "Copper", "Cu"
    const parenMatch = trimmed.match(/^([^(]+)\(([^)]+)\)/);
    if (parenMatch) {
        const outside = parenMatch[1].trim();
        const inside = parenMatch[2].trim();
        if (outside && !terms.includes(outside)) terms.push(outside);
        if (inside && !terms.includes(inside)) terms.push(inside);
    }

    // 3. Handle comma / slash separated: e.g. "Carbon, C" -> "Carbon", "C"
    if (trimmed.includes(',') || trimmed.includes('/')) {
        const parts = trimmed.split(/[,/]/).map(p => p.trim()).filter(Boolean);
        for (const p of parts) {
            if (!terms.includes(p)) terms.push(p);
        }
    }

    return terms;
};

export const lookupChemicalIdentifiers = async (name: string): Promise<ChemicalApiResults> => {
    const searchTerms = generateSearchTerms(name);
    const results: ChemicalApiResults = {
        queryName: name,
        casCandidates: []
    };

    // 1. Check local CAS database from casMapping
    for (const term of searchTerms) {
        const cas = getCasNumber(term);
        if (cas && isValidCas(cas)) {
            results.knownCas = cas;
            if (!results.casCandidates.includes(cas)) {
                results.casCandidates.push(cas);
            }
            break;
        }
    }

    // 2. Try PubChem with candidate terms until properties are found
    for (const term of searchTerms) {
        const safeTerm = encodeURIComponent(term);
        try {
            const pubchemPropRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${safeTerm}/property/InChIKey,MolecularFormula,IUPACName/JSON`);
            if (pubchemPropRes.ok) {
                const propData = await pubchemPropRes.json();
                const firstProp = propData?.PropertyTable?.Properties?.[0];
                if (firstProp) {
                    results.matchedName = term;
                    results.pubchemCid = firstProp.CID ? String(firstProp.CID) : undefined;
                    results.inchiKey = firstProp.InChIKey || undefined;
                    results.molecularFormula = firstProp.MolecularFormula || undefined;
                    results.iupacName = firstProp.IUPACName || undefined;

                    // Fetch synonyms for this matched CID / term to extract CAS numbers
                    const cid = firstProp.CID;
                    const synUrl = cid 
                        ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/synonyms/JSON`
                        : `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${safeTerm}/synonyms/JSON`;
                    
                    const pubchemSynRes = await fetch(synUrl);
                    if (pubchemSynRes.ok) {
                        const synData = await pubchemSynRes.json();
                        const synList: string[] = synData?.InformationList?.Information?.[0]?.Synonym || [];
                        for (const syn of synList) {
                            if (isValidCas(syn) && !results.casCandidates.includes(syn)) {
                                results.casCandidates.push(syn);
                            }
                        }
                    }
                    break; // Found primary match
                }
            }
        } catch (err) {
            console.warn(`PubChem lookup failed for term "${term}":`, err);
        }
    }

    // 3. Fallback to NCI/NIH CIR (Chemical Identifier Resolver) if no CAS found yet
    if (results.casCandidates.length === 0) {
        for (const term of searchTerms) {
            try {
                const safeTerm = encodeURIComponent(term);
                const cirRes = await fetch(`https://cactus.nci.nih.gov/chemical/structure/${safeTerm}/cas`);
                if (cirRes.ok) {
                    const text = await cirRes.text();
                    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                    for (const line of lines) {
                        if (isValidCas(line) && !results.casCandidates.includes(line)) {
                            results.casCandidates.push(line);
                        }
                    }
                    if (results.casCandidates.length > 0) {
                        break;
                    }
                }
            } catch (e) {
                // Ignore CIR network failures
            }
        }
    }

    return results;
};
