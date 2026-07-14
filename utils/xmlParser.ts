

import { 
    DRMD, INITIAL_DRMD, INITIAL_PRODUCER, INITIAL_PERSON, INITIAL_QUANTITY, INITIAL_ID,
    Producer, ResponsiblePerson, Material, MaterialProperty, MeasurementResult, Quantity 
} from "../types";

const getTagContent = (parent: Element | Document, tagName: string): string => {
    const el = parent.getElementsByTagName(tagName)[0];
    return el?.textContent || "";
};

const getNestedContent = (parent: Element, path: string[]): string => {
    let current: Element = parent;
    for (const tag of path) {
        const elements = current.getElementsByTagName(tag);
        if (elements.length === 0) return "";
        current = elements[0];
    }
    return current.textContent || "";
};

export const parseDrmdXml = (xmlString: string): DRMD => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    
    // Check for parse errors
    const errorNode = doc.querySelector("parsererror");
    if (errorNode) {
        throw new Error("Invalid XML file structure");
    }

    const data: DRMD = JSON.parse(JSON.stringify(INITIAL_DRMD));

    // Helper for UUIDs
    const uuid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

    // --- Administrative Data ---
    const admin = doc.getElementsByTagName("drmd:administrativeData")[0];
    if (admin) {
        const core = admin.getElementsByTagName("drmd:coreData")[0];
        if (core) {
            data.administrativeData.title = getNestedContent(core, ["drmd:titleOfTheDocument"]);
            data.administrativeData.uniqueIdentifier = getNestedContent(core, ["drmd:uniqueIdentifier"]);
            
            // Validity
            const validity = core.getElementsByTagName("drmd:validity")[0];
            if (validity) {
                if (validity.getElementsByTagName("drmd:untilRevoked").length > 0) {
                    data.administrativeData.validityType = "Until Revoked";
                } else if (validity.getElementsByTagName("drmd:specificTime").length > 0) {
                    data.administrativeData.validityType = "Specific Time";
                    data.administrativeData.specificTime = getNestedContent(validity, ["drmd:specificTime"]);
                } else if (validity.getElementsByTagName("drmd:timeAfterDispatch").length > 0) {
                    data.administrativeData.validityType = "Time After Dispatch";
                    const tad = validity.getElementsByTagName("drmd:timeAfterDispatch")[0];
                    const period = getNestedContent(tad, ["drmd:period"]); // e.g. P1Y
                    const date = getNestedContent(tad, ["drmd:dispatchDate"]);
                    
                    data.administrativeData.dateOfIssue = date;
                    
                    // Parse Period PnYnM
                    const y = period.match(/(\d+)Y/);
                    const m = period.match(/(\d+)M/);
                    data.administrativeData.durationY = y ? parseInt(y[1]) : 0;
                    data.administrativeData.durationM = m ? parseInt(m[1]) : 0;
                }
            }
        }

        // Producers
        const producers = admin.getElementsByTagName("drmd:referenceMaterialProducer");
        if (producers.length > 0) {
            data.administrativeData.producers = Array.from(producers).map(p => {
                const prod: Producer = { ...INITIAL_PRODUCER, uuid: uuid(), address: { ...INITIAL_PRODUCER.address } };
                // Name structure: <drmd:name><dcc:content>Name</dcc:content></drmd:name>
                prod.name = getNestedContent(p, ["drmd:name", "dcc:content"]);
                
                const contact = p.getElementsByTagName("drmd:contact")[0];
                if (contact) {
                    prod.email = getNestedContent(contact, ["dcc:eMail"]);
                    prod.phone = getNestedContent(contact, ["dcc:phone"]);
                    prod.fax = getNestedContent(contact, ["dcc:fax"]);
                    
                    const loc = contact.getElementsByTagName("dcc:location")[0];
                    if (loc) {
                        prod.address.street = getNestedContent(loc, ["dcc:street"]);
                        prod.address.streetNo = getNestedContent(loc, ["dcc:streetNo"]);
                        prod.address.postCode = getNestedContent(loc, ["dcc:postCode"]);
                        prod.address.city = getNestedContent(loc, ["dcc:city"]);
                        prod.address.countryCode = getNestedContent(loc, ["dcc:countryCode"]);
                    }
                }
                return prod;
            });
        }

        // Responsible Persons
        const persons = admin.getElementsByTagName("dcc:respPerson");
        if (persons.length > 0) {
            data.administrativeData.responsiblePersons = Array.from(persons).map(p => {
                const per: ResponsiblePerson = { ...INITIAL_PERSON, uuid: uuid() };
                per.name = getNestedContent(p, ["dcc:person", "dcc:name", "dcc:content"]);
                per.description = getNestedContent(p, ["dcc:description", "dcc:content"]);
                per.role = getTagContent(p, "dcc:role");
                per.mainSigner = getTagContent(p, "dcc:mainSigner") === "true";
                return per;
            });
        }
    }

    // --- Materials ---
    const materials = doc.getElementsByTagName("drmd:material");
    if (materials.length > 0) {
        data.materials = Array.from(materials).map(m => {
            let xmlId = "";
            const ids = m.getElementsByTagName("drmd:materialIdentifier");
            if (ids.length > 0) {
                xmlId = ids[0].getAttribute("id") || "";
            }

            const mat: Material = {
                uuid: uuid(),
                xmlId,
                name: getNestedContent(m, ["drmd:name", "dcc:content"]),
                description: getNestedContent(m, ["drmd:description", "dcc:content"]),
                materialClass: "",
                minimumSampleSize: "",
                itemQuantities: "",
                isCertified: false,
                materialIdentifiers: [{...INITIAL_ID}]
            };

            const parseQty = (tagName: string) => {
                const container = m.getElementsByTagName(tagName)[0];
                if (!container) return "";
                const itemQ = container.getElementsByTagName("dcc:itemQuantity")[0];
                if (!itemQ) return "";
                
                // Try real (Value + Unit)
                const real = itemQ.getElementsByTagName("drmd:real")[0];
                if (real) {
                    const val = getNestedContent(real, ["si:value"]);
                    const unit = getNestedContent(real, ["si:unit"]);
                    return `${val} ${unit}`;
                }
                // Try noQuantity
                const noQ = itemQ.getElementsByTagName("drmd:noQuantity")[0];
                if (noQ) {
                    return getNestedContent(noQ, ["dcc:content"]);
                }
                return "";
            };

            mat.minimumSampleSize = parseQty("drmd:minimumSampleSize");
            mat.itemQuantities = parseQty("drmd:itemQuantities");

            return mat;
        });
    }

    // --- Properties ---
    const props = doc.getElementsByTagName("drmd:properties");
    if (props.length > 0) {
        data.properties = Array.from(props).map(p => {
            const prop: MaterialProperty = {
                uuid: uuid(),
                id: "",
                name: getNestedContent(p, ["drmd:name", "dcc:content"]),
                description: getNestedContent(p, ["drmd:description", "dcc:content"]),
                procedures: getNestedContent(p, ["drmd:procedures", "dcc:usedMethod", "dcc:description", "dcc:content"]),
                isCertified: p.getAttribute("isCertified") === "true",
                results: []
            };

            const results = p.getElementsByTagName("drmd:result");
            prop.results = Array.from(results).map(r => {
                const linkTag = r.getElementsByTagName("drmd:linkedMaterialIdentifier")[0];
                let refMatId = "";
                if (linkTag) {
                    const idAttr = linkTag.getAttribute("id");
                    if (idAttr) {
                        const matchedMat = data.materials.find(m => m.xmlId === idAttr);
                        if (matchedMat) refMatId = matchedMat.uuid;
                    }
                }

                const res: MeasurementResult = {
                    uuid: uuid(),
                    name: getNestedContent(r, ["drmd:name", "dcc:content"]),
                    description: getNestedContent(r, ["drmd:description", "dcc:content"]),
                    materialRef: refMatId,
                    quantities: []
                };

                const quants = r.getElementsByTagName("drmd:quantity");
                res.quantities = Array.from(quants).map(q => {
                    const quant: Quantity = { ...INITIAL_QUANTITY, uuid: uuid(), identifiers: [] };
                    quant.name = getNestedContent(q, ["dcc:name", "dcc:content"]);
                    
                    const real = q.getElementsByTagName("si:real")[0];
                    if (real) {
                        quant.value = getNestedContent(real, ["si:value"]);
                        quant.unit = getNestedContent(real, ["si:unit"]);
                        quant.dsiUnit = quant.unit;
                        quant.dsiValue = quant.value;
                        
                        const expandedMU = real.getElementsByTagName("si:expandedMU")[0];
                        if (expandedMU) {
                             quant.uncertainty = getNestedContent(expandedMU, ["si:valueExpandedMU"]);
                             quant.coverageFactor = getNestedContent(expandedMU, ["si:coverageFactor"]);
                             quant.coverageProbability = getNestedContent(expandedMU, ["si:coverageProbability"]);
                        }
                    }
                    return quant;
                });
                return res;
            });

            return prop;
        });
    }

    // --- Statements ---
    const statements = doc.getElementsByTagName("drmd:statements")[0];
    if (statements) {
        const getSt = (tag: string) => {
             const el = statements.getElementsByTagName("drmd:" + tag)[0];
             if (!el) return "";
             
             // Iterate direct children to find dcc:content and avoid matching nested dcc:content in dcc:name
             for (let i = 0; i < el.childNodes.length; i++) {
                 const node = el.childNodes[i] as Element;
                 if (node.nodeType === 1 && node.tagName === "dcc:content") {
                     return node.textContent || "";
                 }
             }
             return "";
        };

        data.statements.official.intendedUse = getSt("intendedUse");
        data.statements.official.storageInformation = getSt("storageInformation");
        data.statements.official.handlingInstructions = getSt("instructionsForHandlingAndUse");
        data.statements.official.metrologicalTraceability = getSt("metrologicalTraceability");
        data.statements.official.subcontractors = getSt("subcontractors");
        data.statements.official.referenceToCertificationReport = getSt("referenceToCertificationReport");
        data.statements.official.healthAndSafety = getSt("healthAndSafetyInformation");
        data.statements.official.legalNotice = getSt("legalNotice");
    }

    // --- Comments & Document ---
    data.generalComment = getTagContent(doc, "drmd:comment");
    
    const docElements = doc.getElementsByTagName("drmd:document");
    if (docElements.length > 0) {
        data.binaryDocuments = Array.from(docElements).map((el, index) => {
            const content = el.textContent || "";
            return {
                fileName: `imported_document_${index + 1}.pdf`,
                mimeType: "application/pdf", 
                data: content.trim()
            };
        }).filter(d => d.data.length > 0);
    }

    return data;
};
