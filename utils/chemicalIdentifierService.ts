export interface ChemicalApiResults {
    pubchemProperty?: any;
    pubchemSynonyms?: any;
    casSearch?: any;
}

export const lookupChemicalIdentifiers = async (name: string): Promise<ChemicalApiResults> => {
    const results: ChemicalApiResults = {};
    const safeName = encodeURIComponent(name.trim());
    
    try {
        // 1. PubChem Properties (CID, InChIKey, etc.)
        const pubchemPropRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${safeName}/property/InChIKey,MolecularFormula,IUPACName/JSON`);
        if (pubchemPropRes.ok) {
            results.pubchemProperty = await pubchemPropRes.json();
        }

        // 2. PubChem Synonyms (for CAS number extraction)
        const pubchemSynRes = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${safeName}/synonyms/JSON`);
        if (pubchemSynRes.ok) {
            results.pubchemSynonyms = await pubchemSynRes.json();
        }

        // 3. CAS Common Chemistry Search (as fallback/validation)
        const casRes = await fetch(`https://commonchemistry.cas.org/api/search?q=${safeName}`);
        if (casRes.ok) {
            results.casSearch = await casRes.json();
        }
    } catch (err) {
        console.warn(`Failed to fetch chemical identifiers for ${name}:`, err);
    }
    
    return results;
};
