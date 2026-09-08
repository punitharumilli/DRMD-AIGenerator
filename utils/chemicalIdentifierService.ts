export interface ChemicalApiResults {
    // Clean, focused fields extracted deterministically from the raw API responses.
    // Keeping this compact (instead of dumping huge raw synonym lists) makes the
    // downstream LLM decision far more reliable — especially for CAS numbers.
    pubchemCid?: string;
    inchiKey?: string;
    molecularFormula?: string;
    iupacName?: string;
    /** Validated CAS numbers (passed the CAS check-digit test) pulled from PubChem synonyms + CAS Common Chemistry. */
    casCandidates?: string[];
    /** A small sample of synonyms for the model to use as context (NOT the full list). */
    synonymSample?: string[];
    /** Raw CAS Common Chemistry search result (may be empty if the endpoint is blocked by CORS). */
    casCommonChemistry?: any;
}

// A CAS Registry Number is 2–7 digits, then 2 digits, then a single check digit: e.g. 7440-50-8
const CAS_REGEX = /\b(\d{2,7}-\d{2}-\d)\b/;

/**
 * Validates a CAS Registry Number using its check digit.
 * The last digit is a checksum: sum(digit_i * position_i) mod 10, counting positions
 * from right to left starting at 1, over all digits except the check digit.
 */
export const isValidCas = (cas: string): boolean => {
    const m = cas.match(/^(\d{2,7})-(\d{2})-(\d)$/);
    if (!m) return false;
    const digits = (m[1] + m[2]).split('').map(Number);
    const check = Number(m[3]);
    let sum = 0;
    // Right-most digit (just before the check digit) has weight 1.
    for (let i = 0; i < digits.length; i++) {
        const weight = digits.length - i;
        sum += digits[i] * weight;
    }
    return (sum % 10) === check;
};

/**
 * Extracts all valid, unique CAS numbers from a list of arbitrary strings (e.g. PubChem synonyms).
 * PubChem conventionally lists the primary/preferred CAS first among the CAS-formatted synonyms,
 * so ordering is preserved.
 */
const extractValidCasNumbers = (candidates: string[]): string[] => {
    const found: string[] = [];
    for (const raw of candidates) {
        if (!raw) continue;
        const match = String(raw).match(CAS_REGEX);
        if (match) {
            const cas = match[1];
            if (isValidCas(cas) && !found.includes(cas)) {
                found.push(cas);
            }
        }
    }
    return found;
};

export const lookupChemicalIdentifiers = async (name: string): Promise<ChemicalApiResults> => {
    const results: ChemicalApiResults = {};
    const safeName = encodeURIComponent(name.trim());
    const casCandidates: string[] = [];

    // 1. PubChem Properties (CID, InChIKey, MolecularFormula, IUPACName)
    // Isolated so a failure here does not prevent the synonym / CAS lookups below.
    try {
        const pubchemPropRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${safeName}/property/InChIKey,MolecularFormula,IUPACName/JSON`);
        if (pubchemPropRes.ok) {
            const json = await pubchemPropRes.json();
            const prop = json?.PropertyTable?.Properties?.[0];
            if (prop) {
                results.pubchemCid = prop.CID != null ? String(prop.CID) : undefined;
                results.inchiKey = prop.InChIKey || undefined;
                results.molecularFormula = prop.MolecularFormula || undefined;
                results.iupacName = prop.IUPACName || undefined;
            }
        }
    } catch (err) {
        console.warn(`PubChem property lookup failed for "${name}":`, err);
    }

    // 2. PubChem Synonyms — this is where CAS numbers live. We extract them deterministically
    //    (with check-digit validation) instead of relying on the LLM to spot them in a huge list.
    try {
        const pubchemSynRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${safeName}/synonyms/JSON`);
        if (pubchemSynRes.ok) {
            const json = await pubchemSynRes.json();
            const synonyms: string[] = json?.InformationList?.Information?.[0]?.Synonym || [];
            if (Array.isArray(synonyms) && synonyms.length > 0) {
                // Pull out valid CAS numbers (ordered — PubChem lists the primary CAS first).
                for (const cas of extractValidCasNumbers(synonyms)) {
                    if (!casCandidates.includes(cas)) casCandidates.push(cas);
                }
                // Provide a small, useful synonym sample for LLM context (avoid dumping hundreds).
                results.synonymSample = synonyms.slice(0, 15);
            }
        }
    } catch (err) {
        console.warn(`PubChem synonyms lookup failed for "${name}":`, err);
    }

    // 3. CAS Common Chemistry Search (validation / fallback). This endpoint is sometimes blocked
    //    by CORS in the browser — that's fine, it's isolated and we already have PubChem candidates.
    try {
        const casRes = await fetch(`https://commonchemistry.cas.org/api/search?q=${safeName}`);
        if (casRes.ok) {
            const json = await casRes.json();
            results.casCommonChemistry = json;
            const rns: string[] = (json?.results || [])
                .map((r: any) => r?.rn)
                .filter(Boolean);
            for (const cas of extractValidCasNumbers(rns)) {
                if (!casCandidates.includes(cas)) casCandidates.push(cas);
            }
        }
    } catch (err) {
        console.warn(`CAS Common Chemistry lookup failed for "${name}":`, err);
    }

    if (casCandidates.length > 0) {
        results.casCandidates = casCandidates;
    }

    return results;
};
