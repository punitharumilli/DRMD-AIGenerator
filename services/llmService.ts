

import { GoogleGenAI, Type } from "@google/genai";
import { DRMD } from "../types";
import { convertToDSI } from "../utils/unitConverter";

const SYSTEM_INSTRUCTION = `
You are an expert in Reference Material documents (both Certificates and Product Information Sheets). Extract structured data from a PDF into DRMD JSON format.

**DOCUMENT TYPE DETECTION (CRITICAL)**:
- Determine if this is a "referenceMaterialCertificate" or "productInformationSheet" and set the 'title' field accordingly.
- If the document title says "Certificate", "Certified Reference Material", "CRM", or has certified values with uncertainty and metrological traceability → title = "referenceMaterialCertificate"
- If the document title says "Product Information Sheet", "Information Sheet", "Reference Material" (without "Certified"), or values lack formal uncertainty/traceability → title = "productInformationSheet"
- When uncertain, default to "referenceMaterialCertificate".

**COORDINATES**: For key fields, extract bounding box as [pageIndex, ymin, xmin, ymax, xmax] (1-based page, 0-1000 normalized scale).

**SECTION COORDINATES**: Extract bounding box of the ENTIRE section (all fields/labels/content) for each: Producer, Responsible Person block, Material block, MeasurementResult table.

**ADMINISTRATIVE DATA**:
- **Producer**: Extract name, full address, email, phone, fax.
  - Phone: Look for "P:", "Phone:", "Tel:", or country codes (e.g. "+49"). Ensure extraction.
  - If city contains "Berlin" or "Adlershof", set countryCode="DE".
- **Responsible Persons (Strict Parsing)**: 
  - Interpret the text block hierarchically: Line 1 (Top)→name, Line 2→role, Lines 3+ (Bottom)→description.
  - **Coordinates**: If multiple persons are signed side-by-side, you MUST extract distinct, SEPARATE 'sectionCoordinates' bounding boxes for EACH individual person. Do not draw one massive box covering all of them.
- **Validity**: "valid for X months"→Time After Dispatch (durationM). "valid until [Date]"→Specific Time. "valid until revoked"→Until Revoked.
  - ALL dates MUST be YYYY-MM-DD. MM/YYYY→last day of month (e.g. "05/2048"→"2048-05-31").

**MATERIALS**: Extract name, description, minimum sample size, item quantities.
- Material name is often the document's prominent title. Extract distinct fieldCoordinates for 'name'.
- **Identifier**: Split RM code into scheme+value (e.g. "BAM-M386a"→scheme:"BAM", value:"M386a"). No prefix→use "MaterialID".
- **minimumSampleSize vs itemQuantities — CRITICAL DISTINCTION**:
  - **minimumSampleSize**: The minimum amount of the reference material needed to perform a valid calibration or test (e.g. "minimum sample intake: 4.9 g", "use at least 100 mg"). This is an instruction for the user.
  - **itemQuantities**: The total amount of reference material shipped by the producer to the customer (e.g. "50 g per bottle", "10 mL ampoule", "set of 5 capsules"). This describes the packaging/delivery.
  - These are DIFFERENT fields. Do NOT confuse them.
- Extract distinct fieldCoordinates for 'description', 'minimumSampleSize', and 'itemQuantities' when visually separate.

**PROPERTIES (TABLE STRUCTURE)**:
- Property=high-level section (e.g. "Certified Values"). MeasurementResult=specific table within it.
- **EXCLUDE**: Tables with "Means of Accepted Data Sets", "Laboratory Means", "Participant Results", "Statistical Data", "Homogeneity", raw data.
- **ONLY EXTRACT**: "Certified Values"/"Certified Property Values" and "Informative Values"/"Indicative Values"/"Additional Material Information" tables.
- Different column structures→separate MeasurementResult objects. Same table split by unit headers (e.g. "in %"/"in mg/kg")→merge into ONE.
- **Multiple Materials in One Table (CRITICAL)**: If a single physical table contains properties for MULTIPLE materials (e.g., rows for IAEA-C1, IAEA-C2, etc.), you MUST split them into separate \`results\` objects within the properties array. Group the quantities by material, and set the \`linkedMaterialName\` on each result to the specific material name it describes.
- **Table & Quantity Names (CRITICAL)**: 
  - MeasurementResult name: Use specific names (e.g. "Mass Fraction", "δ¹³C isotopic composition"). FORBIDDEN: "Table 1", "Raw Data".
  - Quantity name (Row name): If a table lists multiple distinct MATERIALS as rows, after splitting them into separate results, the Quantity 'name' should describe the property being measured, NOT just the material name.
- **Footnotes**: Capture footnotes (1), 2), *) below a table into that MeasurementResult's 'description', NOT the Property description. If a footnote pointer references another page, go there and extract actual text with coordinates.
- **Column mapping**: Values like "< 2" or "> 100"→put in 'value', leave 'uncertainty' empty.
- **Element names — Superscripts & Isotopes (CRITICAL RULES)**:
  - **Isotopes & Math (PRESERVE EXACTLY)**: Isotope mass numbers BEFORE or WITHIN the symbol (e.g., ¹⁴C, ²³⁹Pu, δ¹³C, ⁹⁰Sr) or math notation (log₁₀) MUST BE PRESERVED EXACTLY AS UNICODE SUPERSCRIPTS/SUBSCRIPTS. Do NOT convert ¹⁴C to 14C! Keep it as ¹⁴C. Do NOT convert δ¹³C to δ13C! Keep it as δ¹³C.
  - **Footnotes (STRIP & APPLY)**: Footnote markers AFTER the symbol (e.g., Cu¹, Fe²⁾, Zn *, Pb a)) are just references.
    - Step 1 — STRIP: Remove the marker → clean name: "Cu", "Fe", "Zn", "Pb".
    - Step 2 — FIND: Locate the actual footnote text (bottom of table, end of page, or referenced page).
    - Step 3 — APPLY: Route the footnote meaning to the correct field:
      - Mentions coverage factor / k-factor → set 'coverageFactor' on that quantity
      - Mentions probability / confidence level → set 'coverageProbability' on that quantity
      - Any other meaning → put in the quantity's 'description'
- **Uncertainty & Coverage (CRITICAL)**: Look for "k=2"/"coverage factor k=2" and "95% confidence" in captions/footnotes. Extract to coverageFactor and coverageProbability. If probability given as percentage (e.g. 95%), store as decimal (0.95).
  - **CRITICAL APPLICABILITY RULE**: The k-factor and coverage probability ONLY apply to rows/quantities that ACTUALLY HAVE an extracted 'uncertainty' numerical value. If a row's uncertainty is empty (e.g., it is a limit like "< 100", or just blank), you MUST NOT assign a coverageFactor or coverageProbability to that specific quantity row, regardless of what the column header footnote says. You cannot apply a confidence interval to an empty cell!
  - **Reasoning**: You MUST provide a 'coverageReasoning' at the MeasurementResult level explaining WHICH properties the k-factor/probability were assigned to, WHY they were assigned, and WHY they were NOT assigned to other properties (e.g., "The footnote 2) defines k=2 for the uncertainty column. Phosphorus has an uncertainty of 2.2, so k=2 is applied. Si, Ti, and V have blank uncertainties, so k=2 is NOT applied to them."). This reasoning will be displayed to the user.
**STATEMENTS**: Extract full text and fieldCoordinates for: Intended Use, Commutability, Storage Information, Handling Instructions, Metrological Traceability, Health & Safety, Subcontractors, Legal Notice, Reference to Certification Report.
- **Subcontractors**: Look for sections titled "Origin and preparation of the material", "Participating Laboratories", "Collaborating Laboratories", "Analyses Performed By" or "Subcontractors". Extract the FULL context of their involvement. Include the specific material name they worked on, the specific contractor company/institute name, their location/place, and details of what tasks they performed (e.g. prepared, homogenized, supplied). Do NOT just list names.
- **Certification Report**: Coordinates must be distinct from and BELOW Subcontractors section. If text contains pointer to other pages ("*Notes and references are on pages X"), go to those pages and extract actual content, not the pointer.

**ORIGINAL TEXT TRACKING**: For ANY transformed/normalized/inferred value, populate 'originalTexts' as JSON-encoded string: '{"fieldName":"verbatim PDF text"}'.
Examples: Date "31 December 2024"→specificTime="2024-12-31", originalTexts='{"specificTime":"31 December 2024"}'. Country inference "Vienna, Austria"→countryCode="AT", originalTexts='{"countryCode":"Austria"}'.
DO NOT include verbatim-copied values or generated values without PDF source. Set to null if nothing transformed.

Return ONLY the JSON object.
`;

// Helper for Coordinate Box [page, ymin, xmin, ymax, xmax]
const BoxSchema = {
    type: Type.ARRAY,
    items: { type: Type.INTEGER }
};

// originalTexts is a JSON-encoded string like '{"specificTime":"31 December 2024","countryCode":"Austria"}'
// to keep the schema small enough for the Gemini constraint limit.
const OriginalTextsSchema = {
    type: Type.STRING,
    nullable: true
};

const AdminCoordSchema = {
    type: Type.OBJECT,
    properties: {
        title: BoxSchema,
        uniqueIdentifier: BoxSchema,
        validityType: BoxSchema,
        specificTime: BoxSchema,
        dateOfIssue: BoxSchema,
        durationY: BoxSchema,
        durationM: BoxSchema
    },
    nullable: true
};

const ProducerCoordSchema = {
    type: Type.OBJECT,
    properties: {
        name: BoxSchema,
        email: BoxSchema,
        phone: BoxSchema,
        fax: BoxSchema,
        street: BoxSchema,
        streetNo: BoxSchema,
        postCode: BoxSchema,
        city: BoxSchema,
        countryCode: BoxSchema
    },
    nullable: true
};

const PersonCoordSchema = {
    type: Type.OBJECT,
    properties: {
        name: BoxSchema,
        role: BoxSchema,
        description: BoxSchema
    },
    nullable: true
};

const MaterialCoordSchema = {
    type: Type.OBJECT,
    properties: {
        name: BoxSchema,
        description: BoxSchema,
        materialClass: BoxSchema,
        itemQuantities: BoxSchema,
        minimumSampleSize: BoxSchema
    },
    nullable: true
};

const QuantityCoordSchema = {
    type: Type.OBJECT,
    properties: {
        name: BoxSchema,
        value: BoxSchema,
        unit: BoxSchema,
        uncertainty: BoxSchema,
        coverageFactor: BoxSchema,
        coverageProbability: BoxSchema
    },
    nullable: true
};

const StatementCoordSchema = {
    type: Type.OBJECT,
    properties: {
        intendedUse: BoxSchema,
        commutability: BoxSchema,
        storageInformation: BoxSchema,
        handlingInstructions: BoxSchema,
        metrologicalTraceability: BoxSchema,
        healthAndSafety: BoxSchema,
        subcontractors: BoxSchema,
        legalNotice: BoxSchema,
        referenceToCertificationReport: BoxSchema
    },
    nullable: true
};

// Response Schema Definition
const RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        administrativeData: {
            type: Type.OBJECT,
            properties: {
                title: { type: Type.STRING },
                validityType: { type: Type.STRING, enum: ["Until Revoked", "Time After Dispatch", "Specific Time"] },
                durationY: { type: Type.INTEGER },
                durationM: { type: Type.INTEGER },
                dateOfIssue: { type: Type.STRING },
                specificTime: { type: Type.STRING },
                fieldCoordinates: AdminCoordSchema,
                originalTexts: OriginalTextsSchema,
                producers: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            email: { type: Type.STRING },
                            phone: { type: Type.STRING },
                            fax: { type: Type.STRING },
                            fieldCoordinates: ProducerCoordSchema,
                            sectionCoordinates: BoxSchema,
                            originalTexts: OriginalTextsSchema,
                            address: {
                                type: Type.OBJECT,
                                properties: {
                                    street: { type: Type.STRING },
                                    streetNo: { type: Type.STRING },
                                    postCode: { type: Type.STRING },
                                    city: { type: Type.STRING },
                                    countryCode: { type: Type.STRING }
                                }
                            },
                            organizationIdentifiers: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        scheme: { type: Type.STRING },
                                        value: { type: Type.STRING },
                                        link: { type: Type.STRING }
                                    }
                                }
                            }
                        }
                    }
                },
                responsiblePersons: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            role: { type: Type.STRING },
                            description: { type: Type.STRING },
                            fieldCoordinates: PersonCoordSchema,
                            sectionCoordinates: BoxSchema,
                            originalTexts: OriginalTextsSchema
                        }
                    }
                }
            }
        },
        materials: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    description: { type: Type.STRING },
                    minimumSampleSize: { type: Type.STRING },
                    materialClass: { type: Type.STRING },
                    itemQuantities: { type: Type.STRING },
                    isCertified: { type: Type.BOOLEAN },
                    materialIdentifiers: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                scheme: { type: Type.STRING },
                                value: { type: Type.STRING },
                                link: { type: Type.STRING }
                            }
                        }
                    },
                    fieldCoordinates: MaterialCoordSchema,
                    sectionCoordinates: BoxSchema,
                    originalTexts: OriginalTextsSchema
                }
            }
        },
        properties: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    isCertified: { type: Type.BOOLEAN },
                    description: { type: Type.STRING },
                    procedures: { type: Type.STRING },
                    results: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                linkedMaterialName: { type: Type.STRING, description: "If the certificate contains multiple materials, explicitly link this table to the exact material name it corresponds to." },
                                description: { type: Type.STRING },
                                coverageReasoning: { type: Type.STRING, description: "Explain why k-factor and probability were assigned to certain properties and not others." },
                                sectionCoordinates: BoxSchema,
                                quantities: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            name: { type: Type.STRING },
                                            value: { type: Type.STRING },
                                            unit: { type: Type.STRING },
                                            dsiValue: { type: Type.STRING },
                                            dsiUnit: { type: Type.STRING },
                                            uncertainty: { type: Type.STRING },
                                            coverageFactor: { type: Type.STRING },
                                            coverageProbability: { type: Type.STRING },
                                            distribution: { type: Type.STRING },
                                            fieldCoordinates: QuantityCoordSchema
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        statements: {
            type: Type.OBJECT,
            properties: {
                official: {
                    type: Type.OBJECT,
                    properties: {
                        intendedUse: { type: Type.STRING },
                        storageInformation: { type: Type.STRING },
                        handlingInstructions: { type: Type.STRING },
                        metrologicalTraceability: { type: Type.STRING },
                        healthAndSafety: { type: Type.STRING },
                        subcontractors: { type: Type.STRING },
                        legalNotice: { type: Type.STRING },
                        referenceToCertificationReport: { type: Type.STRING },
                        fieldCoordinates: StatementCoordSchema
                    }
                }
            }
        }
    }
} as const;

export const extractStructuredDataFromPdf = async (base64File: string, mimeType: string, apiKey: string, temperature: number = 0): Promise<Partial<DRMD>> => {
    const ai = new GoogleGenAI({ apiKey: apiKey });

    let attempt = 0;
    const maxRetries = 3;
    let lastError: any = null;

    while (attempt < maxRetries) {
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash', 
                contents: {
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64File
                            }
                        },
                        { text: "Extract the structured data from this Reference Material Document." }
                    ]
                },
                config: {
                    systemInstruction: SYSTEM_INSTRUCTION,
                    responseMimeType: "application/json",
                    responseSchema: RESPONSE_SCHEMA,
                    temperature: temperature
                }
            });

            let jsonText = response.text;
            if (!jsonText) throw new Error("No data returned from Gemini Vision");
            
            // Sanitize markdown wrapper
            jsonText = jsonText.replace(/^```json/i, '').replace(/```$/i, '').trim();
            
            const parsedData = JSON.parse(jsonText) as Partial<DRMD>;

        // Post-processing: Parse originalTexts JSON strings into objects
        const parseOriginalTexts = (obj: any) => {
            if (!obj) return;
            if (typeof obj.originalTexts === 'string') {
                try {
                    obj.originalTexts = JSON.parse(obj.originalTexts);
                } catch (e) {
                    obj.originalTexts = undefined;
                }
            }
            for (const key in obj) {
                if (obj[key] !== null && typeof obj[key] === 'object') {
                    parseOriginalTexts(obj[key]);
                }
            }
        };
        parseOriginalTexts(parsedData);

        // Post-processing: Calculate D-SI values for Table Quantities
        if (parsedData.properties) {
             parsedData.properties.forEach(prop => {
                 if (prop.results) {
                     prop.results.forEach(res => {
                         if (res.quantities) {
                             res.quantities.forEach(q => {
                                 const dsi = convertToDSI(q.value, q.unit);
                                 (q as any).dsiValue = dsi.dsiValue;
                                 (q as any).dsiUnit = dsi.dsiUnit;
                             });
                         }
                     });
                 }
             });
        }

        // Removed destructive post-processing for Material Quantities (Item Quantities / Min Sample Size)
        // We now preserve exactly what Gemini extracted so the user can see/edit the raw text.
        // The DSI preview and conversion happens in the UI and XML Generation step respectively.
        
        return parsedData;

        } catch (error: any) {
            console.error(`Gemini Extraction Error (Attempt ${attempt + 1}):`, error);
            lastError = error;
            
            // Handle 429 Too Many Requests
            if (error?.status === 429 || error?.message?.includes('429')) {
                attempt++;
                if (attempt < maxRetries) {
                    const backoff = Math.pow(2, attempt) * 1000;
                    console.log(`Rate limited. Retrying in ${backoff}ms...`);
                    await new Promise(resolve => setTimeout(resolve, backoff));
                    continue;
                }
            } else if (error?.status === 400 || error?.status === 403) {
                // Do not retry on bad request or unauthorized
                throw new Error(`API Error: ${error.message || 'Invalid Request / API Key'}`);
            }
            
            throw new Error(`Failed to extract data: ${error.message || 'Unknown error'}`);
        }
    }
    throw lastError;
};