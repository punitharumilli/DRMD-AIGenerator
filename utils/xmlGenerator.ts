

import { DRMD } from "../types";
import { convertToDSI } from "./unitConverter";
import { getCasNumber } from "./casMapping";

const escapeXml = (unsafe: string | undefined | number | boolean) => {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe).replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

const sanitizeForId = (s: string) => s ? s.replace(/[^a-zA-Z0-9_-]/g, "_") : "unknown";

const renderValidity = (data: DRMD["administrativeData"]) => {
    if (data.validityType === "Until Revoked") {
        return "        <drmd:untilRevoked>true</drmd:untilRevoked>";
    } else if (data.validityType === "Specific Time") {
        return `        <drmd:specificTime>${escapeXml(data.specificTime)}</drmd:specificTime>`;
    } else if (data.validityType === "Time After Dispatch") {
        let iso = "P";
        if (data.durationY) iso += `${data.durationY}Y`;
        if (data.durationM) iso += `${data.durationM}M`;
        if (iso === "P") iso = "P0Y"; 
        let xml = `        <drmd:timeAfterDispatch>\n`;
        if (data.dateOfIssue) {
            xml += `          <drmd:dispatchDate>${escapeXml(data.dateOfIssue)}</drmd:dispatchDate>\n`;
        }
        xml += `          <drmd:period>${iso}</drmd:period>\n`;
        xml += `        </drmd:timeAfterDispatch>`;
        return xml;
    }
    return "";
};

// Helper to render primitive quantity types (MinimumSampleSize, ItemQuantities)
// Follows dcc_primitiveQuantityType structure with a choice between drmd:real and drmd:noQuantity
const renderPrimitiveQuantity = (value: string) => {
    if (!value || value === "noQuantity") {
        return `
          <drmd:noQuantity>
            <dcc:content>noQuantity</dcc:content>
          </drmd:noQuantity>`;
    }
    
    const trimmed = value.trim();

    // If it's a range, drop down to noQuantity
    if (/^[\d.]+\s*(?:-|to|–)\s*[\d.]+\s*\S*$/.test(trimmed)) {
        return `
          <drmd:noQuantity>
            <dcc:content>${escapeXml(trimmed)}</dcc:content>
          </drmd:noQuantity>`;
    }
    
    const regex = /^([\d.]+(?:[eE][+-]?\d+)?)\s*(\S.*)$/;
    const match = trimmed.match(regex);
    
    if (match) {
        const numPart = match[1];
        const unitPart = match[2];
        const dsi = convertToDSI(numPart, unitPart);
        
        if (dsi.dsiUnit) {
            return `
          <drmd:real>
            <si:value>${escapeXml(dsi.dsiValue)}</si:value>
            <si:unit>${escapeXml(dsi.dsiUnit)}</si:unit>
          </drmd:real>`;
        }
    }
    
    return `
          <drmd:noQuantity>
            <dcc:content>${escapeXml(trimmed)}</dcc:content>
          </drmd:noQuantity>`;
};

const renderAdvancedQuantity = (q: any) => {
    const val = (q.value || "").trim();
    const unit = q.dsiUnit || q.unit || "";
    
    if (!val) {
        return `
                <dcc:noQuantity>
                  <dcc:content lang="en">Not specified</dcc:content>
                </dcc:noQuantity>`;
    }

    // 1. Range -> dcc:noQuantity
    if (/^[\d.]+\s*(?:-|to|–)\s*[\d.]+$/.test(val)) {
        return `
                <dcc:noQuantity>
                  <dcc:content lang="en">${escapeXml(val)}${unit ? ' ' + escapeXml(unit) : ''}</dcc:content>
                </dcc:noQuantity>`;
    }
    
    // 2. Single Number (si:real)
    if (/^[<>]?\s*[-+]?[\d.]+(?:[eE][-+]?\d+)?$/.test(val)) {
        let xml = `
                <si:real>
                  <si:value>${escapeXml(val)}</si:value>
                  <si:unit>${escapeXml(unit)}</si:unit>`;
        
        if (q.uncertainty) {
            xml += `
                  <si:measurementUncertaintyUnivariate>
                    <si:expandedMU>
                      <si:valueExpandedMU>${escapeXml(q.uncertainty)}</si:valueExpandedMU>`;
            if (q.coverageFactor) {
                xml += `
                      <si:coverageFactor>${escapeXml(q.coverageFactor)}</si:coverageFactor>`;
            }
            if (q.coverageProbability) {
                xml += `
                      <si:coverageProbability>${escapeXml(q.coverageProbability)}</si:coverageProbability>`;
            }
            xml += `
                    </si:expandedMU>
                  </si:measurementUncertaintyUnivariate>`;
        }
        xml += `
                </si:real>`;
        return xml;
    }

    // 3. List of numbers (si:realListXMLList)
    const parts = val.split(/\s+/);
    const allNumbers = parts.every((p: string) => /^[-+]?[\d.]+(?:[eE][-+]?\d+)?$/.test(p));
    if (parts.length > 1 && allNumbers) {
        let xml = `
                <si:realListXMLList>`;
        parts.forEach((num: string) => {
            xml += `
                  <si:valueXMLList>${escapeXml(num)}</si:valueXMLList>`;
        });
        parts.forEach(() => {
            xml += `
                  <si:unitXMLList>${escapeXml(unit)}</si:unitXMLList>`;
        });
        xml += `
                </si:realListXMLList>`;
        return xml;
    }

    // 4. List of chars/codes (dcc:charsXMLList)
    const looksLikeCodes = parts.length > 1 && parts.every((p: string) => /^[A-Z0-9-]+$/.test(p));
    if (looksLikeCodes) {
        return `
                <dcc:charsXMLList>${escapeXml(val)}</dcc:charsXMLList>`;
    }

    // 5. Fallback Text (dcc:noQuantity)
    return `
                <dcc:noQuantity>
                  <dcc:content lang="en">${escapeXml(val)}${unit ? ' ' + escapeXml(unit) : ''}</dcc:content>
                </dcc:noQuantity>`;
};

// Helper: collect coordinate annotations from DRMD entities into a JSON-safe structure
const hasCoordData = (entity: { fieldCoordinates?: Record<string, number[]>; sectionCoordinates?: number[]; originalTexts?: Record<string, string> }) => {
    return (entity.fieldCoordinates && Object.keys(entity.fieldCoordinates).length > 0) ||
           (entity.sectionCoordinates && entity.sectionCoordinates.length > 0) ||
           (entity.originalTexts && Object.keys(entity.originalTexts).length > 0);
};

const pickCoords = (entity: { fieldCoordinates?: Record<string, number[]>; sectionCoordinates?: number[]; originalTexts?: Record<string, string> }) => {
    const obj: Record<string, unknown> = {};
    if (entity.fieldCoordinates && Object.keys(entity.fieldCoordinates).length > 0) obj.fieldCoordinates = entity.fieldCoordinates;
    if (entity.sectionCoordinates && entity.sectionCoordinates.length > 0) obj.sectionCoordinates = entity.sectionCoordinates;
    if (entity.originalTexts && Object.keys(entity.originalTexts).length > 0) obj.originalTexts = entity.originalTexts;
    return obj;
};

const generateAnnotationsComment = (data: DRMD): string => {
    const annotations: Record<string, unknown> = {};

    // Producers
    const producers = data.administrativeData.producers
        .map(p => hasCoordData(p) ? pickCoords(p) : null)
        .filter(p => p !== null);
    if (producers.length > 0) annotations.producers = producers;

    // Responsible Persons
    const responsiblePersons = data.administrativeData.responsiblePersons
        .map(p => hasCoordData(p) ? pickCoords(p) : null)
        .filter(p => p !== null);
    if (responsiblePersons.length > 0) annotations.responsiblePersons = responsiblePersons;

    // Materials
    const materials = data.materials
        .map(m => hasCoordData(m) ? pickCoords(m) : null)
        .filter(m => m !== null);
    if (materials.length > 0) annotations.materials = materials;

    // Administrative Data (top-level coordinates)
    if (hasCoordData(data.administrativeData)) {
        annotations.administrativeData = pickCoords(data.administrativeData);
    }

    // Properties (with nested results and quantities)
    const properties = data.properties.map(prop => {
        const propEntry: Record<string, unknown> = {};
        const results = prop.results.map(res => {
            const resEntry: Record<string, unknown> = {};
            if (hasCoordData(res)) Object.assign(resEntry, pickCoords(res));
            const quantities = res.quantities
                .map(q => hasCoordData(q) ? pickCoords(q) : null)
                .filter(q => q !== null);
            if (quantities.length > 0) resEntry.quantities = quantities;
            return Object.keys(resEntry).length > 0 ? resEntry : null;
        }).filter(r => r !== null);
        if (results.length > 0) propEntry.results = results;
        return Object.keys(propEntry).length > 0 ? propEntry : null;
    }).filter(p => p !== null);
    if (properties.length > 0) annotations.properties = properties;

    // Statements
    if (hasCoordData(data.statements.official)) {
        annotations.statements = pickCoords(data.statements.official);
    }

    // Only produce a comment if there is any coordinate data
    if (Object.keys(annotations).length === 0) return '';

    const json = JSON.stringify(annotations);
    return `\n<!-- DRMD-GENERATOR-ANNOTATIONS: This section is auto-generated by the AI-powered DRMD Generator for PDF coordinate tracking and highlighting. It does not affect schema validation. DATA:${json} -->`;
};

export const generateDrmdXml = (data: DRMD): string => {
    const header = `<?xml version='1.0' encoding='utf-8'?>
<drmd:digitalReferenceMaterialDocument xmlns:dcc="https://ptb.de/dcc" xmlns:drmd="https://www.bam.de/drmd" xmlns:si="https://ptb.de/si" schemaVersion="0.3.0">`;

    // --- Administrative Data ---
    let adminXml = `
  <drmd:administrativeData>
    <drmd:coreData>
      <drmd:titleOfTheDocument>${escapeXml(data.administrativeData.title)}</drmd:titleOfTheDocument>
      <drmd:uniqueIdentifier>${escapeXml(data.administrativeData.uniqueIdentifier)}</drmd:uniqueIdentifier>
      <drmd:validity>
${renderValidity(data.administrativeData)}
      </drmd:validity>
    </drmd:coreData>`;

    // Producers
    (data.administrativeData?.producers || []).forEach(prod => {
        adminXml += `
    <drmd:referenceMaterialProducer>
      <drmd:name>
        <dcc:content>${escapeXml(prod.name)}</dcc:content>
      </drmd:name>
      <drmd:contact>
        <dcc:name>
          <dcc:content>${escapeXml(prod.name)}</dcc:content>
        </dcc:name>
        <dcc:eMail>${escapeXml(prod.email)}</dcc:eMail>
        <dcc:phone>${escapeXml(prod.phone)}</dcc:phone>
        ${prod.fax ? `<dcc:fax>${escapeXml(prod.fax)}</dcc:fax>` : ''}
        <dcc:location>
          <dcc:street>${escapeXml(prod?.address?.street)}</dcc:street>
          <dcc:streetNo>${escapeXml(prod?.address?.streetNo)}</dcc:streetNo>
          <dcc:postCode>${escapeXml(prod?.address?.postCode)}</dcc:postCode>
          <dcc:city>${escapeXml(prod?.address?.city)}</dcc:city>
          <dcc:countryCode>${escapeXml(prod?.address?.countryCode)}</dcc:countryCode>
        </dcc:location>
      </drmd:contact>
    </drmd:referenceMaterialProducer>`;
    });

    // Responsible Persons
    if (data.administrativeData.responsiblePersons.length > 0) {
        adminXml += `
    <drmd:respPersons>`;
        (data.administrativeData?.responsiblePersons || []).forEach(p => {
            adminXml += `
      <dcc:respPerson>
        <dcc:person>
          <dcc:name>
            <dcc:content>${escapeXml(p.name)}</dcc:content>
          </dcc:name>
        </dcc:person>`;
            if (p.description) {
                adminXml += `
        <dcc:description>
          <dcc:content>${escapeXml(p.description)}</dcc:content>
        </dcc:description>`;
            }
            adminXml += `
        <dcc:role>${escapeXml(p.role)}</dcc:role>
        <dcc:mainSigner>${p.mainSigner}</dcc:mainSigner>
      </dcc:respPerson>`;
        });
        adminXml += `
    </drmd:respPersons>`;
    }
    adminXml += `
  </drmd:administrativeData>`;

    // --- Materials ---
    let materialsXml = `
  <drmd:materials>`;
    (data.materials || []).forEach(mat => {
        
        materialsXml += `
    <drmd:material>
      <drmd:name>
        <dcc:content>${escapeXml(mat.name)}</dcc:content>
      </drmd:name>
      <drmd:description>
        <dcc:content>${escapeXml(mat.description)}</dcc:content>
      </drmd:description>`;
        materialsXml += `
      <drmd:minimumSampleSize>
        <dcc:itemQuantity>${renderPrimitiveQuantity(mat.minimumSampleSize)}
        </dcc:itemQuantity>
      </drmd:minimumSampleSize>`;
        if (mat.itemQuantities) {
            materialsXml += `
      <drmd:itemQuantities>
        <dcc:itemQuantity>${renderPrimitiveQuantity(mat.itemQuantities)}
        </dcc:itemQuantity>
      </drmd:itemQuantities>`;
        }

        // Add Material Identifiers (e.g. BAM-M386a) below quantities
        const validIds = [...(mat.materialIdentifiers || []).filter(id => id.value && id.value.trim() !== "")];
        
        // Ensure RM Code is included as a catalogNumber identifier
        const rmCode = data.administrativeData.uniqueIdentifier;
        if (rmCode && !validIds.some(id => id.scheme === 'catalogNumber' && id.value === rmCode)) {
            validIds.unshift({ scheme: 'catalogNumber', value: rmCode });
        }

        if (validIds.length > 0) {
            materialsXml += `
      <drmd:materialIdentifiers>`;
            validIds.forEach((id, idx) => {
                // Add the XML ID to the first identifier (or specifically the catalogNumber one)
                const idAttr = idx === 0 ? ` id="${escapeXml(mat.xmlId || `mat_${sanitizeForId(mat.name)}`)}"` : '';
                materialsXml += `
        <drmd:materialIdentifier${idAttr}>
          <drmd:scheme>${escapeXml(id.scheme || 'MaterialID')}</drmd:scheme>
          <drmd:value>${escapeXml(id.value)}</drmd:value>
        </drmd:materialIdentifier>`;
            });
            materialsXml += `
      </drmd:materialIdentifiers>`;
        }

        materialsXml += `
    </drmd:material>`;
    });
    materialsXml += `
  </drmd:materials>`;

    // --- Properties ---
    let propertiesXml = `
  <drmd:propertiesList>`;
    (data.properties || []).forEach(prop => {
        const certifiedValue = data.administrativeData.title === 'productInformationSheet' ? false : prop.isCertified;
        propertiesXml += `
    <drmd:properties isCertified="${certifiedValue}">
      <drmd:name>
        <dcc:content>${escapeXml(prop.name)}</dcc:content>
      </drmd:name>`;
        if (prop.description) {
            propertiesXml += `
      <drmd:description>
        <dcc:content>${escapeXml(prop.description)}</dcc:content>
      </drmd:description>`;
        }
        if (prop.procedures) {
            propertiesXml += `
      <drmd:procedures>
        <dcc:usedMethod>
          <dcc:name>
            <dcc:content>Procedure</dcc:content>
          </dcc:name>
          <dcc:description>
            <dcc:content>${escapeXml(prop.procedures)}</dcc:content>
          </dcc:description>
        </dcc:usedMethod>
      </drmd:procedures>`;
        }
        propertiesXml += `
      <drmd:results>`;
        (prop?.results || []).forEach(res => {
            // Determine the linked material ID for this specific result table
            let linkedMaterialId = "";
            if (res.materialRef) {
                const mat = data.materials.find(m => m.uuid === res.materialRef);
                if (mat) linkedMaterialId = mat.xmlId || `mat_${sanitizeForId(mat.name)}`;
            } else if (data.materials.length === 1) {
                linkedMaterialId = data.materials[0].xmlId || `mat_${sanitizeForId(data.materials[0].name)}`;
            }

            propertiesXml += `
        <drmd:result>`;
            if (linkedMaterialId) {
                propertiesXml += `
          <drmd:linkedMaterialIdentifier id="${escapeXml(linkedMaterialId)}"/>`;
            }
            propertiesXml += `
          <drmd:name>
            <dcc:content>${escapeXml(res.name || "Values")}</dcc:content>
          </drmd:name>`;
            if (res.description) {
                propertiesXml += `
          <drmd:description>
            <dcc:content>${escapeXml(res.description)}</dcc:content>
          </drmd:description>`;
            }
            propertiesXml += `
          <drmd:data>
            <drmd:list>`;
            (res?.quantities || []).forEach(q => {
                // Use original value as requested, and DSI unit if available
                const val = q.value;
                const unit = q.dsiUnit || q.unit;
                
                propertiesXml += `
              <drmd:quantity>
                <dcc:name>
                  <dcc:content>${escapeXml(q.name)}</dcc:content>
                </dcc:name>${renderAdvancedQuantity(q)}`;

                // Automatically generate CAS Identifier if available
                const casNumber = getCasNumber(q.name);
                if (casNumber) {
                    propertiesXml += `
                <drmd:propertyIdentifiers>
                    <drmd:propertyIdentifier>
                        <drmd:scheme>CAS</drmd:scheme>
                        <drmd:value>${escapeXml(casNumber)}</drmd:value>
                        <drmd:link>https://commonchemistry.cas.org/detail?cas_rn=${escapeXml(casNumber)}</drmd:link>
                    </drmd:propertyIdentifier>
                </drmd:propertyIdentifiers>`;
                }

                propertiesXml += `
              </drmd:quantity>`;
            });
            propertiesXml += `
            </drmd:list>
          </drmd:data>
        </drmd:result>`;
        });
        propertiesXml += `
      </drmd:results>
    </drmd:properties>`;
    });
    propertiesXml += `
  </drmd:propertiesList>`;

    // --- Statements ---
    const st = data.statements?.official || {};
    let statementsXml = `
  <drmd:statements>`;
    
    const addStatement = (tag: string, name: string, content: string) => {
        if (!content) return '';
        return `
    <drmd:${tag}>
      <dcc:name>
        <dcc:content>${escapeXml(name)}</dcc:content>
      </dcc:name>
      <dcc:content>${escapeXml(content)}</dcc:content>
    </drmd:${tag}>`;
    };

    statementsXml += addStatement("intendedUse", "Intended Use", st.intendedUse);
    statementsXml += addStatement("commutability", "Commutability", st.commutability);
    statementsXml += addStatement("storageInformation", "Storage Information", st.storageInformation);
    statementsXml += addStatement("instructionsForHandlingAndUse", "Handling Instructions", st.handlingInstructions);
    statementsXml += addStatement("metrologicalTraceability", "Metrological Traceability", st.metrologicalTraceability);
    statementsXml += addStatement("healthAndSafetyInformation", "Health And Safety Information", st.healthAndSafety);
    statementsXml += addStatement("subcontractors", "Subcontractors", st.subcontractors);
    statementsXml += addStatement("legalNotice", "Legal Notice", st.legalNotice);
    statementsXml += addStatement("referenceToCertificationReport", "Reference to Certification Report", st.referenceToCertificationReport);
    
    statementsXml += `
  </drmd:statements>`;

    // --- Comment and Document ---
    let extraXml = '';
    if (data.generalComment) {
        extraXml += `
  <drmd:comment>${escapeXml(data.generalComment)}</drmd:comment>`;
    }
    if (data.binaryDocuments && data.binaryDocuments.length > 0) {
        data.binaryDocuments.forEach(doc => {
            if (doc.data) {
                extraXml += `
  <drmd:document>${doc.data}</drmd:document>`;
            }
        });
    }

    const footer = `
</drmd:digitalReferenceMaterialDocument>`;

    const annotationsComment = generateAnnotationsComment(data);

    return header + adminXml + materialsXml + propertiesXml + statementsXml + extraXml + annotationsComment + footer;
};