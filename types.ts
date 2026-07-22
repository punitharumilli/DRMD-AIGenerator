

export interface Identifier {
    scheme: string;
    value: string;
    link?: string;
}

export interface Address {
    street: string;
    streetNo: string;
    postCode: string;
    city: string;
    countryCode: string;
}

export interface HasCoordinates {
    fieldCoordinates?: Record<string, number[]>; // [pageIndex, ymin, xmin, ymax, xmax] (0-1000 scale)
    sectionCoordinates?: number[]; // [pageIndex, ymin, xmin, ymax, xmax] (0-1000 scale)
    originalTexts?: Record<string, string>; // Maps field name to original verbatim PDF text (only for transformed/normalized values)
}

export interface Producer extends HasCoordinates {
    uuid: string;
    name: string;
    email: string;
    phone: string;
    fax?: string;
    address: Address;
    organizationIdentifiers: Identifier[];
}

export interface ResponsiblePerson extends HasCoordinates {
    uuid: string;
    name: string;
    role: string;
    description: string;
    mainSigner: boolean;
    cryptElectronicSeal: boolean;
    cryptElectronicSignature: boolean;
    cryptElectronicTimeStamp: boolean;
}

export interface AdministrativeData extends HasCoordinates {
    title: string;
    uniqueIdentifier: string;
    dataVersion: number;
    documentIdentifiers: Identifier[];
    validityType: "Until Revoked" | "Time After Dispatch" | "Specific Time";
    durationY: number;
    durationM: number;
    dateOfIssue: string; // YYYY-MM-DD
    specificTime: string; // YYYY-MM-DD
    producers: Producer[];
    responsiblePersons: ResponsiblePerson[];
}

export interface Material extends HasCoordinates {
    uuid: string;
    xmlId: string;
    name: string;
    materialClass: string;
    description: string;
    itemQuantities: string;
    minimumSampleSize: string;
    isCertified: boolean;
    materialIdentifiers: Identifier[];
}

export interface Quantity extends HasCoordinates {
    uuid: string;
    name: string; // Element/Name
    label?: string;
    value: string;
    dsiValue: string; // Changed from siValue
    dsiUnit: string;  // Changed from siUnit
    quantityKind?: string;
    unit: string;
    uncertainty: string;
    coverageFactor: string;
    coverageProbability: string;
    distribution: string;
    identifiers: Identifier[];
}

export interface MeasurementResult extends HasCoordinates {
    uuid: string;
    name: string; // Table Name
    description: string;
    coverageReasoning?: string; // AI's reasoning for why kFactor/probability were assigned
    quantities: Quantity[];
    materialRef?: string; // Links this specific result table to a Material UUID
}

export interface MaterialProperty {
    uuid: string;
    id: string;
    name: string; // e.g., "Certified Values"
    description: string;
    isCertified: boolean;
    procedures: string;
    materialRef?: string; // UUID of linked material — generates refId on <drmd:properties>
    results: MeasurementResult[];
}

export interface OfficialStatements extends HasCoordinates {
    intendedUse: string;
    commutability: string;
    storageInformation: string;
    handlingInstructions: string;
    metrologicalTraceability: string;
    healthAndSafety: string;
    subcontractors: string;
    legalNotice: string;
    referenceToCertificationReport: string;
}

export interface CustomStatement {
    uuid: string;
    name: string;
    content: string;
}

export interface Statements {
    official: OfficialStatements;
    custom: CustomStatement[];
}

export interface Comment {
    uuid: string;
    author: string;
    date: string;
    content: string;
}

export interface AdditionalDocument {
    uuid: string;
    title: string;
    type: string;
    content: string;
}

export interface DRMD {
    administrativeData: AdministrativeData;
    materials: Material[];
    properties: MaterialProperty[];
    statements: Statements;
    comments: Comment[];
    documents: AdditionalDocument[];
    // New fields for the "Comment and Document" tab
    generalComment: string;
    binaryDocuments: {
        fileName: string;
        mimeType: string;
        data: string; // Base64 data
    }[];
}

export interface BulkResult {
    id: string;
    fileName: string;
    rmCode: string;
    rmName: string;
    status: 'pending' | 'processing' | 'done' | 'error';
    errorMessage?: string;
    xmlContent: string;
    htmlContent: string;
    drmdData: DRMD;
}

// Constants for Initial States
export const ALLOWED_TITLES = [
    "referenceMaterialCertificate",
    "productInformationSheet"
];

export const INITIAL_ID: Identifier = { scheme: "", value: "", link: "" };

export const INITIAL_PRODUCER: Producer = {
    uuid: "",
    name: "",
    email: "",
    phone: "",
    fax: "",
    address: { street: "", streetNo: "", postCode: "", city: "", countryCode: "" },
    organizationIdentifiers: [{ ...INITIAL_ID }]
};

export const INITIAL_PERSON: ResponsiblePerson = {
    uuid: "",
    name: "",
    role: "",
    description: "",
    mainSigner: false, // Default to false so only the first one (initialized manually) is true
    cryptElectronicSeal: false,
    cryptElectronicSignature: false,
    cryptElectronicTimeStamp: false
};

export const INITIAL_QUANTITY: Quantity = {
    uuid: "",
    name: "",
    label: "",
    value: "",
    dsiValue: "",
    dsiUnit: "",
    quantityKind: "",
    unit: "",
    uncertainty: "",
    coverageFactor: "",
    coverageProbability: "",
    distribution: "",
    identifiers: []
};

export const INITIAL_DRMD: DRMD = {
    administrativeData: {
        title: "referenceMaterialCertificate",
        uniqueIdentifier: "",
        dataVersion: 0,
        documentIdentifiers: [{ ...INITIAL_ID }],
        validityType: "Until Revoked",
        durationY: 0,
        durationM: 0,
        dateOfIssue: "",
        specificTime: "",
        producers: [{ ...INITIAL_PRODUCER }],
        responsiblePersons: [{ ...INITIAL_PERSON, mainSigner: true }] // First person defaults to Main Signer
    },
    materials: [],
    properties: [],
    statements: {
        official: {
            intendedUse: "",
            commutability: "",
            storageInformation: "",
            handlingInstructions: "",
            metrologicalTraceability: "",
            healthAndSafety: "",
            subcontractors: "",
            legalNotice: "",
            referenceToCertificationReport: ""
        },
        custom: []
    },
    comments: [],
    documents: [],
    generalComment: "",
    binaryDocuments: []
};