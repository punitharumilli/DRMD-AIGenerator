
// ROR (Research Organization Registry) Lookup Service
// Loads the compact ROR JSON data at runtime and provides fuzzy name matching.

interface RorEntry {
    id: string;       // Bare ROR ID, e.g. "03x516a66"
    names: string[];  // Lowercased name variants (display, labels, aliases, acronyms)
    display: string;  // Primary display name
}

let rorData: RorEntry[] | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * Normalize a string for comparison:
 * lowercase, collapse whitespace, strip diacritics, remove common punctuation.
 */
const normalize = (s: string): string =>
    s.toLowerCase()
     .normalize('NFD')
     .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
     .replace(/[-–—]/g, ' ')            // dashes → spaces
     .replace(/[^a-z0-9\s]/g, '')       // strip remaining punctuation
     .replace(/\s+/g, ' ')
     .trim();

/**
 * Load the ROR lookup data. Safe to call multiple times — will only fetch once.
 */
export const loadRorData = async (): Promise<void> => {
    if (rorData) return;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            // Fetch from public/data/ (Vite serves public/ at root)
            const response = await fetch('./data/ror-lookup.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            rorData = await response.json();
            console.log(`ROR lookup loaded: ${rorData!.length} organizations`);
        } catch (err) {
            console.warn('Failed to load ROR lookup data:', err);
            rorData = [];
        }
    })();

    return loadPromise;
};

/**
 * Check if ROR data is loaded.
 */
export const isRorLoaded = (): boolean => rorData !== null && rorData.length > 0;

/**
 * Simple token-based similarity score.
 * Returns a value between 0 and 1 indicating how well the query matches the candidate.
 */
const similarityScore = (queryNorm: string, candidateNorm: string): number => {
    // Exact match
    if (queryNorm === candidateNorm) return 1.0;

    // Check if one contains the other
    if (candidateNorm.includes(queryNorm) || queryNorm.includes(candidateNorm)) {
        const ratio = Math.min(queryNorm.length, candidateNorm.length) / Math.max(queryNorm.length, candidateNorm.length);
        return 0.7 + (0.25 * ratio); // 0.7–0.95 range
    }

    // Token-based matching
    const queryTokens = queryNorm.split(' ').filter(t => t.length > 1);
    const candidateTokens = candidateNorm.split(' ').filter(t => t.length > 1);
    
    if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

    let matchedTokens = 0;
    for (const qt of queryTokens) {
        if (candidateTokens.some(ct => ct === qt || ct.includes(qt) || qt.includes(ct))) {
            matchedTokens++;
        }
    }

    return matchedTokens / Math.max(queryTokens.length, candidateTokens.length);
};

export interface RorMatch {
    id: string;       // Bare ROR ID
    display: string;  // Display name
    score: number;    // Match score 0–1
    link: string;     // Full ROR URL
}

/**
 * Look up an organization name and return the best ROR match(es).
 * Returns an array of matches sorted by score (best first).
 * 
 * @param orgName - The organization name to look up (can be partial, in any language, with typos)
 * @param maxResults - Maximum number of results to return (default: 5)
 * @param minScore - Minimum similarity score to include (default: 0.4)
 */
export const lookupRor = (orgName: string, maxResults: number = 5, minScore: number = 0.4): RorMatch[] => {
    if (!rorData || rorData.length === 0 || !orgName.trim()) return [];

    const queryNorm = normalize(orgName);
    if (queryNorm.length < 2) return [];

    const results: RorMatch[] = [];

    for (const entry of rorData) {
        let bestScore = 0;
        
        for (const name of entry.names) {
            const nameNorm = normalize(name);
            const score = similarityScore(queryNorm, nameNorm);
            if (score > bestScore) bestScore = score;
            // Early exit if we found an exact match
            if (bestScore >= 1.0) break;
        }

        if (bestScore >= minScore) {
            results.push({
                id: entry.id,
                display: entry.display,
                score: bestScore,
                link: `https://ror.org/${entry.id}`
            });
        }

        // Early exit once we have enough high-quality matches
        if (results.length > maxResults * 10) break;
    }

    // Sort by score descending, then by display name
    results.sort((a, b) => b.score - a.score || a.display.localeCompare(b.display));

    return results.slice(0, maxResults);
};

/**
 * Get the best single ROR match for an organization name.
 * Returns null if no good match is found (score < 0.6).
 */
export const getBestRorMatch = (orgName: string): RorMatch | null => {
    const matches = lookupRor(orgName, 1, 0.6);
    return matches.length > 0 ? matches[0] : null;
};
