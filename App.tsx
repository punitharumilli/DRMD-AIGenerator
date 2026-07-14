import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
    DRMD, INITIAL_DRMD, INITIAL_PRODUCER, INITIAL_PERSON, INITIAL_ID, INITIAL_QUANTITY, ALLOWED_TITLES, BulkResult
} from './types';
import { extractStructuredDataFromPdf } from './services/llmService';
import { generateDrmdXml } from './utils/xmlGenerator';
import { convertToDSI, getDsiPreview } from './utils/unitConverter';
import { parseDrmdXml } from './utils/xmlParser';
import { validateDrmd } from './utils/validator';
import { getCasNumber } from './utils/casMapping';

// Helper for UUIDs
const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
};

// Helper for HTML Report Generation
const generateHtmlReport = (data: DRMD) => {
    const styles = `
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; padding: 40px; line-height: 1.5; }
        h1 { font-size: 28px; font-weight: 700; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 30px; color: #111827; }
        h2 { font-size: 20px; font-weight: 600; margin-top: 40px; margin-bottom: 20px; color: #374151; background-color: #f3f4f6; padding: 10px 15px; border-radius: 8px; }
        h3 { font-size: 16px; font-weight: 600; margin-top: 25px; margin-bottom: 15px; color: #4b5563; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }
        th { text-align: left; padding: 10px; color: #6b7280; font-weight: 600; width: 20%; vertical-align: top; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
        td { padding: 10px; color: #111827; vertical-align: top; border-bottom: 1px solid #e5e7eb; }
        .footer { margin-top: 60px; font-size: 12px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 20px; }
        .tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
        .tag-green { background: #dcfce7; color: #166534; }
        .tag-yellow { background: #fef9c3; color: #854d0e; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
    `;

    const renderRow = (label: string, value: any) => {
        if (value === undefined || value === null || value === "") return '';
        return `<tr><th>${label}</th><td>${value}</td></tr>`;
    };

    let adminRows = '';
    adminRows += renderRow('Title', data.administrativeData.title);
    adminRows += renderRow('Unique Identifier', data.administrativeData.uniqueIdentifier);
    adminRows += renderRow('Validity Type', data.administrativeData.validityType);
    if (data.administrativeData.validityType === 'Specific Time') {
        adminRows += renderRow('Valid Until', data.administrativeData.specificTime);
    } else if (data.administrativeData.validityType === 'Time After Dispatch') {
         adminRows += renderRow('Duration', `${data.administrativeData.durationY} Years ${data.administrativeData.durationM} Months`);
         adminRows += renderRow('Dispatch Date', data.administrativeData.dateOfIssue);
    }

    const producerRows = data.administrativeData.producers.map((p, i) => {
        let rows = `<tr><th colspan="2" style="background: #e0e7ff; color: #3730a3; padding-top: 15px;">Producer ${i+1}</th></tr>`;
        rows += renderRow('Name', p.name);
        rows += renderRow('Email', p.email);
        rows += renderRow('Phone', p.phone);
        rows += renderRow('Fax', p.fax);
        const address = `${p.address.street} ${p.address.streetNo}, ${p.address.postCode} ${p.address.city}, ${p.address.countryCode}`.trim();
        rows += renderRow('Address', address.replace(/ ,/g, ''));
        return rows;
    }).join('');

    const personRows = data.administrativeData.responsiblePersons.map((p, i) => {
        let rows = `<tr><th colspan="2" style="background: #e0e7ff; color: #3730a3; padding-top: 15px;">Responsible Person ${i+1}</th></tr>`;
        rows += renderRow('Name', `${p.name} ${p.mainSigner ? '<span class="tag tag-green">Main Signer</span>' : ''}`);
        rows += renderRow('Role', p.role);
        rows += renderRow('Description', p.description);
        return rows;
    }).join('');

    const materialHtml = data.materials.map((m, i) => `
        <h3>Material ${i+1}: ${m.name}</h3>
        <table>
            ${renderRow('Description', m.description)}
            ${renderRow('Material Class', m.materialClass)}
            ${renderRow('Min Sample Size', m.minimumSampleSize)}
            ${renderRow('Item Quantities', m.itemQuantities)}
            ${renderRow('Identifiers', m.materialIdentifiers.map(id => id.value).filter(Boolean).join(', '))}
        </table>
    `).join('');

    const propertiesHtml = data.properties.map(p => `
        <div style="margin-bottom: 30px;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 12px;">
                <span style="font-weight: 600; font-size: 16px; color: #374151;">${p.name}</span>
                <span class="tag ${p.isCertified ? 'tag-green' : 'tag-yellow'}">${p.isCertified ? 'Certified' : 'Not Certified'}</span>
            </div>
            ${p.description ? `<p style="font-size: 13px; color: #6b7280; margin-bottom: 15px; font-style: italic;">${p.description}</p>` : ''}
            ${p.procedures ? `<p style="font-size: 13px; color: #6b7280; margin-bottom: 15px;"><strong>Procedures:</strong> ${p.procedures}</p>` : ''}
            
            ${p.results.map(r => `
                <div style="margin-left: 0px; margin-bottom: 20px;">
                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px; color: #4b5563;">${r.name}</div>
                    ${r.description ? `<div style="font-size: 12px; color: #6b7280; margin-bottom: 8px; font-style: italic;">${r.description}</div>` : ''}
                    <div style="overflow-x: auto;">
                        <table style="min-width: 900px;">
                            <tr style="background: #f9fafb;">
                                <th style="width: 20%; padding: 8px;">Name</th>
                                <th style="width: 15%; padding: 8px;">Value</th>
                                <th style="width: 10%; padding: 8px;">Unit</th>
                                <th style="width: 10%; padding: 8px;">DSI Unit</th>
                                <th style="width: 10%; padding: 8px;">Uncertainty</th>
                                <th style="width: 8%; padding: 8px;">k</th>
                                <th style="width: 8%; padding: 8px;">Prob.</th>
                                <th style="width: 15%; padding: 8px;">Identifier (CAS)</th>
                            </tr>
                            ${r.quantities.map(q => {
                                const cas = getCasNumber(q.name);
                                return `
                                <tr>
                                    <td style="padding: 8px;">${q.name}</td>
                                    <td style="padding: 8px;">${q.value}</td>
                                    <td style="padding: 8px;">${q.unit}</td>
                                    <td style="padding: 8px; font-family: monospace; color: #059669;">${q.dsiUnit || ''}</td>
                                    <td style="padding: 8px;">${q.uncertainty || ''}</td>
                                    <td style="padding: 8px;">${q.coverageFactor || ''}</td>
                                    <td style="padding: 8px;">${q.coverageProbability || ''}</td>
                                    <td style="padding: 8px;">${cas || ''}</td>
                                </tr>
                                `;
                            }).join('')}
                        </table>
                    </div>
                </div>
            `).join('')}
        </div>
    `).join('');

    const stmt = data.statements.official;
    let stmtRows = '';
    stmtRows += renderRow('Intended Use', stmt.intendedUse);
    stmtRows += renderRow('Storage Information', stmt.storageInformation);
    stmtRows += renderRow('Handling Instructions', stmt.handlingInstructions);
    stmtRows += renderRow('Metrological Traceability', stmt.metrologicalTraceability);
    stmtRows += renderRow('Health & Safety', stmt.healthAndSafety);
    stmtRows += renderRow('Subcontractors', stmt.subcontractors);
    stmtRows += renderRow('Legal Notice', stmt.legalNotice);
    stmtRows += renderRow('Ref to Certification Report', stmt.referenceToCertificationReport);

    const customStmtRows = data.statements.custom.map(s => renderRow(s.name, s.content)).join('');

    const commentHtml = data.generalComment || (data.binaryDocuments && data.binaryDocuments.length > 0) ? `
        <h2>Comment and Document</h2>
        <table>
            ${renderRow('General Comment', data.generalComment)}
            ${renderRow('Attached Documents', data.binaryDocuments && data.binaryDocuments.length > 0 ? data.binaryDocuments.map(d => d.fileName).join(', ') : 'None')}
        </table>
    ` : '';

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${data.administrativeData.title}</title>
        <style>${styles}</style>
    </head>
    <body>
        <h1>${data.administrativeData.title}</h1>
        
        <h2>Administrative Data</h2>
        <table>
            ${adminRows}
            ${producerRows}
            ${personRows}
        </table>

        <h2>Materials</h2>
        ${materialHtml || '<p style="color:#6b7280; font-style:italic;">No materials defined.</p>'}

        <h2>Properties</h2>
        ${propertiesHtml || '<p style="color:#6b7280; font-style:italic;">No properties defined.</p>'}

        <h2>Statements</h2>
        <table>
            ${stmtRows}
            ${customStmtRows}
        </table>

        ${commentHtml}

        <div class="footer">
            Generated by DRMD Generator • ${new Date().toLocaleDateString()}
        </div>
    </body>
    </html>
    `;
};

// --- Custom PDF Viewer Component ---
interface HighlightData {
    type: 'text' | 'coords';
    value: string | number[];
}

interface PdfViewport {
    width: number;
    height: number;
    transform: number[];
}

const CONVERTED_VALUE_PREFIX = "\u24d8 Value converted for machine readability";
const GENERATED_VALUE_MESSAGE = "\uD83E\uDD16 This value was generated by VLM based on available context. It does not appear verbatim in the PDF.";

// Sub-component for individual PDF pages
const PdfPage: React.FC<{ 
    pdfDoc: any; 
    pageNum: number; 
    highlightData?: HighlightData | null; 
    onMatchStatus?: (pageNum: number, found: boolean) => void;
    tryClaimMatch?: (pageNum: number) => boolean;
}> = ({ pdfDoc, pageNum, highlightData, onMatchStatus, tryClaimMatch }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState<PdfViewport | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [rotation, setRotation] = useState(0);
    const [pageRotation, setPageRotation] = useState(0);
    const mirrorStateRef = useRef({ x: false, y: false });
    const [sizeVersion, setSizeVersion] = useState(0);

    useEffect(() => {
        if (!wrapperRef.current) return;
        const observer = new ResizeObserver(() => setSizeVersion(v => v + 1));
        observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        let cancelled = false;
        const render = async () => {
            if (!pdfDoc || !wrapperRef.current || !canvasRef.current) return;
            
            const page = await pdfDoc.getPage(pageNum);
            const defaultViewport = page.getViewport({ scale: 1 });
            const nativeRotation = defaultViewport.rotation;
            setPageRotation(nativeRotation);
            
            const containerWidth = wrapperRef.current.getBoundingClientRect().width || 800; 
            const userRotation = ((rotation % 360) + 360) % 360;
            const effectiveRotation = ((nativeRotation + userRotation) % 360 + 360) % 360;
            
            const unscaledViewport = page.getViewport({ scale: 1, rotation: effectiveRotation });
            const pixelRatio = window.devicePixelRatio || 1;
            
            // desiredScale calculates the scale needed for the CSS (logical) pixels 
            const desiredScale = containerWidth / unscaledViewport.width;
            const cssScale = Math.max(desiredScale, 1.5);
            
            // The physical scale includes pixelRatio to ensure high fidelity rendering
            const physicalScale = cssScale * pixelRatio;
            
            // Create two viewports: physical for canvas buffer sizes, css for styling
            const physicalViewport = page.getViewport({ scale: physicalScale, rotation: effectiveRotation });
            const cssViewport = page.getViewport({ scale: cssScale, rotation: effectiveRotation });
            
            // Store logical viewport in state for highlight coordinates overlays
            setViewport(cssViewport);
            
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
                // Set physical pixels for high-DPI rendering buffer
                canvas.width = Math.floor(physicalViewport.width);
                canvas.height = Math.floor(physicalViewport.height);
                
                // Set CSS intrinsic size to match logical size 
                canvas.style.width = `${Math.floor(cssViewport.width)}px`;
                canvas.style.height = `${Math.floor(cssViewport.height)}px`;
                
                // Clear any leftover transforms and let PDF.js manage it strictly via physicalViewport
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                const shouldCheckMirror = (effectiveRotation % 360) === 0;
                let isMirroredX = false;
                let isMirroredY = false;

                if (shouldCheckMirror) {
                    try {
                        const textContentForMirrorCheck = await page.getTextContent();
                        if (textContentForMirrorCheck && textContentForMirrorCheck.items) {
                            const textItems = textContentForMirrorCheck.items.filter((i: any) => i.str?.trim());
                            
                            let negXCount = 0, posXCount = 0;
                            let negYCount = 0, posYCount = 0;
                            for (const item of textItems) {
                                const t = item.transform;
                                if (t) {
                                    if (t[0] < 0) negXCount++;
                                    else if (t[0] > 0) posXCount++;
                                    if (t[3] < 0) negYCount++;
                                    else if (t[3] > 0) posYCount++;
                                }
                            }
                            if (negXCount > 0 && negXCount > posXCount * 0.3) isMirroredX = true;
                            if (negYCount > 0 && negYCount > posYCount * 0.3) isMirroredY = true;
                        }

                        if (!isMirroredX || !isMirroredY) {
                            const opList = await page.getOperatorList();
                            for (let i = 0; i < Math.min(opList.fnArray.length, 100); i++) {
                                if (opList.fnArray[i] === 12) {
                                    const args = opList.argsArray[i];
                                    if (args) {
                                        if (args[0] < 0 && args[3] > 0) isMirroredX = true;
                                        if (args[3] < 0 && args[0] > 0) isMirroredY = true;
                                        if (args[0] < 0 && args[3] < 0) {
                                            isMirroredX = true;
                                            isMirroredY = true;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {
                         // gracefully fail
                    }
                }
                
                mirrorStateRef.current = { x: isMirroredX, y: isMirroredY };
                
                let renderTransform = [1, 0, 0, 1, 0, 0];
                if (isMirroredX && isMirroredY) {
                    renderTransform = [-1, 0, 0, -1, canvas.width, canvas.height];
                } else if (isMirroredX) {
                    renderTransform = [-1, 0, 0, 1, canvas.width, 0];
                } else if (isMirroredY) {
                    renderTransform = [1, 0, 0, -1, 0, canvas.height];
                }
                
                const renderContext: any = { canvasContext: ctx, viewport: physicalViewport, transform: renderTransform };
                await page.render(renderContext).promise;
                if (cancelled) return;

                if (highlightData?.type === 'text' && typeof highlightData.value === 'string') {
                     const queryLower = highlightData.value.toLowerCase().trim();
                     const queryNoSpace = queryLower.replace(/\s+/g, '');

                     if (queryNoSpace.length > 0) {
                        const textContent = await page.getTextContent();
                        let matchFound = false;
                        
                        const drawHighlight = (cx: number, cy: number, cw: number, ch: number) => {
                            ctx.save();
                            ctx.fillStyle = 'rgba(255, 215, 0, 0.4)';
                            ctx.globalCompositeOperation = 'multiply'; 
                            ctx.fillRect(cx, cy, cw, ch);
                            ctx.restore();
                            ctx.save();
                            ctx.strokeStyle = 'rgba(234, 179, 8, 1)';
                            ctx.lineWidth = 2;
                            ctx.strokeRect(cx, cy, cw, ch);
                            ctx.restore();
                        };

                        const getItemRect = (item: any, fracStart = 0, fracEnd = 1) => {
                            const transform = item.transform;
                            const x = transform[4];
                            const y = transform[5];
                            const fullW = item.width;
                            const h = item.height || 12;
                            const w = fullW * (fracEnd - fracStart);
                            const xOff = fullW * fracStart;
                            
                            const tx = physicalViewport.transform;
                            let canvasX = x * tx[0] + y * tx[2] + tx[4];
                            let canvasY = x * tx[1] + y * tx[3] + tx[5];
                            const widthScaled = w * Math.abs(tx[0]);
                            const heightScaled = h * Math.abs(tx[3]);
                            const offsetScaled = xOff * Math.abs(tx[0]);
                            
                            const fullWidthScaled = fullW * Math.abs(tx[0]);
                            
                            if (mirrorStateRef.current.x) {
                                canvasX = canvas.width - canvasX - fullWidthScaled + offsetScaled;
                            } else {
                                canvasX = canvasX + offsetScaled;
                            }
                            
                            if (mirrorStateRef.current.y) {
                                canvasY = canvas.height - canvasY - heightScaled;
                            }

                            return {
                                x: canvasX,
                                y: canvasY - heightScaled,
                                w: widthScaled,
                                h: heightScaled * 1.15
                            };
                        };
                        
                        const pendingRects: Array<{x: number, y: number, w: number, h: number}> = [];
                        let fullTextNoSpace = '';
                        const itemSpans: Array<{start: number, end: number, item: any}> = [];
                        
                        for (const item of textContent.items) {
                            const strNoSpace = (item as any).str.toLowerCase().replace(/\s+/g, '');
                            if (!strNoSpace) continue;
                            const start = fullTextNoSpace.length;
                            fullTextNoSpace += strNoSpace;
                            const end = fullTextNoSpace.length;
                            itemSpans.push({ start, end, item });
                        }

                        if (queryNoSpace.length > 3) {
                            const matchIndex = fullTextNoSpace.indexOf(queryNoSpace);
                            if (matchIndex !== -1) {
                                const matchStart = matchIndex;
                                const matchEnd = matchIndex + queryNoSpace.length;
                                
                                for (const span of itemSpans) {
                                    if (span.end > matchStart && span.start < matchEnd) {
                                        const itemTextLen = span.end - span.start;
                                        const overlapStart = Math.max(matchStart, span.start);
                                        const overlapEnd = Math.min(matchEnd, span.end);
                                        const fracStart = itemTextLen > 0 ? (overlapStart - span.start) / itemTextLen : 0;
                                        const fracEnd = itemTextLen > 0 ? (overlapEnd - span.start) / itemTextLen : 1;
                                        
                                        pendingRects.push(getItemRect(span.item, fracStart, fracEnd));
                                        matchFound = true;
                                    }
                                }
                            }
                        }
                        
                        if (!matchFound) {
                            for (const item of textContent.items) {
                                const str = (item as any).str.toLowerCase().trim();
                                const strNoSpace = str.replace(/\s+/g, '');
                                if (!strNoSpace) continue;
                                
                                let isMatch = false;
                                if (queryNoSpace === strNoSpace) isMatch = true;
                                else if (queryNoSpace.length >= 8 && strNoSpace.includes(queryNoSpace)) isMatch = true;
                                else if (queryLower.length <= 3) {
                                    const words = str.split(/[\s,.\-]+/);
                                    if (words.includes(queryLower)) isMatch = true;
                                }
                                
                                if (isMatch) {
                                    pendingRects.push(getItemRect(item as any));
                                    matchFound = true;
                                    break;
                                }
                            }
                        }

                        // Only draw if this page claims the match (first page to find text wins)
                        const canDraw = !tryClaimMatch || tryClaimMatch(pageNum);
                        if (matchFound && canDraw) {
                            for (const rect of pendingRects) {
                                drawHighlight(rect.x, rect.y, rect.w, rect.h);
                            }
                        }

                        if (onMatchStatus) onMatchStatus(pageNum, matchFound);
                        if (matchFound && canDraw) canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
                     }
                }
            }
        };
        render();
        return () => { cancelled = true; };
    }, [pdfDoc, pageNum, rotation, highlightData?.type === 'text' ? highlightData.value : 'resize-trigger', sizeVersion]);

    const highlightBox = useMemo(() => {
        if (!highlightData || highlightData.type !== 'coords') return null;
        
        const [p, y1, x1, y2, x2] = highlightData.value as number[];
        if (p !== pageNum) return null;

        const rotatePoint = (x: number, y: number, deg: number) => {
            switch ((deg + 360) % 360) {
                case 90: return { x: 1000 - y, y: x };
                case 180: return { x: 1000 - x, y: 1000 - y };
                case 270: return { x: y, y: 1000 - x };
                default: return { x, y };
            }
        };

        const userRotationOnly = ((rotation) % 360 + 360) % 360;

        let adjustedX1 = x1, adjustedX2 = x2;
        let adjustedY1 = y1, adjustedY2 = y2;
        
        if (mirrorStateRef.current.x) {
            adjustedX1 = 1000 - x1;
            adjustedX2 = 1000 - x2;
        }
        if (mirrorStateRef.current.y) {
            adjustedY1 = 1000 - y1;
            adjustedY2 = 1000 - y2;
        }

        const p1 = rotatePoint(adjustedX1, adjustedY1, userRotationOnly);
        const p2 = rotatePoint(adjustedX2, adjustedY2, userRotationOnly);

        const rawYmin = Math.min(p1.y, p2.y);
        const rawYmax = Math.max(p1.y, p2.y);
        const rawXmin = Math.min(p1.x, p2.x);
        const rawXmax = Math.max(p1.x, p2.x);

        const rawHeight = rawYmax - rawYmin;
        const rawWidth = rawXmax - rawXmin;
        const padY = rawHeight < 50 ? rawHeight * 0.15 : rawHeight * 0.1;
        const padX = rawWidth < 80 ? rawWidth * 0.05 : rawWidth * 0.03;
        
        const ymin = Math.max(0, rawYmin - padY);
        const ymax = Math.min(1000, rawYmax + padY);
        const xmin = Math.max(0, rawXmin - padX);
        const xmax = Math.min(1000, rawXmax + padX);

        return {
            top: `${ymin / 10}%`,
            left: `${xmin / 10}%`,
            width: `${(xmax - xmin) / 10}%`,
            height: `${(ymax - ymin) / 10}%`
        };
    }, [highlightData, pageNum, pageRotation, rotation]);

    useEffect(() => {
        if (highlightBox && scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [highlightBox]);

    const containerStyle = useMemo(() => {
        if (!viewport) return { minHeight: '300px' };
        return { aspectRatio: `${viewport.width} / ${viewport.height}` };
    }, [viewport]);

    return (
        <div 
            ref={wrapperRef} 
            className="relative w-full mb-4 shadow-md bg-white group"
            style={containerStyle}
        >
            <div className="absolute top-2 right-2 z-20">
                <button 
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    className="bg-white/90 hover:bg-white text-gray-700 p-1.5 rounded shadow-sm text-xs font-bold border border-gray-200"
                    title="Rotate Page"
                >
                    ↻ Rotate
                </button>
            </div>
            <canvas 
                ref={canvasRef} 
                className="block w-full h-full rounded-sm"
            />
            {highlightBox && (
                <div 
                    ref={scrollRef}
                    className="absolute border-2 border-yellow-500 bg-yellow-400/40 z-10 shadow-sm mix-blend-multiply"
                    style={{
                        top: highlightBox.top,
                        left: highlightBox.left,
                        width: highlightBox.width,
                        height: highlightBox.height,
                        pointerEvents: 'none'
                    }}
                />
            )}
        </div>
    )
}

// --- Main PDF Viewer Wrapper ---
const PdfViewer: React.FC<{
    url: string;
    highlightData: HighlightData | null;
    onTextNotFound: () => void;
}> = ({ url, highlightData, onTextNotFound }) => {
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [numPages, setNumPages] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const matchClaimRef = useRef<number | null>(null);
    const pageResultsRef = useRef<Map<number, boolean>>(new Map());

    // Reset match tracking when highlight target changes
    useEffect(() => {
        matchClaimRef.current = null;
        pageResultsRef.current = new Map();
    }, [highlightData]);

    useEffect(() => {
        const loadPdf = async () => {
            if (!url || !(window as any).pdfjsLib) return;
            try {
                const loadingTask = (window as any).pdfjsLib.getDocument(url);
                const pdf = await loadingTask.promise;
                setPdfDoc(pdf);
                setNumPages(pdf.numPages);
            } catch (err) {
                console.error("Failed to load PDF", err);
            }
        };
        loadPdf();
    }, [url]);

    // First page to find a text match claims the highlight; other pages skip drawing
    const tryClaimMatch = useCallback((pageNum: number): boolean => {
        if (matchClaimRef.current === null) {
            matchClaimRef.current = pageNum;
            return true;
        }
        return matchClaimRef.current === pageNum;
    }, []);

    const handleMatchStatus = useCallback((pageNum: number, found: boolean) => {
        pageResultsRef.current.set(pageNum, found);
        if (pageResultsRef.current.size === numPages && numPages > 0) {
            const anyFound = Array.from(pageResultsRef.current.values()).some(v => v);
            if (!anyFound) {
                onTextNotFound();
            }
        }
    }, [numPages, onTextNotFound]);

    return (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4 bg-gray-800">
            {pdfDoc && Array.from({ length: numPages }, (_, i) => (
                <PdfPage
                    key={i + 1}
                    pdfDoc={pdfDoc}
                    pageNum={i + 1}
                    highlightData={highlightData}
                    onMatchStatus={handleMatchStatus}
                    tryClaimMatch={tryClaimMatch}
                />
            ))}
        </div>
    );
};

const App: React.FC = () => {
  const [drmdData, setDrmdData] = useState<DRMD>(INITIAL_DRMD);
  const [geminiApiKey, setGeminiApiKey] = useState<string>("");
  const [modelTemperature, setModelTemperature] = useState<number>(0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("settings");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [highlightData, setHighlightData] = useState<HighlightData | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'converted' | 'generated' | 'warning'>('warning');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const bulkFolderInputRef = useRef<HTMLInputElement>(null);
  const bulkCancelRef = useRef<boolean>(false);

  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, currentFile: '' });

  useEffect(() => {
      if (toastMessage) {
          const timer = setTimeout(() => setToastMessage(null), 15000);
          return () => clearTimeout(timer);
      }
  }, [toastMessage]);

  useEffect(() => {
    setDrmdData(prev => {
        const newData = { ...prev };
        if (!newData.administrativeData.uniqueIdentifier) {
            newData.administrativeData.uniqueIdentifier = generateUUID();
        }
        return newData;
    });
  }, []);

  const showToast = (message: string, type: 'converted' | 'generated' | 'warning') => {
      setToastMessage(message);
      setToastType(type);
  };

  const normalizeCoords = (coords: number[]): number[] | null => {
      if (!Array.isArray(coords) || coords.length !== 5) return null;
      const [page, y1, x1, y2, x2] = coords;
      const norm = [page, Math.min(y1, y2), Math.min(x1, x2), Math.max(y1, y2), Math.max(x1, x2)];
      if (norm[3] <= norm[1]) norm[3] = norm[1] + 20;
      if (norm[4] <= norm[2]) norm[4] = norm[2] + 20;
      return norm;
  };

  const handleHighlight = (primaryTarget?: number[] | string | null, secondaryTarget?: number[] | string | null, textFallback?: string, originalText?: string) => {
      setToastMessage(null);
      const isTransformed = originalText && textFallback && originalText.trim().toLowerCase() !== textFallback.trim().toLowerCase();

      if (Array.isArray(primaryTarget) && primaryTarget.length === 5) {
          const normalized = normalizeCoords(primaryTarget);
          if (normalized) {
              setHighlightData({ type: 'coords', value: normalized });
              if (isTransformed) {
                  showToast(`${CONVERTED_VALUE_PREFIX}: "${originalText}" → "${textFallback}"`, 'converted');
              }
              return;
          }
      }
      
      if (isTransformed) {
          setHighlightData({ type: 'text', value: originalText });
          showToast(`${CONVERTED_VALUE_PREFIX}: "${originalText}" → "${textFallback}"`, 'converted');
          return;
      }

      const textToSearch = typeof primaryTarget === 'string' && primaryTarget.trim().length > 0 ? primaryTarget : 
                           (typeof textFallback === 'string' && textFallback.trim().length > 0 ? textFallback : null);
                           
      if (textToSearch) {
          setHighlightData({ type: 'text', value: textToSearch });
          return;
      }

      if (Array.isArray(secondaryTarget) && secondaryTarget.length === 5) {
          const normalized = normalizeCoords(secondaryTarget);
          if (normalized) {
              setHighlightData({ type: 'coords', value: normalized });
              return;
          }
      }
      
      if (typeof secondaryTarget === 'string' && secondaryTarget.trim().length > 0) {
          setHighlightData({ type: 'text', value: secondaryTarget });
          return;
      }
      
      if (textFallback) {
          showToast(GENERATED_VALUE_MESSAGE, 'generated');
      }
  };

  const parseOriginalTexts = (raw: any): Record<string, string> | undefined => {
      if (!raw) return undefined;
      if (typeof raw === 'object') return raw;
      if (typeof raw === 'string') {
          try { return JSON.parse(raw); } catch { return undefined; }
      }
      return undefined;
  };

  // Shared mapping function: converts LLM extracted data into a full DRMD object
  const mapExtractedToDrmd = (extractedData: Partial<DRMD>, fileName: string, base64Content: string): DRMD => {
      // Pre-processing: validity normalization
      if (extractedData?.administrativeData && extractedData.administrativeData.validityType === "Time After Dispatch") {
          const rawY = extractedData.administrativeData.durationY || 0;
          const rawM = extractedData.administrativeData.durationM || 0;
          const totalMonths = (rawY * 12) + rawM;
          if (totalMonths > 0) {
              extractedData.administrativeData.durationY = Math.floor(totalMonths / 12);
              extractedData.administrativeData.durationM = totalMonths % 12;
          }
      }
      if (extractedData?.administrativeData?.validityType === "Specific Time" && extractedData.administrativeData.specificTime) {
          const raw = extractedData.administrativeData.specificTime.trim();
          const match = raw.match(/^(\d{1,2})\/(\d{4})$/);
          if (match) {
              const month = parseInt(match[1]);
              const year = parseInt(match[2]);
              const lastDay = new Date(year, month, 0).getDate();
              extractedData.administrativeData.specificTime = `${year}-${match[1].padStart(2, '0')}-${lastDay}`;
          }
      }

      const prev = JSON.parse(JSON.stringify(INITIAL_DRMD)) as DRMD;

      const newMats = (extractedData?.materials || []).map((m: any) => {
          const name = m.name || "";
          const sanitizeForId = (s: string) => s ? s.replace(/[^a-zA-Z0-9_-]/g, "_") : "unknown";
          return {
              ...m,
              uuid: generateUUID(),
              xmlId: `mat_${sanitizeForId(name)}`,
              materialIdentifiers: (m.materialIdentifiers && m.materialIdentifiers.length > 0)
                  ? m.materialIdentifiers
                  : [{...INITIAL_ID}],
              name: name,
              description: m.description || "",
              materialClass: m.materialClass || "",
              itemQuantities: m.itemQuantities || "",
              minimumSampleSize: m.minimumSampleSize || "",
              isCertified: !!m.isCertified,
              fieldCoordinates: m.fieldCoordinates,
              sectionCoordinates: m.sectionCoordinates,
              originalTexts: parseOriginalTexts(m.originalTexts)
          };
      });
      const normalizeName = (s: string) => s ? s.toLowerCase().replace(/[^a-z0-9]/g, "") : "";

      const propertyMap: Record<string, any> = {};

      (extractedData?.properties || []).forEach((p: any) => {
          const propName = p.name || "Material Properties";
          const propKey = normalizeName(propName);
          if (!propertyMap[propKey]) {
              propertyMap[propKey] = { ...p, results: [] };
          }
          const propDesc = (p.description || "").trim();
          const isFootnote = propDesc.match(/^(\d+\)|1\)|\*)/);
          let resultDescPrefix = "";
          if (isFootnote) {
              resultDescPrefix = propDesc;
              propertyMap[propKey].description = "";
          }
          if (p.results) {
              if (resultDescPrefix && p.results.length > 0) {
                  p.results[0].description = (p.results[0].description ? p.results[0].description + "\n" : "") + resultDescPrefix;
              }
              p.results.forEach((r: any) => {
                  const rName = (r.name || "").toLowerCase().trim();
                  const isFragment =
                      rName.includes("in mg/kg") ||
                      rName.includes("in %") ||
                      rName === "mg/kg" ||
                      rName === "%" ||
                      rName === "";
                  if (propertyMap[propKey].results.length > 0 && isFragment) {
                      if (r.quantities) {
                          if (!propertyMap[propKey].results[0].quantities) {
                              propertyMap[propKey].results[0].quantities = [];
                          }
                          propertyMap[propKey].results[0].quantities.push(...r.quantities);
                      }
                      if (r.description) {
                          propertyMap[propKey].results[0].description = (propertyMap[propKey].results[0].description || "") + "\n" + r.description;
                      }
                  } else {
                      propertyMap[propKey].results.push(r);
                  }
              });
          }
      });

      const newProps = Object.values(propertyMap).map((p: any) => {
          const finalResults = (p.results || []).map((r: any) => {
              const desc = (r.description || "").toLowerCase();
              const parentDesc = (p.description || "").toLowerCase();
              const getK = (s: string) => {
                  const m = s.match(/k\s*=\s*(\d+(\.\d+)?)/i);
                  return m ? m[1] : "";
              };
              const getProb = (s: string) => {
                  const m1 = s.match(/(\d+(?:\.\d+)?)\s*%\s*confidence/i);
                  if (m1) return m1[1];
                  const m2 = s.match(/confidence.*?(\d+(?:\.\d+)?)\s*%/i);
                  if (m2) return m2[1];
                  return "";
              };
              let defaultK = getK(desc) || getK(parentDesc);
              let defaultProb = getProb(desc) || getProb(parentDesc);
              if (defaultK && !defaultProb) {
                  const combined = desc + " " + parentDesc;
                  const m3 = combined.match(/(\d+(?:\.\d+)?)\s*%/);
                  if (m3) defaultProb = m3[1];
              }
              if (defaultProb) {
                  const val = parseFloat(defaultProb);
                  if (val > 1) defaultProb = (val / 100).toString();
              }
              const qs = (r.quantities || []).map((q: any) => {
                  let finalValue = q.value || "";
                  let finalUncertainty = q.uncertainty || "";
                  if (!finalValue && finalUncertainty && (finalUncertainty.trim().startsWith('<') || finalUncertainty.trim().startsWith('>'))) {
                      finalValue = finalUncertainty;
                      finalUncertainty = "";
                  }
                  let finalK = q.coverageFactor || "";
                  let finalProb = q.coverageProbability || "";
                  if (!finalK && q.uncertainty && defaultK) finalK = defaultK;
                  if (!finalProb && q.uncertainty && defaultProb) finalProb = defaultProb;
                  let finalUnit = q.unit || "";
                  if (!finalUnit.trim()) finalUnit = "\\one";
                  const dsi = convertToDSI(finalValue, finalUnit);
                  return {
                      ...q,
                      uuid: generateUUID(),
                      identifiers: [{...INITIAL_ID}],
                      name: q.name || "",
                      value: finalValue,
                      unit: finalUnit,
                      uncertainty: finalUncertainty,
                      coverageFactor: finalK,
                      coverageProbability: finalProb,
                      distribution: q.distribution || "",
                      dsiValue: dsi.dsiValue,
                      dsiUnit: dsi.dsiUnit,
                      fieldCoordinates: q.fieldCoordinates,
                      originalTexts: parseOriginalTexts(q.originalTexts)
                  };
              });
              let finalMaterialRef = newMats.length === 1 ? newMats[0].uuid : undefined;
              if (newMats.length > 1 && r.linkedMaterialName) {
                  const matchedMat = newMats.find((m: any) => 
                      m.name.toLowerCase() === r.linkedMaterialName.toLowerCase() || 
                      m.name.includes(r.linkedMaterialName) || 
                      r.linkedMaterialName.includes(m.name)
                  );
                  if (matchedMat) finalMaterialRef = matchedMat.uuid;
              }

              const finalName = r.name && r.name.length > 1 ? r.name : "Values";
              return {
                  ...r,
                  name: finalName,
                  description: r.description || "",
                  uuid: generateUUID(),
                  materialRef: finalMaterialRef,
                  quantities: qs,
                  sectionCoordinates: r.sectionCoordinates,
                  originalTexts: parseOriginalTexts(r.originalTexts)
              };
          });
          return {
              ...p,
              uuid: generateUUID(),
              name: p.name || "",
              description: p.description || "",
              procedures: p.procedures || "",
              isCertified: !!p.isCertified,
              results: finalResults,
              originalTexts: parseOriginalTexts(p.originalTexts)
          };
      });

      const newProds = (extractedData?.administrativeData?.producers || []).map((p: any) => {
          let countryCode = p.address?.countryCode || "";
          const city = p.address?.city || "";
          if (city.toLowerCase().includes("berlin") || city.toLowerCase().includes("adlershof")) {
              countryCode = "DE";
          }
          return {
              ...p,
              uuid: generateUUID(),
              name: p.name || "",
              email: p.email || "",
              phone: p.phone || "",
              fax: p.fax || "",
              organizationIdentifiers: [{...INITIAL_ID}],
              address: {
                  street: p.address?.street || "",
                  streetNo: p.address?.streetNo || "",
                  postCode: p.address?.postCode || "",
                  city: p.address?.city || "",
                  countryCode: countryCode
              },
              fieldCoordinates: p.fieldCoordinates,
              sectionCoordinates: p.sectionCoordinates,
              originalTexts: parseOriginalTexts(p.originalTexts)
          };
      });

      const newPersons = (extractedData?.administrativeData?.responsiblePersons || []).map((p: any, index: number) => ({
          ...INITIAL_PERSON,
          uuid: generateUUID(),
          name: p.name || "",
          role: p.role || "",
          description: p.description || "",
          mainSigner: index === 0,
          fieldCoordinates: p.fieldCoordinates,
          sectionCoordinates: p.sectionCoordinates,
          originalTexts: parseOriginalTexts(p.originalTexts)
      }));

      let validType = prev.administrativeData.validityType;
      if (extractedData?.administrativeData?.validityType) {
          const vt = extractedData.administrativeData.validityType;
          if (vt === "Until Revoked" || vt === "Time After Dispatch" || vt === "Specific Time") {
              validType = vt;
          }
      }

      return {
          ...prev,
          administrativeData: {
              ...prev.administrativeData,
              uniqueIdentifier: extractedData?.administrativeData?.uniqueIdentifier || prev.administrativeData.uniqueIdentifier || generateUUID(),
              title: ALLOWED_TITLES.includes(extractedData?.administrativeData?.title as string)
                  ? (extractedData?.administrativeData?.title as string)
                  : "referenceMaterialCertificate",
              dataVersion: prev.administrativeData.dataVersion,
              validityType: validType,
              durationY: extractedData?.administrativeData?.durationY ?? prev.administrativeData.durationY,
              durationM: extractedData?.administrativeData?.durationM ?? prev.administrativeData.durationM,
              specificTime: extractedData?.administrativeData?.specificTime || prev.administrativeData.specificTime,
              dateOfIssue: extractedData?.administrativeData?.dateOfIssue || "",
              documentIdentifiers: [{ ...INITIAL_ID }],
              producers: newProds.length > 0 ? newProds : prev.administrativeData.producers,
              responsiblePersons: newPersons.length > 0 ? newPersons : prev.administrativeData.responsiblePersons,
              fieldCoordinates: extractedData?.administrativeData?.fieldCoordinates,
              originalTexts: parseOriginalTexts(extractedData?.administrativeData?.originalTexts)
          },
          statements: {
              ...prev.statements,
              official: {
                  intendedUse: extractedData?.statements?.official?.intendedUse || "",
                  commutability: extractedData?.statements?.official?.commutability || "",
                  storageInformation: extractedData?.statements?.official?.storageInformation || "",
                  handlingInstructions: extractedData?.statements?.official?.handlingInstructions || "",
                  metrologicalTraceability: extractedData?.statements?.official?.metrologicalTraceability || "",
                  healthAndSafety: extractedData?.statements?.official?.healthAndSafety || "",
                  subcontractors: extractedData?.statements?.official?.subcontractors || "",
                  legalNotice: extractedData?.statements?.official?.legalNotice || "",
                  referenceToCertificationReport: extractedData?.statements?.official?.referenceToCertificationReport || "",
                  fieldCoordinates: extractedData?.statements?.official?.fieldCoordinates,
                  originalTexts: parseOriginalTexts((extractedData?.statements?.official as any)?.originalTexts)
              }
          },
          materials: newMats.length > 0 ? newMats : prev.materials,
          properties: newProps.length > 0 ? newProps : prev.properties,
          generalComment: "For additional information please refer to the pdf certificate",
          binaryDocuments: [{
              fileName: fileName,
              mimeType: "application/pdf",
              data: base64Content
          }]
      };
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!geminiApiKey) {
        setError("Please enter a Google Gemini API Key in Settings.");
        setActiveTab("settings");
        return;
    }

    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];
      
      // Validation: Size (20MB)
      if (file.size > 20 * 1024 * 1024) {
          setError(`File ${file.name} exceeds the 20MB limit.`);
          return;
      }
      // Validation: Type (PDF, DOCX, DOC)
      const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
      const validExts = ['.pdf', '.doc', '.docx'];
      const isValid = validTypes.includes(file.type) || validExts.some(ext => file.name.toLowerCase().endsWith(ext));
      if (!isValid) {
          setError(`File ${file.name} is not a valid PDF or Word document.`);
          return;
      }

      const objectUrl = URL.createObjectURL(file);
      setPdfUrl(objectUrl);
      setError(null);
      setIsProcessing(true);
      // Reset bulk results when starting a single upload
      setBulkResults([]);
      setBulkProcessing(false);

      const reader = new FileReader();
      reader.onloadend = async () => {
          const base64String = reader.result as string;
          const base64Content = base64String.split(',')[1];

          try {
              setStatusMessage("Analyzing PDF structure and coordinates with Gemini Vision...");
              const extractedData = await extractStructuredDataFromPdf(base64Content, file.type || 'application/pdf', geminiApiKey, modelTemperature);
              const mapped = mapExtractedToDrmd(extractedData, file.name, base64Content);
              setDrmdData(mapped);
              setActiveTab("admin");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Extraction failed.");
              console.error(err);
            } finally {
              setIsProcessing(false);
              setStatusMessage("");
            }
      };
      reader.readAsDataURL(file);
    }
  };

  // Helper: read a File as base64 data URL
  const readFileAsBase64 = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
      });
  };

  // Helper: extract RM code and name from DRMD
  const extractRmInfo = (drmd: any): { rmCode: string; rmName: string } => {
      let rmCode = "";
      let rmName = "";
      if (drmd.materials.length > 0) {
          const mat = drmd.materials[0];
          rmName = mat.name || "";
          const id = mat.materialIdentifiers?.find((i: any) => i.scheme && i.value);
          if (id) {
              rmCode = `${id.scheme}-${id.value}`;
          }
      }
      if (!rmCode) rmCode = drmd.administrativeData.uniqueIdentifier || "Unknown";
      return { rmCode, rmName };
  };

  const handleBulkUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!geminiApiKey) {
          setError("Please enter a Google Gemini API Key in Settings.");
          setActiveTab("settings");
          return;
      }

      const files = event.target.files;
      if (!files || files.length === 0) return;

      // Filter to supported document files
      const supportedExts = ['.pdf', '.doc', '.docx'];
      const docFiles = Array.from(files).filter(f => supportedExts.some(ext => f.name.toLowerCase().endsWith(ext)));
      if (docFiles.length === 0) {
          setError("No supported files found in the selected folder. Supported formats: PDF, DOC, DOCX.");
          return;
      }

      // Reset state for new bulk operation
      setPdfUrl(null);
      setDrmdData(JSON.parse(JSON.stringify(INITIAL_DRMD)));
      setError(null);
      bulkCancelRef.current = false;
      setBulkProcessing(true);
      setBulkProgress({ current: 0, total: docFiles.length, currentFile: '' });
      setActiveTab("validate-export");

      // Initialize all results as pending
      const initialResults: any[] = docFiles.map((f) => ({
          id: generateUUID(),
          fileName: f.name,
          rmCode: "",
          rmName: "",
          status: 'pending' as const,
          xmlContent: "",
          htmlContent: "",
          drmdData: JSON.parse(JSON.stringify(INITIAL_DRMD))
      }));
      setBulkResults(initialResults);

      // Process sequentially (one at a time for RPM limits)
      for (let i = 0; i < docFiles.length; i++) {
          if (bulkCancelRef.current) break;

          const file = docFiles[i];
          setBulkProgress({ current: i + 1, total: docFiles.length, currentFile: file.name });

          // Per-file size guard
          if (file.size > 20 * 1024 * 1024) {
              setBulkResults(prev => prev.map((r, idx) => idx === i ? {
                  ...r,
                  status: 'error' as const,
                  errorMessage: `File exceeds the 20MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB).`
              } : r));
              continue;
          }

          // Mark as processing
          setBulkResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r));

          try {
              const base64Content = await readFileAsBase64(file);
              const extractedData = await extractStructuredDataFromPdf(base64Content, file.type || 'application/pdf', geminiApiKey, modelTemperature);
              const mapped = mapExtractedToDrmd(extractedData, file.name, base64Content);
              const xmlContent = generateDrmdXml(mapped);
              const { rmCode, rmName } = extractRmInfo(mapped);

              setBulkResults(prev => prev.map((r, idx) => idx === i ? {
                  ...r,
                  status: 'done',
                  rmCode,
                  rmName,
                  xmlContent,
                  htmlContent: "", // Generated on-the-fly to prevent OOM crashes
                  drmdData: mapped
              } : r));
          } catch (err) {
              console.error(`Error processing ${file.name}:`, err);
              setBulkResults(prev => prev.map((r, idx) => idx === i ? {
                  ...r,
                  status: 'error',
                  errorMessage: err instanceof Error ? err.message : "Extraction failed"
              } : r));
              // Continue to next file — don't break
          }
      }

      setBulkProcessing(false);
      setBulkProgress({ current: pdfFiles.length, total: pdfFiles.length, currentFile: '' });
      // Reset file input so same folder can be re-selected
      event.target.value = "";
  };

  const handleBulkReview = (result: any) => {
      // Load this certificate into the main UI for review
      setDrmdData(result.drmdData);

      // Extract embedded PDF for viewer
      if (result.drmdData.binaryDocuments && result.drmdData.binaryDocuments.length > 0) {
          try {
              const pdfDoc = result.drmdData.binaryDocuments.find((d: any) => d.mimeType === 'application/pdf') || result.drmdData.binaryDocuments[0];
              if (pdfDoc && pdfDoc.data) {
                  const byteCharacters = atob(pdfDoc.data);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let i = 0; i < byteCharacters.length; i++) {
                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  const blob = new Blob([byteArray], { type: 'application/pdf' });
                  setPdfUrl(URL.createObjectURL(blob));
              }
          } catch (err) {
              console.warn("Failed to load embedded PDF from bulk result", err);
          }
      }

      setActiveTab("admin");
  };

  const handleBulkDownloadSingle = (result: any) => {
      const blob = new Blob([result.xmlContent], { type: 'text/xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${result.rmCode || result.fileName.replace('.pdf', '')}.xml`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  const handleBulkDownloadAll = async () => {
      const successResults = bulkResults.filter(r => r.status === 'done');
      if (successResults.length === 0) return;

      // Create ZIP using JSZip loaded from CDN
      try {
          const JSZipLib = (window as any).JSZip;
          if (!JSZipLib) throw new Error("JSZip not loaded");
          const zip = new JSZipLib();
          successResults.forEach(r => {
              const baseName = `${r.rmCode || r.fileName.replace('.pdf', '')}`;
              zip.file(`${baseName}.xml`, r.xmlContent);
              zip.file(`${baseName}.html`, r.htmlContent || generateHtmlReport(r.drmdData));
          });
          const content = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(content);
          const link = document.createElement('a');
          link.href = url;
          link.download = `DRMD-Bulk-Export-${new Date().toISOString().split('T')[0]}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
      } catch (err) {
          // Fallback: download individually
          console.warn("JSZip not available, downloading individually", err);
          successResults.forEach(r => {
              handleBulkDownloadSingle(r);
              handleBulkDownloadSingleHtml(r);
          });
      }
  };

  const handleBulkReviewHtml = (result: BulkResult) => {
      const html = result.htmlContent || generateHtmlReport(result.drmdData);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
  };

  const handleBulkDownloadSingleHtml = (result: BulkResult) => {
      const html = result.htmlContent || generateHtmlReport(result.drmdData);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${result.rmCode || result.fileName.replace('.pdf', '')}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };



  const handleXmlImport = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files[0]) {
          const file = event.target.files[0];
          setIsProcessing(true);
          setStatusMessage("Parsing XML...");
          
          const reader = new FileReader();
          reader.onload = (e) => {
              try {
                  const xmlContent = e.target?.result as string;
                  const parsedData = parseDrmdXml(xmlContent);
                  
                  if (parsedData.binaryDocuments && parsedData.binaryDocuments.length > 0) {
                      try {
                          const pdfDoc = parsedData.binaryDocuments.find((d: any) => d.mimeType === 'application/pdf') || parsedData.binaryDocuments[0];
                          if (pdfDoc && pdfDoc.data) {
                              const byteCharacters = atob(pdfDoc.data);
                              const byteNumbers = new Array(byteCharacters.length);
                              for (let i = 0; i < byteCharacters.length; i++) {
                                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                              }
                              const byteArray = new Uint8Array(byteNumbers);
                              const blob = new Blob([byteArray], {type: pdfDoc.mimeType || 'application/pdf'}); 
                              const pdfUrl = URL.createObjectURL(blob);
                              setPdfUrl(pdfUrl);
                          }
                      } catch (err) {
                          console.warn("Failed to load embedded PDF from XML", err);
                      }
                  } else {
                      setPdfUrl(null);
                  }

                  setDrmdData(parsedData);
                  setActiveTab("admin");
                  setError(null);
              } catch (err) {
                  setError("Failed to parse XML file. Please ensure it is a valid DRMD format.");
                  console.error(err);
              } finally {
                  setIsProcessing(false);
                  setStatusMessage("");
              }
          };
          reader.readAsText(file);
          event.target.value = "";
      }
  };

  const getExportFilename = () => {
    let filename = `DRMD-${drmdData.administrativeData.uniqueIdentifier || 'export'}`;
    if (drmdData.materials.length > 0) {
        const firstMat = drmdData.materials[0];
        const id = firstMat.materialIdentifiers.find(i => i.scheme && i.value);
        if (id) {
            const cleanScheme = id.scheme.trim().replace(/[^a-zA-Z0-9-_]/g, '');
            const cleanValue = id.value.trim().replace(/[^a-zA-Z0-9-_]/g, '');
            if (cleanScheme && cleanValue) {
                filename = `${cleanScheme}-${cleanValue}`;
            }
        }
    }
    return filename;
  };

  const handleExport = () => {
    const xmlContent = generateDrmdXml(drmdData);
    const blob = new Blob([xmlContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${getExportFilename()}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getIsoDuration = () => {
      const y = drmdData.administrativeData.durationY;
      const m = drmdData.administrativeData.durationM;
      if (!y && !m) return "P";
      return `P${y?y+'Y':''}${m?m+'M':''}`;
  };

  const renderSettings = () => (
      <div className="space-y-6 animate-fadeIn">
          <SectionHeader title="Application Settings" icon="⚙️" />
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 space-y-6">
              <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Google Gemini API Key</label>
                  <input 
                      type="password" 
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="Enter Google Gemini API Key..."
                      className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">Used for extracting data from PDF (Gemini 1.5 Pro/Flash or 2.0).</p>
              </div>
              <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Model Temperature: {modelTemperature}</label>
                  <input 
                      type="range" 
                      min="0" 
                      max="2" 
                      step="0.1"
                      value={modelTemperature}
                      onChange={(e) => setModelTemperature(parseFloat(e.target.value))}
                      className="w-full accent-indigo-600"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1 font-medium">
                      <span>More Deterministic (0)</span>
                      <span>More Creative (2)</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Adjusting this changes how creative the AI is. For strict data extraction, 0 is recommended to avoid hallucinations.</p>
              </div>
          </div>
      </div>
  );

  const renderAdmin = () => (
    <div className="space-y-8 animate-fadeIn">
        <div className="space-y-4 border p-4 rounded-lg bg-white shadow-sm">
            <SectionHeader title="Basic Information" icon="📄" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Select label="Title of Document *" value={drmdData.administrativeData.title} options={ALLOWED_TITLES} onChange={(v) => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, title: v}}))} />
                <div className="flex gap-2 items-end">
                    <div className="flex-1">
                        <Input label="Unique Identifier *" value={drmdData.administrativeData.uniqueIdentifier} onChange={(v) => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, uniqueIdentifier: v}}))} onFocus={() => handleHighlight(drmdData.administrativeData.fieldCoordinates?.uniqueIdentifier, null, drmdData.administrativeData.uniqueIdentifier, drmdData.administrativeData.originalTexts?.uniqueIdentifier)} onInfoClick={() => handleHighlight(drmdData.administrativeData.fieldCoordinates?.uniqueIdentifier, null, drmdData.administrativeData.uniqueIdentifier, drmdData.administrativeData.originalTexts?.uniqueIdentifier)} />
                    </div>
                    <button onClick={() => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, uniqueIdentifier: generateUUID()}}))} className="bg-gray-200 p-2 rounded mb-[2px] hover:bg-gray-300" title="Generate new UUID">🔄</button>
                </div>
            </div>
            
            <div className="border-t pt-4 mt-2">
                <h4 className="font-bold text-sm text-gray-700 mb-2">Period of Validity</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                    <Select
                        label="Validity Type *"
                        value={drmdData.administrativeData.validityType}
                        options={["Until Revoked", "Time After Dispatch", "Specific Time"]}
                        onChange={(v) => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, validityType: v as any}}))}
                        onFocus={() => handleHighlight(drmdData.administrativeData.fieldCoordinates?.validityType, null, drmdData.administrativeData.validityType, drmdData.administrativeData.originalTexts?.validityType)}
                        onInfoClick={() => handleHighlight(drmdData.administrativeData.fieldCoordinates?.validityType, null, drmdData.administrativeData.validityType, drmdData.administrativeData.originalTexts?.validityType)}
                    />
                    
                    {drmdData.administrativeData.validityType === "Time After Dispatch" && (
                        <>
                            <div className="flex gap-2">
                                <Input label="Years" type="number" value={drmdData.administrativeData.durationY} onChange={(v) => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, durationY: parseInt(v) || 0}}))} />
                                <Input label="Months" type="number" value={drmdData.administrativeData.durationM} onChange={(v) => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, durationM: parseInt(v) || 0}}))} />
                            </div>
                            <div>
                                <div className="text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1">
                                    <span>ISO 8601 Format *</span>
                                    <span 
                                        className="text-blue-500 cursor-pointer hover:text-blue-600 ml-1 text-sm" 
                                        onClick={() => handleHighlight(drmdData.administrativeData.fieldCoordinates?.durationM || drmdData.administrativeData.fieldCoordinates?.durationY, null, getIsoDuration())}
                                        title="View extracted duration in PDF"
                                    >
                                        &#9432;
                                    </span>
                                </div>
                                <div className="bg-green-50 border border-green-200 p-2 rounded text-sm text-green-800 font-mono">
                                    {getIsoDuration()}
                                </div>
                                <div className="mt-2">
                                    <Input
                                        label="Dispatch Date"
                                        type="date"
                                        value={drmdData.administrativeData.dateOfIssue}
                                        onChange={(v) => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, dateOfIssue: v}}))}
                                        onFocus={() => handleHighlight(drmdData.administrativeData.fieldCoordinates?.dateOfIssue, null, drmdData.administrativeData.dateOfIssue, drmdData.administrativeData.originalTexts?.dateOfIssue)}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                    {drmdData.administrativeData.validityType === "Specific Time" && (
                        <Input
                            label="Valid Until Date *"
                            type="date"
                            value={drmdData.administrativeData.specificTime}
                            onChange={(v) => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, specificTime: v}}))}
                            onFocus={() => handleHighlight(drmdData.administrativeData.fieldCoordinates?.specificTime, null, drmdData.administrativeData.specificTime, drmdData.administrativeData.originalTexts?.specificTime)}
                            onInfoClick={() => handleHighlight(drmdData.administrativeData.fieldCoordinates?.specificTime, null, drmdData.administrativeData.specificTime, drmdData.administrativeData.originalTexts?.specificTime)}
                        />
                    )}
                </div>
            </div>
        </div>

        <div className="space-y-4 border p-4 rounded-lg bg-white shadow-sm">
            <div className="flex justify-between items-center border-b pb-2">
                <SectionHeader title="Reference Material Producer" icon="🏢" />
                <button onClick={() => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: [...p.administrativeData.producers, {...INITIAL_PRODUCER, uuid: generateUUID()}]}}))} className="text-sm bg-indigo-50 text-indigo-600 px-3 py-1 rounded hover:bg-indigo-100 font-medium">+ Add Producer</button>
            </div>
            {drmdData.administrativeData.producers.map((prod, idx) => (
                <div key={prod.uuid} className="bg-gray-50 border border-gray-200 p-4 rounded-lg space-y-3 relative mb-4">
                     {drmdData.administrativeData.producers.length > 1 && <div className="font-bold text-gray-500 text-sm">Producer {idx + 1}</div>}
                     <button onClick={() => {
                        if (drmdData.administrativeData.producers.length > 1) {
                            const newProds = [...drmdData.administrativeData.producers];
                            newProds.splice(idx, 1);
                            setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: newProds}}));
                        }
                     }} className="absolute top-4 right-4 text-red-400 hover:text-red-600 disabled:opacity-50" disabled={drmdData.administrativeData.producers.length <= 1}>🗑️</button>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-3">
                            <Input label={drmdData.administrativeData.title === "referenceMaterialCertificate" ? "Name *" : "Name"} value={prod.name} onFocus={() => handleHighlight(prod.fieldCoordinates?.name, prod.sectionCoordinates, prod.name, prod.originalTexts?.name)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].name = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.name, prod.sectionCoordinates, prod.name, prod.originalTexts?.name)} />
                            <Input label="Email *" value={prod.email} onFocus={() => handleHighlight(prod.fieldCoordinates?.email, prod.sectionCoordinates, prod.email, prod.originalTexts?.email)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].email = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.email, prod.sectionCoordinates, prod.email, prod.originalTexts?.email)} />
                            <Input label="Phone" value={prod.phone} onFocus={() => handleHighlight(prod.fieldCoordinates?.phone, prod.sectionCoordinates, prod.phone, prod.originalTexts?.phone)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].phone = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.phone, prod.sectionCoordinates, prod.phone, prod.originalTexts?.phone)} />
                        </div>
                        <div className="space-y-3">
                             <div className="grid grid-cols-4 gap-2">
                                <div className="col-span-3"><Input label="Street" value={prod.address.street} onFocus={() => handleHighlight(prod.fieldCoordinates?.street, prod.sectionCoordinates, prod.address.street, prod.originalTexts?.street)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].address.street = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.street, prod.sectionCoordinates, prod.address.street, prod.originalTexts?.street)} /></div>
                                <Input label="No." value={prod.address.streetNo} onFocus={() => handleHighlight(prod.fieldCoordinates?.streetNo, prod.sectionCoordinates, prod.address.streetNo, prod.originalTexts?.streetNo)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].address.streetNo = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.streetNo, prod.sectionCoordinates, prod.address.streetNo, prod.originalTexts?.streetNo)} />
                             </div>
                             <div className="grid grid-cols-4 gap-2">
                                <div className="col-span-1"><Input label="Post Code" value={prod.address.postCode} onFocus={() => handleHighlight(prod.fieldCoordinates?.postCode, prod.sectionCoordinates, prod.address.postCode, prod.originalTexts?.postCode)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].address.postCode = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.postCode, prod.sectionCoordinates, prod.address.postCode, prod.originalTexts?.postCode)} /></div>
                                <div className="col-span-2"><Input label="City" value={prod.address.city} onFocus={() => handleHighlight(prod.fieldCoordinates?.city, prod.sectionCoordinates, prod.address.city, prod.originalTexts?.city)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].address.city = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.city, prod.sectionCoordinates, prod.address.city, prod.originalTexts?.city)} /></div>
                                <div className="col-span-1"><Input label="Country" value={prod.address.countryCode} onFocus={() => handleHighlight(prod.fieldCoordinates?.countryCode, prod.sectionCoordinates, prod.address.countryCode, prod.originalTexts?.countryCode)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].address.countryCode = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.countryCode, prod.sectionCoordinates, prod.address.countryCode, prod.originalTexts?.countryCode)} /></div>
                             </div>
                             <Input label="Fax" value={prod.fax} onFocus={() => handleHighlight(prod.fieldCoordinates?.fax, prod.sectionCoordinates, prod.fax, prod.originalTexts?.fax)} onChange={(v) => { const list = [...drmdData.administrativeData.producers]; list[idx].fax = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, producers: list}})); }} onInfoClick={() => handleHighlight(prod.fieldCoordinates?.fax, prod.sectionCoordinates, prod.fax, prod.originalTexts?.fax)} />
                        </div>
                     </div>
                </div>
            ))}
        </div>

        <div className="space-y-4 border p-4 rounded-lg bg-white shadow-sm">
            <div className="flex justify-between items-center border-b pb-2">
                <SectionHeader title="Responsible Persons" icon="👥" />
                <button onClick={() => setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, responsiblePersons: [...p.administrativeData.responsiblePersons, {...INITIAL_PERSON, uuid: generateUUID()}]}}))} className="text-sm bg-indigo-50 text-indigo-600 px-3 py-1 rounded hover:bg-indigo-100 font-medium">+ Add Person</button>
            </div>
            {drmdData.administrativeData.responsiblePersons.map((rp, idx) => (
                <div key={rp.uuid} className="bg-white border border-gray-200 p-4 rounded-lg shadow-sm space-y-3 relative mb-4">
                     <div className="font-bold text-gray-500 text-sm">Responsible Person {idx + 1}</div>
                     <button onClick={() => {
                        if (drmdData.administrativeData.responsiblePersons.length > 1) {
                            const list = [...drmdData.administrativeData.responsiblePersons]; list.splice(idx, 1); setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, responsiblePersons: list}}));
                        }
                     }} className="absolute top-4 right-4 text-red-400 hover:text-red-600 disabled:opacity-50" disabled={drmdData.administrativeData.responsiblePersons.length <= 1}>🗑️</button>

                     <div className="grid grid-cols-3 gap-4">
                         <div>
                            <Input label={drmdData.administrativeData.title === "referenceMaterialCertificate" ? "Name *" : "Name"} value={rp.name} onFocus={() => handleHighlight(getMergedBox([rp.sectionCoordinates, rp.fieldCoordinates?.name, rp.fieldCoordinates?.role, rp.fieldCoordinates?.description]), null, rp.name, rp.originalTexts?.name)} onChange={(v) => { const list = [...drmdData.administrativeData.responsiblePersons]; list[idx].name = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, responsiblePersons: list}})); }} onInfoClick={() => handleHighlight(getMergedBox([rp.sectionCoordinates, rp.fieldCoordinates?.name, rp.fieldCoordinates?.role, rp.fieldCoordinates?.description]), null, rp.name, rp.originalTexts?.name)} />
                            <div className="mt-2"><Input label={drmdData.administrativeData.title === "referenceMaterialCertificate" ? "Role *" : "Role"} value={rp.role} onFocus={() => handleHighlight(getMergedBox([rp.sectionCoordinates, rp.fieldCoordinates?.name, rp.fieldCoordinates?.role, rp.fieldCoordinates?.description]), null, rp.role, rp.originalTexts?.role)} onChange={(v) => { const list = [...drmdData.administrativeData.responsiblePersons]; list[idx].role = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, responsiblePersons: list}})); }} onInfoClick={() => handleHighlight(getMergedBox([rp.sectionCoordinates, rp.fieldCoordinates?.name, rp.fieldCoordinates?.role, rp.fieldCoordinates?.description]), null, rp.role, rp.originalTexts?.role)} /></div>
                         </div>
                         <div>
                            <TextArea label="Description" value={rp.description} onFocus={() => handleHighlight(getMergedBox([rp.sectionCoordinates, rp.fieldCoordinates?.name, rp.fieldCoordinates?.role, rp.fieldCoordinates?.description]), null, rp.description, rp.originalTexts?.description)} onChange={(v) => { const list = [...drmdData.administrativeData.responsiblePersons]; list[idx].description = v; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, responsiblePersons: list}})); }} onInfoClick={() => handleHighlight(getMergedBox([rp.sectionCoordinates, rp.fieldCoordinates?.name, rp.fieldCoordinates?.role, rp.fieldCoordinates?.description]), null, rp.description, rp.originalTexts?.description)} />
                         </div>
                         <div className="bg-gray-50 p-3 rounded flex items-center">
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer font-bold"><input type="checkbox" checked={rp.mainSigner} onChange={(e) => { const list = [...drmdData.administrativeData.responsiblePersons]; list[idx].mainSigner = e.target.checked; setDrmdData(p => ({...p, administrativeData: {...p.administrativeData, responsiblePersons: list}})); }} /> Main Signer</label>
                            </div>
                         </div>
                     </div>
                </div>
            ))}
        </div>
    </div>
  );

  const renderMaterials = () => (
    <div className="space-y-6 animate-fadeIn">
        <div className="flex justify-between items-center">
            <SectionHeader title="Materials" icon="🧪" />
            <button onClick={() => setDrmdData(p => ({...p, materials: [...p.materials, {
                uuid: generateUUID(), xmlId: `mat_unknown`, name: "", description: "", materialClass: "", itemQuantities: "", minimumSampleSize: "", isCertified: false, materialIdentifiers: [{...INITIAL_ID}]
            }]}))} className="text-sm bg-indigo-50 text-indigo-600 px-3 py-1 rounded hover:bg-indigo-100 font-medium">+ Add Material</button>
        </div>
        
        {drmdData.materials.map((mat, idx) => (
            <div key={mat.uuid} className="bg-white border border-gray-200 p-4 rounded-lg relative space-y-4 shadow-sm">
                <div className="font-bold text-gray-500 text-sm">Material {idx + 1}</div>
                <button onClick={() => { 
                    if(drmdData.materials.length > 1) {
                        const list = [...drmdData.materials]; list.splice(idx, 1); setDrmdData(p => ({...p, materials: list})); 
                    }
                }} className="absolute top-4 right-4 text-red-400 hover:text-red-600 disabled:opacity-50" disabled={drmdData.materials.length <= 1}>🗑️</button>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-3">
                        <Input label={drmdData.administrativeData.title === "referenceMaterialCertificate" ? "Name *" : "Name"} value={mat.name} onFocus={() => handleHighlight(mat.fieldCoordinates?.name, mat.sectionCoordinates, mat.name, mat.originalTexts?.name)} onChange={(v) => { const list = [...drmdData.materials]; list[idx].name = v; setDrmdData(p => ({...p, materials: list})); }} onInfoClick={() => handleHighlight(mat.fieldCoordinates?.name, mat.sectionCoordinates, mat.name, mat.originalTexts?.name)} />
                        <Input label="Assigned Material Identifier (XML ID)" value={mat.xmlId || ""} onChange={(v) => { const list = [...drmdData.materials]; list[idx].xmlId = v; setDrmdData(p => ({...p, materials: list})); }} />
                        
                        {mat.materialIdentifiers.map((mid, midIdx) => {
                             const hasScheme = mid.scheme && mid.scheme !== "MaterialID" && mid.scheme.trim() !== "";
                             const compositeValue = hasScheme ? `${mid.scheme}-${mid.value}` : mid.value;
                             return (
                                 <Input 
                                     key={midIdx}
                                     label="RM Code (e.g. BAM-M386a)" 
                                     value={compositeValue}
                                     onFocus={() => handleHighlight(mat.fieldCoordinates?.materialIdentifiers, mat.sectionCoordinates, compositeValue.trim())}
                                     onChange={(val) => {
                                         const list = [...drmdData.materials];
                                         let scheme = "";
                                         let value = val;
                                         const hyphenIdx = val.indexOf('-');
                                         const spaceIdx = val.indexOf(' ');
                                         if (hyphenIdx !== -1) {
                                             scheme = val.substring(0, hyphenIdx).trim();
                                             value = val.substring(hyphenIdx + 1).trim();
                                         } else if (spaceIdx !== -1) {
                                             scheme = val.substring(0, spaceIdx).trim();
                                             value = val.substring(spaceIdx + 1).trim();
                                         }
                                         list[idx].materialIdentifiers[midIdx].scheme = scheme;
                                         list[idx].materialIdentifiers[midIdx].value = value;
                                         setDrmdData(p => ({...p, materials: list}));
                                     }}
                                     onInfoClick={() => handleHighlight(mat.fieldCoordinates?.materialIdentifiers, mat.sectionCoordinates, compositeValue.trim())}
                                 />
                             );
                        })}

                        <Input label="Material Class" value={mat.materialClass} onFocus={() => handleHighlight(mat.fieldCoordinates?.materialClass, mat.sectionCoordinates, mat.materialClass, mat.originalTexts?.materialClass)} onChange={(v) => { const list = [...drmdData.materials]; list[idx].materialClass = v; setDrmdData(p => ({...p, materials: list})); }} onInfoClick={() => handleHighlight(mat.fieldCoordinates?.materialClass, mat.sectionCoordinates, mat.materialClass, mat.originalTexts?.materialClass)} />
                        
                        <div className="space-y-1">
                            <Input label="Item Quantities" value={mat.itemQuantities} onFocus={() => handleHighlight(mat.fieldCoordinates?.itemQuantities, mat.sectionCoordinates, mat.itemQuantities, mat.originalTexts?.itemQuantities)} onChange={(v) => { const list = [...drmdData.materials]; list[idx].itemQuantities = v; setDrmdData(p => ({...p, materials: list})); }} onInfoClick={() => handleHighlight(mat.fieldCoordinates?.itemQuantities, mat.sectionCoordinates, mat.itemQuantities, mat.originalTexts?.itemQuantities)} />
                            <div className="w-full border border-gray-200 bg-gray-50 rounded-md p-2 text-xs font-mono text-gray-600 truncate">
                                {getDsiPreview(mat.itemQuantities)}
                            </div>
                        </div>
                    </div>
                    <div className="space-y-3">
                         <TextArea label={drmdData.administrativeData.title === "referenceMaterialCertificate" ? "Description *" : "Description"} value={mat.description} onFocus={() => handleHighlight(mat.fieldCoordinates?.description, mat.sectionCoordinates, mat.description, mat.originalTexts?.description)} onChange={(v) => { const list = [...drmdData.materials]; list[idx].description = v; setDrmdData(p => ({...p, materials: list})); }} onInfoClick={() => handleHighlight(mat.fieldCoordinates?.description, mat.sectionCoordinates, mat.description, mat.originalTexts?.description)} />
                         <div className="grid grid-cols-2 gap-4 items-end">
                             <div className="space-y-1">
                                <Input label="Min Sample Size (e.g. 4.9 g) *" value={mat.minimumSampleSize} onFocus={() => handleHighlight(mat.fieldCoordinates?.minimumSampleSize, mat.sectionCoordinates, mat.minimumSampleSize, mat.originalTexts?.minimumSampleSize)} onChange={(v) => { const list = [...drmdData.materials]; list[idx].minimumSampleSize = v; setDrmdData(p => ({...p, materials: list})); }} onInfoClick={() => handleHighlight(mat.fieldCoordinates?.minimumSampleSize, mat.sectionCoordinates, mat.minimumSampleSize, mat.originalTexts?.minimumSampleSize)} />
                                <div className="w-full border border-gray-200 bg-gray-50 rounded-md p-2 text-xs font-mono text-gray-600 truncate">
                                    {getDsiPreview(mat.minimumSampleSize)}
                                </div>
                             </div>
                         </div>
                    </div>
                </div>
            </div>
        ))}
    </div>
  );

  const renderProperties = () => (
      <div className="space-y-6 animate-fadeIn">
          <div className="flex justify-between items-center">
              <SectionHeader title="Properties" icon="📊" />
              <button onClick={() => setDrmdData(p => ({...p, properties: [...p.properties, {
                  uuid: generateUUID(), id: "", name: "New Property Set", isCertified: true, description: "", procedures: "", results: []
              }]}))} className="text-sm bg-indigo-50 text-indigo-600 px-3 py-1 rounded hover:bg-indigo-100 font-medium">+ Add Property Set</button>
          </div>

          {drmdData.properties.map((prop, pIdx) => (
              <div key={prop.uuid} className="border border-gray-300 rounded-xl overflow-hidden mb-6 shadow-sm bg-white">
                   <div className={`p-3 ${prop.isCertified ? 'bg-green-50 border-b border-green-100' : 'bg-yellow-50 border-b border-yellow-100'} flex justify-between items-center`}>
                        <div className="flex items-center gap-4 flex-1">
                            <div className="w-32">
                                <input 
                                    type="text" 
                                    value={prop.id || ""}
                                    placeholder="ID (opt)"
                                    onChange={(e) => { const list = [...drmdData.properties]; list[pIdx].id = e.target.value; setDrmdData(p => ({...p, properties: list})); }}
                                    className="bg-white/50 text-sm px-2 py-1 rounded border border-transparent hover:border-gray-300 outline-none w-full"
                                />
                            </div>
                            <div className="flex-1 flex items-center gap-2">
                                <input 
                                    type="text" 
                                    value={prop.name}
                                    onChange={(e) => { const list = [...drmdData.properties]; list[pIdx].name = e.target.value; setDrmdData(p => ({...p, properties: list})); }}
                                    className={`font-bold bg-transparent outline-none ${prop.isCertified ? 'text-green-800' : 'text-yellow-800'} w-full text-lg`}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold cursor-pointer"><input type="checkbox" disabled={drmdData.administrativeData.title === "productInformationSheet"} checked={drmdData.administrativeData.title === "productInformationSheet" ? false : prop.isCertified} onChange={(e) => { const list = [...drmdData.properties]; list[pIdx].isCertified = e.target.checked; setDrmdData(p => ({...p, properties: list})); }} /> Certified</label>
                            <button onClick={() => { const list = [...drmdData.properties]; list.splice(pIdx, 1); setDrmdData(p => ({...p, properties: list})); }} className="text-red-400 hover:text-red-600 ml-2">🗑️</button>
                        </div>
                   </div>
                   <div className="p-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <TextArea label="Description" value={prop.description} onChange={(v) => { const list = [...drmdData.properties]; list[pIdx].description = v; setDrmdData(p => ({...p, properties: list})); }} onInfoClick={() => handleHighlight(prop.description)} />
                            <TextArea label="Procedures" value={prop.procedures} onChange={(v) => { const list = [...drmdData.properties]; list[pIdx].procedures = v; setDrmdData(p => ({...p, properties: list})); }} onInfoClick={() => handleHighlight(prop.procedures)} />
                        </div>
                        
                        <div className="space-y-6 mt-4">
                            {prop.results.map((res, rIdx) => (
                                <div key={res.uuid} className="bg-gray-50 p-4 rounded border border-gray-200 shadow-sm">
                                    <div className="flex gap-4 mb-4 items-start">
                                        <div className="flex-1 space-y-3">
                                            <Input label="Table Name" value={res.name} onFocus={() => handleHighlight(res.sectionCoordinates, null, res.name)} onChange={(v) => { const list = [...drmdData.properties]; list[pIdx].results[rIdx].name = v; setDrmdData(p => ({...p, properties: list})); }} onInfoClick={() => handleHighlight(res.sectionCoordinates, null, res.name)} />
                                            <div>
                                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Linked Material Identifier</label>
                                                <select 
                                                    value={res.materialRef || ""} 
                                                    onChange={(e) => { const list = [...drmdData.properties]; list[pIdx].results[rIdx].materialRef = e.target.value; setDrmdData(p => ({...p, properties: list})); }}
                                                    className="bg-white border border-gray-200 text-sm px-2 py-1.5 rounded outline-none w-full shadow-sm text-gray-700"
                                                >
                                                    <option value="">None (Applies to all or N/A)</option>
                                                    {drmdData.materials.map(m => (
                                                        <option key={m.uuid} value={m.uuid}>{m.xmlId || m.name || "Unnamed Material"}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="flex-[2]">
                                            <TextArea label="Table Description" value={res.description} onFocus={() => handleHighlight(res.sectionCoordinates, null, res.description)} onChange={(v) => { const list = [...drmdData.properties]; list[pIdx].results[rIdx].description = v; setDrmdData(p => ({...p, properties: list})); }} onInfoClick={() => handleHighlight(res.sectionCoordinates, null, res.description)} />
                                        </div>
                                        <button onClick={() => { const list = [...drmdData.properties]; list[pIdx].results.splice(rIdx, 1); setDrmdData(p => ({...p, properties: list})); }} className="text-xs text-red-500 mt-6 bg-white border border-red-100 px-2 py-1 rounded">Remove</button>
                                    </div>
                                    
                                    <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
                                        <table className="min-w-full divide-y divide-gray-200 text-xs">
                                            <thead className="bg-gray-100">
                                                <tr>
                                                    <th className="px-2 py-2 text-left w-32">Name *</th>
                                                    <th className="px-2 py-2 text-left w-24">CAS</th>
                                                    <th className="px-2 py-2 text-left w-24">Value *</th>
                                                    <th className="px-2 py-2 text-left w-24">Uncertainty</th>
                                                    <th className="px-2 py-2 text-left w-20">Unit *</th>
                                                    <th className="px-2 py-2 text-left w-24">DSI Unit *</th>
                                                    <th className="px-2 py-2 text-left w-16 group">
                                                        <div className="flex items-center gap-1 relative">
                                                            k factor
                                                            {res.coverageReasoning && (
                                                                <div className="relative">
                                                                    <span className="text-orange-500 cursor-pointer hover:text-orange-600">&#9432;</span>
                                                                    <div className="absolute hidden group-hover:block z-50 bg-gray-800 text-white text-xs rounded p-2 w-64 top-full mt-1 left-0 shadow-lg font-normal whitespace-normal break-words pointer-events-none">
                                                                        <strong className="block text-orange-300 mb-1">AI Reasoning:</strong>
                                                                        {res.coverageReasoning}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </th>
                                                    <th className="px-2 py-2 text-left w-24 group">
                                                        <div className="flex items-center gap-1 relative">
                                                            Probability
                                                            {res.coverageReasoning && (
                                                                <div className="relative">
                                                                    <span className="text-orange-500 cursor-pointer hover:text-orange-600">&#9432;</span>
                                                                    <div className="absolute hidden group-hover:block z-50 bg-gray-800 text-white text-xs rounded p-2 w-64 top-full mt-1 left-0 shadow-lg font-normal whitespace-normal break-words pointer-events-none">
                                                                        <strong className="block text-orange-300 mb-1">AI Reasoning:</strong>
                                                                        {res.coverageReasoning}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </th>
                                                    <th className="px-2 py-2 w-10"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200">
                                                {res.quantities.map((q, qIdx) => (
                                                    <tr key={q.uuid} className="hover:bg-gray-50 group">
                                                        <td className="p-1 relative">
                                                            <input 
                                                                className="w-full border-b border-transparent group-hover:border-gray-300 outline-none bg-transparent pr-4" 
                                                                value={q.name} 
                                                                onFocus={() => handleHighlight(res.sectionCoordinates, null, res.name)}
                                                                onChange={(e) => { const list = [...drmdData.properties]; list[pIdx].results[rIdx].quantities[qIdx].name = e.target.value; setDrmdData(p => ({...p, properties: list})); }} 
                                                            />
                                                        </td>
                                                        <td className="p-1">
                                                            <div className="w-full border-b border-transparent bg-gray-50 text-gray-600 text-xs px-1 py-2 overflow-x-auto whitespace-nowrap font-mono">
                                                                {getCasNumber(q.name) || "-"}
                                                            </div>
                                                        </td>
                                                        <td className="p-1 relative group-td">
                                                            <input 
                                                                className="w-full border-b border-transparent group-hover:border-gray-300 outline-none bg-transparent pr-4" 
                                                                value={q.value} 
                                                                onFocus={() => handleHighlight(res.sectionCoordinates, null, res.name)}
                                                                onChange={(e) => { 
                                                                    const list = [...drmdData.properties]; 
                                                                    list[pIdx].results[rIdx].quantities[qIdx].value = e.target.value; 
                                                                    const dsi = convertToDSI(e.target.value, q.unit);
                                                                    list[pIdx].results[rIdx].quantities[qIdx].dsiValue = dsi.dsiValue;
                                                                    list[pIdx].results[rIdx].quantities[qIdx].dsiUnit = dsi.dsiUnit;
                                                                    setDrmdData(p => ({...p, properties: list})); 
                                                                }} 
                                                            />
                                                        </td>
                                                        <td className="p-1 relative">
                                                            <input 
                                                                className="w-full border-b border-transparent group-hover:border-gray-300 outline-none bg-transparent pr-4" 
                                                                value={q.uncertainty} 
                                                                onFocus={() => handleHighlight(res.sectionCoordinates, null, res.name)}
                                                                onChange={(e) => { const list = [...drmdData.properties]; list[pIdx].results[rIdx].quantities[qIdx].uncertainty = e.target.value; setDrmdData(p => ({...p, properties: list})); }} 
                                                            />
                                                        </td>
                                                        <td className="p-1 relative">
                                                            <input 
                                                                className="w-full border-b border-transparent group-hover:border-gray-300 outline-none bg-transparent pr-4" 
                                                                value={q.unit} 
                                                                onFocus={() => handleHighlight(res.sectionCoordinates, null, res.name)}
                                                                onChange={(e) => { 
                                                                    const list = [...drmdData.properties]; 
                                                                    list[pIdx].results[rIdx].quantities[qIdx].unit = e.target.value; 
                                                                    const dsi = convertToDSI(q.value, e.target.value);
                                                                    list[pIdx].results[rIdx].quantities[qIdx].dsiValue = dsi.dsiValue;
                                                                    list[pIdx].results[rIdx].quantities[qIdx].dsiUnit = dsi.dsiUnit;
                                                                    setDrmdData(p => ({...p, properties: list})); 
                                                                }} 
                                                            />
                                                        </td>
                                                        <td className="p-1">
                                                            <div className="w-full border-b border-transparent bg-gray-50 text-gray-600 text-xs px-1 py-2 overflow-x-auto whitespace-nowrap font-mono">
                                                                {q.dsiUnit}
                                                            </div>
                                                        </td>
                                                        <td className="p-1"><input className="w-full border-b border-transparent group-hover:border-gray-300 outline-none bg-transparent" value={q.coverageFactor} onFocus={() => handleHighlight(res.sectionCoordinates, null, res.name)} onChange={(e) => { const list = [...drmdData.properties]; list[pIdx].results[rIdx].quantities[qIdx].coverageFactor = e.target.value; setDrmdData(p => ({...p, properties: list})); }} /></td>
                                                        <td className="p-1"><input className="w-full border-b border-transparent group-hover:border-gray-300 outline-none bg-transparent" value={q.coverageProbability} onFocus={() => handleHighlight(res.sectionCoordinates, null, res.name)} onChange={(e) => { const list = [...drmdData.properties]; list[pIdx].results[rIdx].quantities[qIdx].coverageProbability = e.target.value; setDrmdData(p => ({...p, properties: list})); }} /></td>
                                                        <td className="p-1 text-center"><button onClick={() => { const list = [...drmdData.properties]; list[pIdx].results[rIdx].quantities.splice(qIdx, 1); setDrmdData(p => ({...p, properties: list})); }} className="text-red-400 hover:text-red-600">×</button></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <div className="p-2 bg-gray-50 border-t">
                                            <button onClick={() => { 
                                                const list = [...drmdData.properties]; 
                                                list[pIdx].results[rIdx].quantities.push({ ...INITIAL_QUANTITY, uuid: generateUUID(), identifiers: [] });
                                                setDrmdData(p => ({...p, properties: list}));
                                            }} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ Add Row</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <button 
                                onClick={() => {
                                    const list = [...drmdData.properties];
                                    list[pIdx].results.push({
                                        uuid: generateUUID(),
                                        name: "",
                                        description: "",
                                        quantities: [{ ...INITIAL_QUANTITY, uuid: generateUUID(), identifiers: [] }]
                                    });
                                    setDrmdData(p => ({...p, properties: list}));
                                }}
                                className="w-full py-2 border-2 border-dashed border-indigo-200 bg-indigo-50/50 text-indigo-600 rounded-lg hover:bg-indigo-50 hover:border-indigo-300 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                            >
                                <span className="text-lg font-bold">+</span> Add Table
                            </button>
                        </div>
                   </div>
              </div>
          ))}
      </div>
  );

  const renderStatements = () => (
      <div className="space-y-6 animate-fadeIn">
          <SectionHeader title="Official ISO 17034 Statements" icon="📋" />
          <p className="text-sm text-gray-500 mb-4">Standard statements required by ISO 17034 for reference material certificates.</p>
          
          <TextArea label="Intended Use *" value={drmdData.statements.official.intendedUse} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, intendedUse: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.intendedUse, null, drmdData.statements.official.intendedUse, drmdData.statements.official.originalTexts?.intendedUse)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.intendedUse, null, drmdData.statements.official.intendedUse, drmdData.statements.official.originalTexts?.intendedUse)} />
          <TextArea label="Commutability" value={drmdData.statements.official.commutability} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, commutability: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.commutability, null, drmdData.statements.official.commutability, drmdData.statements.official.originalTexts?.commutability)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.commutability, null, drmdData.statements.official.commutability, drmdData.statements.official.originalTexts?.commutability)} />
          <TextArea label="Storage Information *" value={drmdData.statements.official.storageInformation} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, storageInformation: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.storageInformation, null, drmdData.statements.official.storageInformation, drmdData.statements.official.originalTexts?.storageInformation)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.storageInformation, null, drmdData.statements.official.storageInformation, drmdData.statements.official.originalTexts?.storageInformation)} />
          <TextArea label="Instructions For Handling And Use *" value={drmdData.statements.official.handlingInstructions} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, handlingInstructions: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.handlingInstructions, null, drmdData.statements.official.handlingInstructions, drmdData.statements.official.originalTexts?.handlingInstructions)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.handlingInstructions, null, drmdData.statements.official.handlingInstructions, drmdData.statements.official.originalTexts?.handlingInstructions)} />
          <TextArea label={drmdData.administrativeData.title === "referenceMaterialCertificate" ? "Metrological Traceability *" : "Metrological Traceability"} value={drmdData.statements.official.metrologicalTraceability} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, metrologicalTraceability: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.metrologicalTraceability, null, drmdData.statements.official.metrologicalTraceability, drmdData.statements.official.originalTexts?.metrologicalTraceability)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.metrologicalTraceability, null, drmdData.statements.official.metrologicalTraceability, drmdData.statements.official.originalTexts?.metrologicalTraceability)} />
          <TextArea label="Health And Safety Information" value={drmdData.statements.official.healthAndSafety} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, healthAndSafety: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.healthAndSafety, null, drmdData.statements.official.healthAndSafety, drmdData.statements.official.originalTexts?.healthAndSafety)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.healthAndSafety, null, drmdData.statements.official.healthAndSafety, drmdData.statements.official.originalTexts?.healthAndSafety)} />
          <TextArea label="Subcontractors" value={drmdData.statements.official.subcontractors} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, subcontractors: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.subcontractors, null, drmdData.statements.official.subcontractors, drmdData.statements.official.originalTexts?.subcontractors)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.subcontractors, null, drmdData.statements.official.subcontractors, drmdData.statements.official.originalTexts?.subcontractors)} />
          <TextArea label="Legal Notice" value={drmdData.statements.official.legalNotice} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, legalNotice: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.legalNotice, null, drmdData.statements.official.legalNotice, drmdData.statements.official.originalTexts?.legalNotice)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.legalNotice, null, drmdData.statements.official.legalNotice, drmdData.statements.official.originalTexts?.legalNotice)} />
          <TextArea label="Reference To Certification Report" value={drmdData.statements.official.referenceToCertificationReport} onChange={(v) => setDrmdData(p => ({...p, statements: {...p.statements, official: {...p.statements.official, referenceToCertificationReport: v}}}))} onFocus={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.referenceToCertificationReport, null, drmdData.statements.official.referenceToCertificationReport, drmdData.statements.official.originalTexts?.referenceToCertificationReport)} onInfoClick={() => handleHighlight(drmdData.statements.official.fieldCoordinates?.referenceToCertificationReport, null, drmdData.statements.official.referenceToCertificationReport, drmdData.statements.official.originalTexts?.referenceToCertificationReport)} />

          <SectionHeader title="Other Statements" icon="📝" />
          <p className="text-sm text-gray-500 mb-4">Add custom statements beyond the standard ISO 17034 requirements.</p>
          {drmdData.statements.custom.map((st, idx) => (
              <div key={st.uuid} className="flex gap-4 items-start mb-4 bg-white p-4 rounded border border-gray-200 shadow-sm relative">
                  <button onClick={() => { const list = [...drmdData.statements.custom]; list.splice(idx, 1); setDrmdData(p => ({...p, statements: {...p.statements, custom: list}})); }} className="absolute top-2 right-2 text-red-400 hover:text-red-600">🗑️</button>
                  <div className="flex-1 space-y-2">
                      <Input label="Statement Name" value={st.name} onChange={(v) => { const list = [...drmdData.statements.custom]; list[idx].name = v; setDrmdData(p => ({...p, statements: {...p.statements, custom: list}})); }} onInfoClick={() => handleHighlight(st.name)} />
                      <TextArea label="Content" value={st.content} onChange={(v) => { const list = [...drmdData.statements.custom]; list[idx].content = v; setDrmdData(p => ({...p, statements: {...p.statements, custom: list}})); }} onInfoClick={() => handleHighlight(st.content)} />
                  </div>
              </div>
          ))}
          <button onClick={() => setDrmdData(p => ({...p, statements: {...p.statements, custom: [...p.statements.custom, { uuid: generateUUID(), name: "", content: "" }]}}))} className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded hover:bg-indigo-100 text-sm font-semibold">+ Add Statement</button>
      </div>
  );

  const renderCommentAndDocument = () => {
    const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (file.size > 200 * 1024 * 1024) {
                alert("File size exceeds 200MB limit.");
                return;
            }
            const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
            const allowedExts = ['pdf', 'doc', 'docx', 'txt'];
            const ext = file.name.split('.').pop()?.toLowerCase();
            if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext || '')) {
                alert("Only PDF, DOC, DOCX, and TXT files are allowed.");
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result as string;
                const base64Data = base64String.split(',')[1];
                setDrmdData(p => ({
                    ...p, 
                    binaryDocuments: [
                        ...(p.binaryDocuments || []),
                        {
                            fileName: file.name,
                            mimeType: file.type || "application/octet-stream",
                            data: base64Data
                        }
                    ]
                }));
            };
            reader.readAsDataURL(file);
        }
    };

    return (
      <div className="space-y-6 animate-fadeIn">
          <SectionHeader title="Comment and Document" icon="💬" />
          
          <div className="space-y-4">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Comment</h3>
              <textarea 
                  className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-32"
                  placeholder="Enter your comment"
                  value={drmdData.generalComment}
                  onChange={(e) => setDrmdData(p => ({...p, generalComment: e.target.value}))}
              />
          </div>

          <div className="space-y-2">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Upload Documents</h3>
              
              {drmdData.binaryDocuments && drmdData.binaryDocuments.length > 0 && (
                  <div className="space-y-3 mb-4">
                      {drmdData.binaryDocuments.map((doc, idx) => (
                          <div key={idx} className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between shadow-sm">
                              <div className="flex items-center gap-3">
                                  <div className="text-2xl">📄</div>
                                  <div>
                                      <p className="font-bold text-sm text-gray-800">{doc.fileName}</p>
                                      <p className="text-xs text-gray-500">Document attached</p>
                                  </div>
                              </div>
                              <button 
                                  onClick={() => setDrmdData(p => ({
                                      ...p, 
                                      binaryDocuments: p.binaryDocuments.filter((_, i) => i !== idx)
                                  }))}
                                  className="text-red-500 hover:text-red-700 p-2"
                                  title="Remove file"
                              >
                                  ✕
                              </button>
                          </div>
                      ))}
                  </div>
              )}

              <div className="border-2 border-dashed border-indigo-200 bg-indigo-50/30 rounded-lg p-8 flex flex-col items-center justify-center text-center transition hover:bg-indigo-50">
                  <div className="text-4xl mb-2 text-indigo-300">☁️</div>
                  <p className="font-medium text-gray-700">Drag and drop file here</p>
                  <p className="text-xs text-gray-500 mt-1 mb-4">Limit 200MB per file • PDF, DOC, DOCX, TXT</p>
                  <input 
                      type="file" 
                      id="doc-upload"
                      className="hidden" 
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={handleDocUpload}
                  />
                  <label htmlFor="doc-upload" className="cursor-pointer bg-white border border-gray-300 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 text-gray-700 shadow-sm">
                      Browse files
                  </label>
              </div>
          </div>
      </div>
    );
  };

  const renderValidateExport = () => {
    const { errors, conditionalErrors, warnings, isCompliant: isValid } = validateDrmd(drmdData);
    const xmlPreview = generateDrmdXml(drmdData);
    const htmlPreview = generateHtmlReport(drmdData);

    const handleHtmlExport = () => {
        const blob = new Blob([htmlPreview], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${getExportFilename()}.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const doneCount = bulkResults.filter(r => r.status === 'done').length;
    const errorCount = bulkResults.filter(r => r.status === 'error').length;
    const totalCount = bulkResults.length;
    const progressPercent = totalCount > 0 ? Math.round((bulkProgress.current / totalCount) * 100) : 0;

    return (
        <div className="space-y-6 animate-fadeIn pb-10">
            <SectionHeader title="Validate & Export" icon="✅" />
            
            {/* ═══════════════════ BULK PROCESSING RESULTS SECTION ═══════════════════ */}
            {(bulkResults.length > 0 || bulkProcessing) && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 border-b border-gray-200 pb-3">
                        <span className="text-2xl bg-amber-100 p-2 rounded-lg">📁</span>
                        <h2 className="text-xl font-bold text-gray-800">Bulk Processing Results</h2>
                        {bulkProcessing && (
                            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 animate-pulse">
                                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                                Processing...
                            </span>
                        )}
                        {!bulkProcessing && totalCount > 0 && (
                            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800">
                                ✓ Complete
                            </span>
                        )}
                    </div>

                    {/* Progress Bar */}
                    {(bulkProcessing || totalCount > 0) && (
                        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium text-gray-700">
                                    {bulkProcessing 
                                        ? `Extracting ${bulkProgress.current} of ${bulkProgress.total} certificates...`
                                        : `${doneCount} of ${totalCount} certificates processed successfully`
                                    }
                                </span>
                                <span className="text-sm font-bold text-gray-900">{progressPercent}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                                <div 
                                    className={`h-full rounded-full transition-all duration-500 ${bulkProcessing ? 'bg-blue-500' : 'bg-green-500'}`}
                                    style={{ width: `${progressPercent}%` }}
                                ></div>
                            </div>
                            <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                                {bulkProcessing && bulkProgress.currentFile && (
                                    <span>Currently: <span className="font-medium text-gray-700">{bulkProgress.currentFile}</span></span>
                                )}
                                <div className="flex gap-3 ml-auto">
                                    <span className="text-green-600 font-medium">✅ {doneCount} Done</span>
                                    {errorCount > 0 && <span className="text-red-600 font-medium">❌ {errorCount} Failed</span>}
                                </div>
                            </div>
                            {bulkProcessing && (
                                <button 
                                    onClick={() => { bulkCancelRef.current = true; }}
                                    className="mt-3 text-xs text-red-600 hover:text-red-800 font-medium underline"
                                >
                                    Cancel Remaining
                                </button>
                            )}
                        </div>
                    )}

                    {/* Results Table */}
                    {totalCount > 0 && (
                        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                                <span className="font-bold text-gray-700 text-sm">Processed Certificates ({totalCount})</span>
                                {!bulkProcessing && doneCount > 0 && (
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={handleBulkDownloadAll}
                                            disabled={bulkProcessing || bulkResults.filter(r => r.status === 'done').length === 0}
                                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-bold disabled:opacity-50 transition shadow-sm text-sm"
                                        >
                                            ⬇ Download All (ZIP)
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide w-10">#</th>
                                            <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide">RM Code</th>
                                            <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide">Material Name</th>
                                            <th className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide">File</th>
                                            <th className="text-center px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide">Status</th>
                                            <th className="text-right px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wide">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {bulkResults.map((result, idx) => (
                                            <tr key={result.id} className={`hover:bg-gray-50 transition ${result.status === 'error' ? 'bg-red-50/30' : ''}`}>
                                                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{idx + 1}</td>
                                                <td className="px-4 py-3 font-bold text-gray-900">
                                                    {result.rmCode || <span className="text-gray-400 italic">—</span>}
                                                </td>
                                                <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate" title={result.rmName}>
                                                    {result.rmName || <span className="text-gray-400 italic">—</span>}
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 text-xs font-mono max-w-[150px] truncate" title={result.fileName}>
                                                    {result.fileName}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    {result.status === 'pending' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">⏳ Pending</span>
                                                    )}
                                                    {result.status === 'processing' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 animate-pulse">
                                                            <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-ping"></span>
                                                            Extracting
                                                        </span>
                                                    )}
                                                    {result.status === 'done' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">✅ Done</span>
                                                    )}
                                                    {result.status === 'error' && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700" title={result.errorMessage}>❌ Error</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {result.status === 'done' && !bulkProcessing && (
                                                        <div className="flex flex-col gap-2 justify-end">
                                                            <div className="flex gap-1 justify-end">
                                                                <span className="text-[10px] uppercase font-bold text-gray-400 self-center mr-1">XML</span>
                                                                <button
                                                                    onClick={() => handleBulkReview(result)}
                                                                    className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold transition border border-indigo-200"
                                                                >
                                                                    🔍 Review
                                                                </button>
                                                                <button
                                                                    onClick={() => handleBulkDownloadSingle(result)}
                                                                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs font-medium transition border border-gray-300"
                                                                >
                                                                    ⬇ Download
                                                                </button>
                                                            </div>
                                                            <div className="flex gap-1 justify-end">
                                                                <span className="text-[10px] uppercase font-bold text-gray-400 self-center mr-1">HTML</span>
                                                                <button
                                                                    onClick={() => handleBulkReviewHtml(result)}
                                                                    className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold transition border border-blue-200"
                                                                >
                                                                    👁️ Preview
                                                                </button>
                                                                <button
                                                                    onClick={() => handleBulkDownloadSingleHtml(result)}
                                                                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs font-medium transition border border-gray-300"
                                                                >
                                                                    ⬇ Download
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {result.status === 'done' && bulkProcessing && (
                                                        <span className="text-xs text-gray-400 italic">Wait for all to finish</span>
                                                    )}
                                                    {result.status === 'error' && (
                                                        <span className="text-xs text-red-500 max-w-[180px] block truncate" title={result.errorMessage}>
                                                            {result.errorMessage}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Error Summary */}
                    {!bulkProcessing && errorCount > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                            <h4 className="text-sm font-bold text-red-800 mb-2">⚠️ Failed Extractions ({errorCount})</h4>
                            <div className="space-y-1">
                                {bulkResults.filter(r => r.status === 'error').map((r) => (
                                    <div key={r.id} className="text-xs text-red-700 flex items-start gap-2">
                                        <span className="font-mono font-bold">{r.fileName}:</span>
                                        <span>{r.errorMessage}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <hr className="border-gray-200" />
                </div>
            )}

            {/* ═══════════════════ SINGLE CERTIFICATE SECTION ═══════════════════ */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <div className={`p-4 rounded-lg border ${isValid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="flex items-center gap-3 mb-2">
                            <div className={`text-2xl ${isValid ? 'text-green-600' : 'text-red-600'}`}>
                                {isValid ? '✓' : '⚠️'}
                            </div>
                            <h3 className={`text-lg font-bold ${isValid ? 'text-green-800' : 'text-red-800'}`}>
                                {isValid ? "Ready for Export" : "Validation Errors Found"}
                            </h3>
                        </div>
                        <p className={`text-sm ${isValid ? 'text-green-700' : 'text-red-700'}`}>
                            {isValid 
                                ? "The document structure appears valid according to schema requirements." 
                                : "Please fix the errors below before exporting."}
                        </p>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 text-sm">Validation Report</div>
                        <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
                            {errors.length === 0 && conditionalErrors.length === 0 && warnings.length === 0 && (
                                <div className="p-4 text-center text-gray-500 italic text-sm">No issues found.</div>
                            )}
                            {errors.map((err, idx) => (
                                <div key={`err-${idx}`} className="p-3 flex gap-3 items-start bg-red-50/50">
                                    <span className="text-red-500 mt-0.5 text-sm">❌</span>
                                    <div>
                                        <span className="text-xs font-bold uppercase text-gray-400 block">{err.ruleId} - {err.section}</span>
                                        <span className="text-sm text-red-700 font-medium">{err.message}</span>
                                    </div>
                                </div>
                            ))}
                            {conditionalErrors.map((err, idx) => (
                                <div key={`cerr-${idx}`} className="p-3 flex gap-3 items-start bg-orange-50/50">
                                    <span className="text-orange-500 mt-0.5 text-sm">🟠</span>
                                    <div>
                                        <span className="text-xs font-bold uppercase text-gray-400 block">{err.ruleId} - {err.section} (Conditional)</span>
                                        <span className="text-sm text-orange-700 font-medium">{err.message}</span>
                                    </div>
                                </div>
                            ))}
                            {warnings.map((warn, idx) => (
                                <div key={`warn-${idx}`} className="p-3 flex gap-3 items-start bg-yellow-50/50">
                                    <span className="text-yellow-500 mt-0.5 text-sm">⚠️</span>
                                    <div>
                                        <span className="text-xs font-bold uppercase text-gray-400 block">{warn.ruleId} - {warn.section}</span>
                                        <span className="text-sm text-yellow-800 font-medium">{warn.message}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                 <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col min-h-[400px]">
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 text-sm flex justify-between items-center">
                          <span>XML Preview</span>
                          <button 
                              onClick={() => navigator.clipboard.writeText(xmlPreview)}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                              Copy Code
                          </button>
                      </div>
                      <div className="relative flex-1 bg-gray-900" style={{minHeight: '300px'}}>
                          <textarea 
                              readOnly 
                              value={xmlPreview} 
                              className="absolute inset-0 w-full h-full p-4 bg-gray-900 text-green-400 font-mono text-xs resize-none outline-none"
                          />
                      </div>
                      <div className="p-4 bg-gray-50 border-t border-gray-200">
                          <button 
                              onClick={handleExport}
                              disabled={!isValid}
                              className={`w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 shadow-sm transition-all ${
                                  isValid 
                                  ? 'bg-indigo-600 hover:bg-indigo-700 hover:shadow' 
                                  : 'bg-gray-400 cursor-not-allowed opacity-70'
                              }`}
                          >
                              <span>💾</span> Download DRMD XML
                          </button>
                      </div>
                 </div>
            </div>

            <div className="w-full space-y-2">
                 <h3 className="font-bold text-gray-700">HTML Report Preview</h3>
                 <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col h-[800px]">
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 text-sm flex justify-between items-center">
                          <span>Preview</span>
                          <button onClick={handleHtmlExport} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Download HTML</button>
                      </div>
                      <div className="flex-1 p-0 bg-white overflow-hidden relative">
                           <iframe 
                              srcDoc={htmlPreview} 
                              title="HTML Preview" 
                              className="w-full h-full border-none absolute inset-0" 
                           />
                      </div>
                      <div className="p-4 bg-gray-50 border-t border-gray-200">
                           <button onClick={handleHtmlExport} className="w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 shadow-sm bg-indigo-600 hover:bg-indigo-700 transition-all">
                              <span>📄</span> Download HTML Report
                          </button>
                      </div>
                </div>
            </div>
        </div>
    );
  };

  const getMergedBox = (boxes: (number[] | null | undefined)[]): number[] | null => {
      const valid = boxes.filter(b => Array.isArray(b) && b.length === 5 && b[3] > b[1] && b[4] > b[2]) as number[][];
      if (valid.length === 0) return null;
      const page = valid[0][0];
      const pageBoxes = valid.filter(b => b[0] === page);
      if (pageBoxes.length === 0) return null;
      const minY = Math.min(...pageBoxes.map(b => b[1]));
      const minX = Math.min(...pageBoxes.map(b => b[2]));
      const maxY = Math.max(...pageBoxes.map(b => b[3]));
      const maxX = Math.max(...pageBoxes.map(b => b[4]));
      return [page, Math.max(0, minY - 10), Math.max(0, minX - 10), Math.min(1000, maxY + 10), Math.min(1000, maxX + 10)];
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 font-sans text-gray-900">
      <header className="bg-white border-b border-gray-200 p-4 flex justify-between items-center z-10 shadow-sm">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center text-white text-xl">🔬</div>
            <div>
                <h1 className="text-lg font-bold text-gray-800">DRMD Generator</h1>
                <p className="text-xs text-gray-500">Internal Testing v1.0.0-alpha</p>
            </div>
        </div>
        <div className="flex gap-3">
          <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
          <input type="file" accept="text/xml" ref={xmlInputRef} onChange={handleXmlImport} className="hidden" />
          {/* @ts-ignore */}
          <input type="file" ref={bulkFolderInputRef} onChange={handleBulkUpload} className="hidden" multiple accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" webkitdirectory="" directory="" />
          
          <button onClick={() => fileInputRef.current?.click()} className="bg-gray-100 hover:bg-gray-200 transition px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 text-gray-700 border border-gray-300">
            📄 Upload PDF
          </button>

          <button onClick={() => bulkFolderInputRef.current?.click()} className="bg-amber-50 hover:bg-amber-100 transition px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 text-amber-800 border border-amber-300">
            📁 Upload Folder
          </button>
          
          <button onClick={() => xmlInputRef.current?.click()} className="bg-gray-100 hover:bg-gray-200 transition px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 text-gray-700 border border-gray-300">
            📤 Import XML
          </button>

          <button onClick={handleExport} className="bg-indigo-600 text-white hover:bg-indigo-700 transition px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 shadow-sm">
            💾 Export XML
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        <div className="w-[45%] bg-gray-800 border-r border-gray-700 flex flex-col relative">
          {pdfUrl ? (
            <PdfViewer 
                url={pdfUrl} 
                highlightData={highlightData} 
                onTextNotFound={() => showToast(GENERATED_VALUE_MESSAGE, 'generated')}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-10 text-center">
                <div className="text-6xl mb-4 opacity-20">📄</div>
                <p>Upload a certificate to visualize it here.</p>
                <p className="text-xs mt-2 text-gray-600 max-w-xs">Or skip upload and start filling the form manually.</p>
            </div>
          )}
          
          {isProcessing && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center text-white z-50">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500 border-t-transparent mb-4"></div>
              <p className="font-bold text-lg">Processing Document...</p>
              <p className="text-sm text-gray-400 mt-1">{statusMessage}</p>
            </div>
          )}

          {bulkProcessing && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center text-white z-50 p-8">
              <div className="bg-gray-900/80 border border-gray-700 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl">
                  <div className="text-4xl mb-3">📂</div>
                  <h3 className="font-bold text-xl mb-1">Bulk Processing</h3>
                  <p className="text-sm text-gray-400 mb-5">Processing certificates one by one...</p>
                  
                  <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden mb-3">
                      <div 
                          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                          style={{ width: `${bulkProgress.total > 0 ? Math.round((bulkProgress.current / bulkProgress.total) * 100) : 0}%` }}
                      ></div>
                  </div>
                  <p className="text-2xl font-bold mb-1">{bulkProgress.current} <span className="text-gray-500 font-normal text-lg">/ {bulkProgress.total}</span></p>
                  
                  {bulkProgress.currentFile && (
                      <p className="text-xs text-gray-400 mb-4 truncate">
                          Currently: <span className="text-blue-400 font-medium">{bulkProgress.currentFile}</span>
                      </p>
                  )}
                  
                  <div className="flex justify-center gap-4 text-sm mb-5">
                      <span className="text-green-400">✅ {bulkResults.filter(r => r.status === 'done').length} Done</span>
                      {bulkResults.filter(r => r.status === 'error').length > 0 && (
                          <span className="text-red-400">❌ {bulkResults.filter(r => r.status === 'error').length} Failed</span>
                      )}
                  </div>
                  
                  <button 
                      onClick={() => { bulkCancelRef.current = true; }}
                      className="bg-red-500/20 hover:bg-red-500/40 text-red-300 border border-red-500/50 px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                      Cancel Remaining
                  </button>
              </div>
            </div>
          )}
          
          {error && (
             <div className="absolute bottom-5 left-5 right-5 bg-red-500/90 text-white px-4 py-3 rounded shadow-lg backdrop-blur-md border border-red-400">
                <p className="font-bold text-sm">Error</p>
                <p className="text-xs">{error}</p>
             </div>
          )}

          {toastMessage && (
             <div className={`absolute bottom-5 left-1/2 -translate-x-1/2 px-4 py-3 rounded shadow-lg backdrop-blur-md z-50 flex items-center justify-between ${
                 toastType === 'converted' 
                   ? 'bg-blue-50 border border-blue-400 text-blue-900' 
                   : toastType === 'generated'
                     ? 'bg-purple-50 border border-purple-400 text-purple-900'
                     : 'bg-yellow-100 border border-yellow-500 text-yellow-900'
             }`} style={{maxWidth: '500px'}}>
                 <span className="text-sm font-medium">{toastMessage}</span>
                 <button onClick={() => setToastMessage(null)} className={`ml-4 p-1 font-bold focus:outline-none ${
                     toastType === 'converted' ? 'text-blue-700 hover:text-blue-900' : toastType === 'generated' ? 'text-purple-700 hover:text-purple-900' : 'text-yellow-700 hover:text-yellow-900'
                 }`}>&times;</button>
             </div>
          )}
        </div>

        <div className="w-[55%] flex flex-col bg-white">
          <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto hide-scrollbar">
            {[
                { id: 'admin', label: 'Administrative Data', icon: '📋' },
                { id: 'materials', label: 'Materials', icon: '🧪' },
                { id: 'properties', label: 'Properties', icon: '📊' },
                { id: 'statements', label: 'Statements', icon: '📝' },
                { id: 'comment-document', label: 'Comment and Document', icon: '💬' },
                { id: 'validate-export', label: 'Validate & Export', icon: '✅' },
                { id: 'settings', label: 'Settings', icon: '⚙️' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-4 text-sm font-medium transition-all border-b-2 min-w-max ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-700 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-8 bg-white pb-20">
            {activeTab === 'settings' && renderSettings()}
            {activeTab === 'admin' && renderAdmin()}
            {activeTab === 'materials' && renderMaterials()}
            {activeTab === 'properties' && renderProperties()}
            {activeTab === 'statements' && renderStatements()}
            {activeTab === 'comment-document' && renderCommentAndDocument()}
            {activeTab === 'validate-export' && renderValidateExport()}
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionHeader: React.FC<{ title: string; icon: string }> = ({ title, icon }) => (
    <div className="flex items-center gap-2 border-b border-gray-200 pb-3 mb-6">
        <span className="text-2xl bg-gray-100 p-2 rounded-lg">{icon}</span>
        <h2 className="text-xl font-bold text-gray-800">{title}</h2>
    </div>
);

const Input: React.FC<{ label: string; value: any; onChange: (v: string) => void; type?: string; disabled?: boolean; onInfoClick?: () => void; onFocus?: () => void }> = ({ label, value, onChange, type = "text", disabled, onInfoClick, onFocus }) => (
    <div className="w-full">
        <div className="flex items-center justify-between mb-1">
            {label && <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</label>}
            {onInfoClick && (
                <button 
                    onClick={onInfoClick} 
                    title="Highlight in PDF" 
                    className="text-blue-500 hover:text-blue-700 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                </button>
            )}
        </div>
        <input
            type={type}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            onFocus={onFocus}
            className={`w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow ${disabled ? 'bg-gray-100 text-gray-400' : 'bg-white'}`}
        />
    </div>
);

const Select: React.FC<{ label: string; value: string; options: string[]; onChange: (v: string) => void; onFocus?: () => void; onInfoClick?: () => void }> = ({ label, value, options, onChange, onFocus, onInfoClick }) => (
    <div className="w-full">
        <div className="flex items-center justify-between mb-1">
            {label && <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</label>}
            {onInfoClick && (
                <button 
                    onClick={onInfoClick} 
                    title="Highlight in PDF" 
                    className="text-blue-500 hover:text-blue-700 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                </button>
            )}
        </div>
        <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            className="w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
        >
            {options.map(o => <option key={o} value={o}>{o.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim()}</option>)}
        </select>
    </div>
);

const TextArea: React.FC<{ label: string; value: string; onChange: (v: string) => void; onInfoClick?: () => void; onFocus?: () => void }> = ({ label, value, onChange, onInfoClick, onFocus }) => (
    <div className="w-full">
        <div className="flex items-center justify-between mb-1">
            {label && <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">{label}</label>}
            {onInfoClick && (
                <button 
                    onClick={onInfoClick} 
                    title="Highlight in PDF" 
                    className="text-blue-500 hover:text-blue-700 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                </button>
            )}
        </div>
        <textarea
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            className="w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none min-h-[80px]"
        />
    </div>
);

export default App;