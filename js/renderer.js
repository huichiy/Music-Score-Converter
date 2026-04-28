// --- Render Configuration ---
const RENDER_CONFIG = {
    noteWidths: {
        "whole": 160, "half": 80, "quarter": 40,
        "eighth": 30, "16th": 16, "32nd": 14
    },
    durationBeats: {
        "whole": 4, "half": 2, "quarter": 1,
        "eighth": 0.5, "16th": 0.25, "32nd": 0.125
    },
    lineHeight: 80,
    paddingTopWithTempo: 100,
    paddingTopDefault: 80,
    startX: 20,
    fontSize: 18,
    minWidth: 300,
    padding: 40,
    repeatSignWidth: 12,
    multiRestMaxWidth: 160
};

function escapeSVG(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Collapse runs of 2+ consecutive all-rest measures into a single { _multiRest: N } marker.
function collapseRestRuns(measures) {
    const out = [];
    let i = 0;
    while (i < measures.length) {
        const allRest = Array.isArray(measures[i])
            && measures[i].length === 1
            && measures[i][0].rest
            && measures[i][0].type === "whole";
        if (allRest) {
            let run = 1;
            while (i + run < measures.length
                && Array.isArray(measures[i + run])
                && measures[i + run].length === 1
                && measures[i + run][0].rest
                && measures[i + run][0].type === "whole") {
                run++;
            }
            if (run >= 2) {
                out.push({ _multiRest: run });
            } else {
                out.push(measures[i]);
            }
            i += run;
        } else {
            out.push(measures[i]);
            i++;
        }
    }
    return out;
}

function getBeamingLines(type) {
    if (type === "eighth") return 1;
    if (type === "16th") return 2;
    if (type === "32nd") return 3;
    return 0;
}

// --- Sub-render functions ---

function renderHeader(svgElements, maxWidth, startX, svgColor, titleStr, keyStr, timeStr, tempoStr) {
    svgElements.push(`<text x="${maxWidth / 2}" y="35" font-family="Inter" font-size="24" font-weight="600" fill="${svgColor}" text-anchor="middle">${escapeSVG(titleStr)}</text>`);
    svgElements.push(`<text x="${startX}" y="65" font-family="Inter" font-size="14" font-weight="500" fill="${svgColor}">Key: 1=${keyStr}   Time: ${timeStr}</text>`);
    if (tempoStr) {
        svgElements.push(`<text x="${startX}" y="82" font-family="Inter" font-size="13" fill="${svgColor}">Tempo: ${tempoStr}</text>`);
    }
}

function renderBarline(svgElements, x, currentY, svgColor, isFinal) {
    svgElements.push(`<line x1="${x}" y1="${currentY - 15}" x2="${x}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
    if (isFinal) {
        svgElements.push(`<line x1="${x + 4}" y1="${currentY - 15}" x2="${x + 4}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="3"/>`);
    }
}

function renderRepeatStart(svgElements, x, currentY, svgColor) {
    svgElements.push(`<line x1="${x}" y1="${currentY - 15}" x2="${x}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="3"/>`);
    svgElements.push(`<line x1="${x + 4}" y1="${currentY - 15}" x2="${x + 4}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
    svgElements.push(`<circle cx="${x + 8}" cy="${currentY - 7}" r="2" fill="${svgColor}"/>`);
    svgElements.push(`<circle cx="${x + 8}" cy="${currentY - 1}" r="2" fill="${svgColor}"/>`);
}

function renderRepeatEnd(svgElements, x, currentY, svgColor) {
    svgElements.push(`<circle cx="${x - 8}" cy="${currentY - 7}" r="2" fill="${svgColor}"/>`);
    svgElements.push(`<circle cx="${x - 8}" cy="${currentY - 1}" r="2" fill="${svgColor}"/>`);
    svgElements.push(`<line x1="${x - 4}" y1="${currentY - 15}" x2="${x - 4}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
    svgElements.push(`<line x1="${x}" y1="${currentY - 15}" x2="${x}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="3"/>`);
}

function renderOctaveDots(svgElements, cx, currentY, octave, svgColor) {
    if (octave === 1) {
        svgElements.push(`<circle cx="${cx}" cy="${currentY - 18}" r="1.5" fill="${svgColor}"/>`);
    } else if (octave === 2) {
        svgElements.push(`<circle cx="${cx}" cy="${currentY - 18}" r="1.5" fill="${svgColor}"/>`);
        svgElements.push(`<circle cx="${cx}" cy="${currentY - 24}" r="1.5" fill="${svgColor}"/>`);
    } else if (octave === -1) {
        svgElements.push(`<circle cx="${cx}" cy="${currentY + 10}" r="1.5" fill="${svgColor}"/>`);
    } else if (octave === -2) {
        svgElements.push(`<circle cx="${cx}" cy="${currentY + 10}" r="1.5" fill="${svgColor}"/>`);
        svgElements.push(`<circle cx="${cx}" cy="${currentY + 16}" r="1.5" fill="${svgColor}"/>`);
    }
}

function renderBeamingUnderlines(svgElements, measure, j, currentX, noteWidth, currentY, cumulative, beatUnit, svgColor) {
    const linesCnt = getBeamingLines(measure[j].type);
    for (let l = 1; l <= linesCnt; l++) {
        const noteBeat = Math.floor(cumulative[j] / beatUnit);
        const prevBeat = j > 0 ? Math.floor(cumulative[j - 1] / beatUnit) : -1;
        const nextBeat = j < measure.length - 1 ? Math.floor(cumulative[j + 1] / beatUnit) : -1;

        let connectLeft = (j > 0 && getBeamingLines(measure[j - 1].type) >= l && prevBeat === noteBeat);
        let connectRight = (j < measure.length - 1 && getBeamingLines(measure[j + 1].type) >= l && nextBeat === noteBeat);

        let x1 = connectLeft ? currentX : currentX + 2;
        let x2 = connectRight ? currentX + noteWidth : currentX + noteWidth - 2;

        svgElements.push(`<line x1="${x1}" y1="${currentY + l * 4}" x2="${x2}" y2="${currentY + l * 4}" stroke="${svgColor}" stroke-width="1"/>`);
    }
}

function renderExtensionDashes(svgElements, note, currentX, numXOffset, noteWidth, currentY, svgColor) {
    let extraBeats = 0;
    if (note.type === "whole") extraBeats = 3;
    else if (note.type === "half") {
        extraBeats = note.dot ? 2 : 1;
    }

    if (extraBeats > 0) {
        const dashStep = (noteWidth - numXOffset) / (extraBeats + 1);
        for (let b = 1; b <= extraBeats; b++) {
            let extChar = note.rest ? "0" : "-";
            svgElements.push(`<text x="${currentX + numXOffset + b * dashStep}" y="${currentY}" font-family="Inter" font-size="18" fill="${svgColor}">${extChar}</text>`);
        }
    }
    return extraBeats;
}

function renderMultiRestBracket(svgElements, currentX, currentY, N, maxWidth, svgColor) {
    const blockW = Math.min(RENDER_CONFIG.multiRestMaxWidth, maxWidth * 0.4);
    const lineY = currentY - 8;
    const lx1 = currentX + 4;
    const lx2 = currentX + blockW - 4;
    const midX = (lx1 + lx2) / 2;

    svgElements.push(`<line x1="${lx1}" y1="${lineY}" x2="${lx2}" y2="${lineY}" stroke="${svgColor}" stroke-width="3"/>`);
    svgElements.push(`<line x1="${lx1}" y1="${lineY - 5}" x2="${lx1}" y2="${lineY + 5}" stroke="${svgColor}" stroke-width="2"/>`);
    svgElements.push(`<line x1="${lx2}" y1="${lineY - 5}" x2="${lx2}" y2="${lineY + 5}" stroke="${svgColor}" stroke-width="2"/>`);
    svgElements.push(`<text x="${midX}" y="${lineY - 7}" font-family="Inter" font-size="12" font-weight="600" fill="${svgColor}" text-anchor="middle">${N}</text>`);

    return blockW;
}

function renderNote(svgElements, note, currentX, currentY, svgColor) {
    let displayStr = note.rest ? "0" : note.degree.toString();
    if (note.tie) displayStr = "-";

    let numXOffset = 2;
    if (!note.rest && !note.tie && note.accidental) {
        svgElements.push(`<text x="${currentX}" y="${currentY - 8}" font-family="Inter" font-size="10" fill="${svgColor}">${note.accidental}</text>`);
        numXOffset = 8;
    }

    svgElements.push(`<text x="${currentX + numXOffset}" y="${currentY}" font-family="Inter" font-size="18" fill="${svgColor}">${displayStr}</text>`);

    // Chord notes stacked below main note
    if (note.chordNotes && note.chordNotes.length > 0) {
        note.chordNotes.forEach((cn, idx) => {
            const chordY = currentY + (idx + 1) * 16;
            let chordXOffset = 2;
            if (cn.accidental) {
                svgElements.push(`<text x="${currentX}" y="${chordY - 6}" font-family="Inter" font-size="9" fill="${svgColor}">${cn.accidental}</text>`);
                chordXOffset = 7;
            }
            svgElements.push(`<text x="${currentX + chordXOffset}" y="${chordY}" font-family="Inter" font-size="16" fill="${svgColor}">${cn.degree}</text>`);
            // Octave dots for chord notes
            const dotCx = currentX + chordXOffset + 5;
            if (cn.octave >= 1) svgElements.push(`<circle cx="${dotCx}" cy="${chordY - 16}" r="1.5" fill="${svgColor}"/>`);
            if (cn.octave >= 2) svgElements.push(`<circle cx="${dotCx}" cy="${chordY - 22}" r="1.5" fill="${svgColor}"/>`);
            if (cn.octave <= -1) svgElements.push(`<circle cx="${dotCx}" cy="${chordY + 8}" r="1.5" fill="${svgColor}"/>`);
            if (cn.octave <= -2) svgElements.push(`<circle cx="${dotCx}" cy="${chordY + 14}" r="1.5" fill="${svgColor}"/>`);
        });
    }

    return numXOffset;
}

// --- Main render function ---

function renderJianpuSVG(measures, keyStr, timeStr, titleStr = "Untitled", containerWidth = 540, tempoStr = "") {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const svgColor = isDark ? '#FFFFFF' : '#0A0A0A';
    const { noteWidths, durationBeats, lineHeight, startX } = RENDER_CONFIG;

    const beatsPerMeasure = parseInt(timeStr.split('/')[0]) || 4;
    const beatUnit = 4 / (parseInt(timeStr.split('/')[1]) || 4);
    const maxWidth = Math.max(RENDER_CONFIG.minWidth, containerWidth - RENDER_CONFIG.padding);
    const paddingTop = tempoStr ? RENDER_CONFIG.paddingTopWithTempo : RENDER_CONFIG.paddingTopDefault;

    let currentX = startX;
    let currentY = paddingTop + 20;
    let svgElements = [];
    let maxTotalWidth = startX;

    let slurStartX = null;
    let slurStartY = null;

    renderHeader(svgElements, maxWidth, startX, svgColor, titleStr, keyStr, timeStr, tempoStr);

    // Opening barline
    renderBarline(svgElements, startX, currentY, svgColor, false);

    measures = collapseRestRuns(measures);

    let actualMeasureNum = 1;

    for (let i = 0; i < measures.length; i++) {
        const measure = measures[i];

        // --- Multi-measure rest block ---
        if (measure._multiRest) {
            const N = measure._multiRest;
            const blockW = Math.min(RENDER_CONFIG.multiRestMaxWidth, maxWidth * 0.4);

            if (currentX + blockW > maxWidth && currentX > startX) {
                currentX = startX;
                currentY += lineHeight;
            }

            if (currentX === startX) {
                svgElements.push(`<text x="${currentX}" y="${currentY - 30}" font-family="Inter" font-size="10" font-style="italic" fill="${svgColor}">${actualMeasureNum}</text>`);
                renderBarline(svgElements, currentX, currentY, svgColor, false);
            }

            currentX += renderMultiRestBracket(svgElements, currentX, currentY, N, maxWidth, svgColor);

            if (i === measures.length - 1) {
                renderBarline(svgElements, currentX, currentY, svgColor, true);
                if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4;
            } else {
                renderBarline(svgElements, currentX, currentY, svgColor, false);
            }
            if (currentX > maxTotalWidth) maxTotalWidth = currentX;

            actualMeasureNum += N;
            continue;
        }

        // --- Normal measure ---
        let measureWidth = 0;
        for (let note of measure) {
            measureWidth += (noteWidths[note.type] || 40) * (note.dot ? 1.5 : 1) + (!note.tie && note.accidental ? 6 : 0);
        }

        // Wrap to next line
        if (currentX + measureWidth > maxWidth && currentX > startX) {
            if (slurStartX !== null) {
                const midX = (slurStartX + currentX) / 2;
                const arcY = slurStartY - 30;
                svgElements.push(`<path d="M ${slurStartX},${arcY} Q ${midX},${arcY - 12} ${currentX},${arcY}" fill="none" stroke="${svgColor}" stroke-width="1.2"/>`);
            }
            currentX = startX;
            currentY += lineHeight;
            if (slurStartX !== null) {
                slurStartX = startX;
                slurStartY = currentY;
            }
        }

        // Starting barline + measure number for first measure on a line
        if (currentX === startX) {
            svgElements.push(`<text x="${currentX}" y="${currentY - 30}" font-family="Inter" font-size="10" font-style="italic" fill="${svgColor}">${actualMeasureNum}</text>`);
            renderBarline(svgElements, currentX, currentY, svgColor, false);
        }

        const measureStartX = currentX;

        // Repeat start sign
        if (measure._repeatStart) {
            renderRepeatStart(svgElements, currentX, currentY, svgColor);
            currentX += RENDER_CONFIG.repeatSignWidth;
        }

        // --- Whole-measure rest ---
        const isWholeMeasureRest = measure.length === 1 && measure[0].rest && measure[0].type === "whole";
        if (isWholeMeasureRest) {
            const wmWidth = noteWidths["whole"];
            const step = wmWidth / beatsPerMeasure;
            for (let b = 0; b < beatsPerMeasure; b++) {
                svgElements.push(`<text x="${currentX + b * step + 2}" y="${currentY}" font-family="Inter" font-size="18" fill="${svgColor}">0</text>`);
            }
            currentX += wmWidth;

            if (i === measures.length - 1) {
                renderBarline(svgElements, currentX, currentY, svgColor, true);
                if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4;
            } else {
                renderBarline(svgElements, currentX, currentY, svgColor, false);
            }
            if (currentX > maxTotalWidth) maxTotalWidth = currentX;
            actualMeasureNum++;
            continue;
        }

        // Pre-compute cumulative beat positions for beat-boundary beaming
        let cumulative = [];
        {
            let acc = 0;
            for (let note of measure) {
                cumulative.push(acc);
                acc += (durationBeats[note.type] || 1) * (note.dot ? 1.5 : 1);
            }
        }

        // Render each note in the measure
        for (let j = 0; j < measure.length; j++) {
            const note = measure[j];
            let noteWidth = (noteWidths[note.type] || 40) * (note.dot ? 1.5 : 1);

            if (note.slurStart && !note.rest) {
                slurStartX = currentX + 2;
                slurStartY = currentY;
            }

            const numXOffset = renderNote(svgElements, note, currentX, currentY, svgColor);

            // Extension dashes for long notes
            renderExtensionDashes(svgElements, note, currentX, numXOffset, noteWidth, currentY, svgColor);

            // Dotted note visual dot (only for notes smaller than half)
            let extraBeats = 0;
            if (note.type === "whole") extraBeats = 3;
            else if (note.type === "half") extraBeats = note.dot ? 2 : 1;

            if (note.dot && extraBeats === 0) {
                let charWidth = 18 * 0.6;
                svgElements.push(`<circle cx="${currentX + numXOffset + charWidth + 3}" cy="${currentY - 4}" r="1.5" fill="${svgColor}"/>`);
            }

            // Octave dots (above)
            const cx = currentX + numXOffset + 5.5;
            if (!note.rest && !note.tie) {
                renderOctaveDots(svgElements, cx, currentY, note.octave, svgColor);
            }

            // Beaming underlines
            renderBeamingUnderlines(svgElements, measure, j, currentX, noteWidth, currentY, cumulative, beatUnit, svgColor);

            // Octave dots (below) — rendered after beaming so they sit below underlines
            // (already handled by renderOctaveDots for negative octaves)

            currentX += noteWidth;

            // Slur curve end
            if (note.slurStop && !note.rest && slurStartX !== null) {
                const slurEndX = currentX - noteWidth + numXOffset + 12;
                const arcY = currentY - 30;
                const midX = (slurStartX + slurEndX) / 2;
                svgElements.push(`<path d="M ${slurStartX},${arcY} Q ${midX},${arcY - 12} ${slurEndX},${arcY}" fill="none" stroke="${svgColor}" stroke-width="1.2"/>`);
                slurStartX = null;
                slurStartY = null;
            }
        }

        // Closing barline
        if (i === measures.length - 1 && !measure._repeatEnd) {
            renderBarline(svgElements, currentX, currentY, svgColor, true);
            if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4;
        } else if (!measure._repeatEnd) {
            renderBarline(svgElements, currentX, currentY, svgColor, false);
        }

        // Repeat end sign
        if (measure._repeatEnd) {
            renderRepeatEnd(svgElements, currentX, currentY, svgColor);
        }

        if (currentX > maxTotalWidth) maxTotalWidth = currentX;

        // Direction marking (D.C. / D.S. / Fine)
        if (measure._direction) {
            svgElements.push(`<text x="${currentX - 4}" y="${currentY - 20}" font-family="Inter" font-size="11" font-style="italic" font-weight="500" fill="${svgColor}" text-anchor="end">${escapeSVG(measure._direction)}</text>`);
        }

        // Dynamic marking
        if (measure._dynamic) {
            svgElements.push(`<text x="${measureStartX + 2}" y="${currentY + 22}" font-family="Inter" font-size="12" font-style="italic" font-weight="600" fill="${svgColor}">${escapeSVG(measure._dynamic)}</text>`);
        }

        // Hairpin dynamics (crescendo / diminuendo)
        if (measure._wedge) {
            const hairpinY  = currentY + 30;
            const hairpinH  = 5;
            const mStartX   = measureStartX + 4;
            const mEndX     = currentX - 4;
            if (measure._wedge === 'cresc') {
                svgElements.push(`<line x1="${mStartX}" y1="${hairpinY}" x2="${mEndX}" y2="${hairpinY - hairpinH}" stroke="${svgColor}" stroke-width="1" opacity="0.7"/>`);
                svgElements.push(`<line x1="${mStartX}" y1="${hairpinY}" x2="${mEndX}" y2="${hairpinY + hairpinH}" stroke="${svgColor}" stroke-width="1" opacity="0.7"/>`);
            } else {
                svgElements.push(`<line x1="${mStartX}" y1="${hairpinY - hairpinH}" x2="${mEndX}" y2="${hairpinY}" stroke="${svgColor}" stroke-width="1" opacity="0.7"/>`);
                svgElements.push(`<line x1="${mStartX}" y1="${hairpinY + hairpinH}" x2="${mEndX}" y2="${hairpinY}" stroke="${svgColor}" stroke-width="1" opacity="0.7"/>`);
            }
        }

        actualMeasureNum++;
    }

    const totalHeight = currentY + 40;
    const finalWidth = Math.max(maxWidth, maxTotalWidth + 20);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${finalWidth}" height="${totalHeight}" viewBox="0 0 ${finalWidth} ${totalHeight}">
        ${svgElements.join('\n')}
    </svg>`;
}
