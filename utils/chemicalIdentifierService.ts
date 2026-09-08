import { getCasNumber } from "./casMapping";

export interface ChemicalApiResults {
    // Clean, focused fields extracted deterministically from the raw API responses.
    // Keeping this compact (instead of dumping huge raw synonym lists) makes the
    // downstream LLM decision far more reliable — especially for CAS numbers.
    pubchemCid?: string;
    inchiKey?: string;
    molecularFormula?: string;
    iupacName?: string;
    /** Validated CAS numbers (passed the CAS check-digit test), API + local element map. */
    casCandidates?: string[];
    /** A small sample of synonyms for the model to use as context (NOT the full list). */
    synonymSample?: string[];
    /** Raw CAS Common Chemistry search result (may be empty if the endpoint is blocked by CORS). */
    casCommonChemistry?: any;
}

// A CAS Registry Number is 2–7 digits, then 2 digits, then a single check digit: e.g. 7440-50-8
const CAS_REGEX = /\b(\d{2,7}-\d{2}-\d)\b/;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

/**
 * Fetches JSON with retry + exponential backoff. This is the key reliability fix:
 * PubChem rate-limits (~5 requests/second) and returns HTTP 503 (PUGREST.ServerBusy)
 * when a burst of lookups arrives together. Previously those failures were silent, so
 * some elements ended up with no identifiers. We now retry the busy responses.
 * Returns the parsed JSON, or null if the resource genuinely doesn't exist / keeps failing.
 */
const fetchJsonWithRetry = async (url: string, retries = 3): Promise<any> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                return await res.json();
            }
            // 404 → the name genuinely isn't in this database; don't retry.
            if (res.status === 404) return null;
            // 429 / 503 / other 5xx → server busy or transient; back off and retry.
            if (res.status === 429 || res.status >= 500) {
                if (attempt < retries) {
                    await sleep(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 300));
                    continue;
                }
            }
            return null;
        } catch (err) {
            // Network / CORS error → retry a couple of times, then give up quietly.
            if (attempt < retries) {
                await sleep(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 300));
                continue;
            }
            return null;
        }
    }
    return null;
};

export const lookupChemicalIdentifiers = async (name: string): Promise<ChemicalApiResults> => {
    const results: ChemicalApiResults = {};
    const safeName = encodeURIComponent(name.trim());
    const casCandidates: string[] = [];

    // 1. PubChem Properties (CID, InChIKey, MolecularFormula, IUPACName) — with retry.
    const propJson = await fetchJsonWithRetry(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${safeName}/property/InChIKey,MolecularFormula,IUPACName/JSON`
    );
    const prop = propJson?.PropertyTable?.Properties?.[0];
    if (prop) {
        results.pubchemCid = prop.CID != null ? String(prop.CID) : undefined;
        results.inchiKey = prop.InChIKey || undefined;
        results.molecularFormula = prop.MolecularFormula || undefined;
        results.iupacName = prop.IUPACName || undefined;
    }

    // 2. PubChem Synonyms — CAS numbers live here. Extract them deterministically (with
    //    check-digit validation) instead of relying on the LLM to spot them in a huge list.
    const synJson = await fetchJsonWithRetry(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${safeName}/synonyms/JSON`
    );
    const synonyms: string[] = synJson?.InformationList?.Information?.[0]?.Synonym || [];
    if (Array.isArray(synonyms) && synonyms.length > 0) {
        for (const cas of extractValidCasNumbers(synonyms)) {
            if (!casCandidates.includes(cas)) casCandidates.push(cas);
        }
        results.synonymSample = synonyms.slice(0, 15);
    }

    // 3. CAS Common Chemistry Search (validation / fallback). Often CORS-blocked in the
    //    browser — that's fine, it's best-effort and we already have PubChem + local data.
    try {
        const casRes = await fetch(`https://commonchemistry.cas.org/api/search?q=${safeName}`);
        if (casRes.ok) {
            const json = await casRes.json();
            results.casCommonChemistry = json;
            const rns: string[] = (json?.results || []).map((r: any) => r?.rn).filter(Boolean);
            for (const cas of extractValidCasNumbers(rns)) {
                if (!casCandidates.includes(cas)) casCandidates.push(cas);
            }
        }
    } catch (err) {
        // best effort only
    }

    // 4. LOCAL FALLBACK for elements. The app ships a full periodic-table CAS map, so even
    //    if every network lookup above failed (rate limit, offline, CORS), an element name
    //    or symbol (e.g. "Ni", "Nickel", "Fe") still yields a guaranteed, correct CAS.
    const localCas = getCasNumber(name);
    if (localCas && isValidCas(localCas) && !casCandidates.includes(localCas)) {
        casCandidates.push(localCas);
    }

    if (casCandidates.length > 0) {
        results.casCandidates = casCandidates;
    }

    return results;
};
