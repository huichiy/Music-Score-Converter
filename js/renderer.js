function escapeSVG(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Collapse runs of 2+ consecutive all-rest measures into a single { _multiRest: N } marker.
function collapseRestRuns(measures) {
    const out = [];
    let i = 0;
    while (i < measures.length) {
        const allRest = Array.isArray(measures[i]) && measures[i].length > 0
            && measures[i].every(n => n.rest);
        if (allRest) {
            let run = 1;
            while (i + run < measures.length
                && Array.isArray(measures[i + run])
                && measures[i + run].length > 0
                && measures[i + run].every(n => n.rest)) {
                run++;
            }
            if (run >= 2) {
                out.push({ _multiRest: run });
            } else {
                out.push(measures[i]); // single rest measure — keep normal
            }
            i += run;
        } else {
            out.push(measures[i]);
            i++;
        }
    }
    return out;
}

function renderJianpuSVG(measures, keyStr, timeStr, titleStr = "Untitled", containerWidth = 540, tempoStr = "") {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const svgColor = isDark ? '#FFFFFF' : '#0A0A0A';
    const widthMap = {
        "whole": 160,
        "half": 80,
        "quarter": 40,
        "eighth": 30,
        "16th": 16,
        "32nd": 14
    };

    // Used to render whole-measure rests as repeated 0s (one per beat)
    const beatsPerMeasure = parseInt(timeStr.split('/')[0]) || 4;

    // Beat-boundary beaming: note duration in quarter-note units
    const durationBeats = {
        "whole": 4, "half": 2, "quarter": 1,
        "eighth": 0.5, "16th": 0.25, "32nd": 0.125
    };
    const beatUnit = 4 / (parseInt(timeStr.split('/')[1]) || 4);

    const maxWidth = Math.max(300, containerWidth - 40);
    const lineHeight = 80;
    const paddingTop = tempoStr ? 100 : 80;
    const startX = 20;

    let currentX = startX;
    let currentY = paddingTop + 20; // baseline for first row
    let svgElements = [];
    let maxTotalWidth = startX;

    // Draw header
    svgElements.push(`<text x="${maxWidth / 2}" y="35" font-family="Inter" font-size="24" font-weight="600" fill="${svgColor}" text-anchor="middle">${escapeSVG(titleStr)}</text>`);
    svgElements.push(`<text x="${startX}" y="65" font-family="Inter" font-size="14" font-weight="500" fill="${svgColor}">Key: 1=${keyStr}   Time: ${timeStr}</text>`);
    if (tempoStr) {
        svgElements.push(`<text x="${startX}" y="82" font-family="Inter" font-size="13" fill="${svgColor}">\u2669 = ${tempoStr}</text>`);
    }

    // Draw opening barline
    svgElements.push(`<line x1="${startX}" y1="${currentY - 15}" x2="${startX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);

    const getLines = (type) => {
        if (type === "eighth") return 1;
        if (type === "16th") return 2;
        if (type === "32nd") return 3;
        return 0;
    };

    measures = collapseRestRuns(measures);

    let actualMeasureNum = 1;

    for (let i = 0; i < measures.length; i++) {
        const measure = measures[i];

        // --- Multi-measure rest block ---
        if (measure._multiRest) {
            const N = measure._multiRest;
            const blockW = Math.min(160, maxWidth * 0.4); // cap width so it fits a line

            if (currentX + blockW > maxWidth && currentX > startX) {
                currentX = startX;
                currentY += lineHeight;
            }

            // Measure number label
            if (currentX === startX) {
                svgElements.push(`<text x="${currentX}" y="${currentY - 30}" font-family="Inter" font-size="10" font-style="italic" fill="${svgColor}">${actualMeasureNum}</text>`);
                svgElements.push(`<line x1="${currentX}" y1="${currentY - 15}" x2="${currentX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
            }

            const lineY = currentY - 8;  // sit at note mid-height
            const lx1 = currentX + 4;
            const lx2 = currentX + blockW - 4;
            const midX = (lx1 + lx2) / 2;

            // Thick horizontal bracket body
            svgElements.push(`<line x1="${lx1}" y1="${lineY}" x2="${lx2}" y2="${lineY}" stroke="${svgColor}" stroke-width="3"/>`);
            // Left cap
            svgElements.push(`<line x1="${lx1}" y1="${lineY - 5}" x2="${lx1}" y2="${lineY + 5}" stroke="${svgColor}" stroke-width="2"/>`);
            // Right cap
            svgElements.push(`<line x1="${lx2}" y1="${lineY - 5}" x2="${lx2}" y2="${lineY + 5}" stroke="${svgColor}" stroke-width="2"/>`);
            // Count label centred above the bracket
            svgElements.push(`<text x="${midX}" y="${lineY - 7}" font-family="Inter" font-size="12" font-weight="600" fill="${svgColor}" text-anchor="middle">${N}</text>`);

            currentX += blockW;

            // Closing barline
            if (i === measures.length - 1) {
                svgElements.push(`<line x1="${currentX}" y1="${currentY - 15}" x2="${currentX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
                svgElements.push(`<line x1="${currentX + 4}" y1="${currentY - 15}" x2="${currentX + 4}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="3"/>`);
                if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4;
            } else {
                svgElements.push(`<line x1="${currentX}" y1="${currentY - 15}" x2="${currentX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
            }
            if (currentX > maxTotalWidth) maxTotalWidth = currentX;

            actualMeasureNum += N;
            continue;
        }

        // --- Normal measure ---
        let measureWidth = 0;

        // Pre-calculate measure width (base note width + 6px extra per accidental)
        for (let note of measure) {
            measureWidth += (widthMap[note.type] || 40) * (note.dot ? 1.5 : 1) + (note.accidental ? 6 : 0);
        }

        // Wrap to next line if measure exceeds remaining width
        if (currentX + measureWidth > maxWidth && currentX > startX) {
            currentX = startX;
            currentY += lineHeight;
        }

        // Draw starting bar line for first measure on a line
        if (currentX === startX) {
            // Add measure number
            svgElements.push(`<text x="${currentX}" y="${currentY - 30}" font-family="Inter" font-size="10" font-style="italic" fill="${svgColor}">${actualMeasureNum}</text>`);
            svgElements.push(`<line x1="${currentX}" y1="${currentY - 15}" x2="${currentX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
        }

        // --- Whole-measure rest: render one 0 per beat, evenly spaced ---
        const isWholeMeasureRest = measure.every(n => n.rest);
        if (isWholeMeasureRest) {
            const wmWidth = widthMap["whole"];  // fixed 160px budget
            const step = wmWidth / beatsPerMeasure;
            for (let b = 0; b < beatsPerMeasure; b++) {
                svgElements.push(`<text x="${currentX + b * step + 2}" y="${currentY}" font-family="Inter" font-size="18" fill="${svgColor}">0</text>`);
            }
            currentX += wmWidth;

            // Closing barline
            if (i === measures.length - 1) {
                svgElements.push(`<line x1="${currentX}" y1="${currentY - 15}" x2="${currentX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
                svgElements.push(`<line x1="${currentX + 4}" y1="${currentY - 15}" x2="${currentX + 4}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="3"/>`);
                if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4;
            } else {
                svgElements.push(`<line x1="${currentX}" y1="${currentY - 15}" x2="${currentX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
            }
            if (currentX > maxTotalWidth) maxTotalWidth = currentX;
            actualMeasureNum++;
            continue;
        }

        // Pre-compute cumulative beat position of each note for beat-boundary beaming
        let cumulative = [];
        {
            let acc = 0;
            for (let note of measure) {
                cumulative.push(acc);
                acc += (durationBeats[note.type] || 1) * (note.dot ? 1.5 : 1);
            }
        }

        for (let j = 0; j < measure.length; j++) {
            const note = measure[j];
            let noteWidth = (widthMap[note.type] || 40) * (note.dot ? 1.5 : 1);

            let displayStr = note.rest ? "0" : note.degree.toString();
            if (note.tie) displayStr = "-"; // Basic tie representation for simple render

            let numXOffset = 2;
            // Draw accidental if present and not a rest
            if (!note.rest && note.accidental) {
                svgElements.push(`<text x="${currentX}" y="${currentY - 8}" font-family="Inter" font-size="10" fill="${svgColor}">${note.accidental}</text>`);
                numXOffset = 8;
            }

            // Draw the main number
            svgElements.push(`<text x="${currentX + numXOffset}" y="${currentY}" font-family="Inter" font-size="18" fill="${svgColor}">${displayStr}</text>`);

            // Draw extension dashes/zeroes for long notes
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

            // Dotted note (only for notes smaller than a half note)
            if (note.dot && extraBeats === 0) {
                let charWidth = 18 * 0.6; // approx width for font-size 18
                svgElements.push(`<circle cx="${currentX + numXOffset + charWidth + 3}" cy="${currentY - 4}" r="1.5" fill="${svgColor}"/>`);
            }

            // Octave dots (above)
            const cx = currentX + numXOffset + 5.5; // roughly centered above the number
            if (!note.rest && !note.tie) {
                if (note.octave === 1) {
                    svgElements.push(`<circle cx="${cx}" cy="${currentY - 18}" r="1.5" fill="${svgColor}"/>`);
                } else if (note.octave === 2) {
                    svgElements.push(`<circle cx="${cx}" cy="${currentY - 18}" r="1.5" fill="${svgColor}"/>`);
                    svgElements.push(`<circle cx="${cx}" cy="${currentY - 24}" r="1.5" fill="${svgColor}"/>`);
                }
            }

            // Rhythm Underlines (Beaming) — only beam within the same beat group
            let linesCnt = getLines(note.type);
            for (let l = 1; l <= linesCnt; l++) {
                const noteBeat = Math.floor(cumulative[j] / beatUnit);
                const prevBeat = j > 0 ? Math.floor(cumulative[j - 1] / beatUnit) : -1;
                const nextBeat = j < measure.length - 1 ? Math.floor(cumulative[j + 1] / beatUnit) : -1;

                let connectLeft = (j > 0 && getLines(measure[j - 1].type) >= l && prevBeat === noteBeat);
                let connectRight = (j < measure.length - 1 && getLines(measure[j + 1].type) >= l && nextBeat === noteBeat);

                let x1 = connectLeft ? currentX : currentX + 2;
                let x2 = connectRight ? currentX + noteWidth : currentX + noteWidth - 2;

                svgElements.push(`<line x1="${x1}" y1="${currentY + l * 4}" x2="${x2}" y2="${currentY + l * 4}" stroke="${svgColor}" stroke-width="1"/>`);
            }

            // Octave dots (below) — fixed baseline so dots are consistent regardless of beaming
            if (!note.rest && !note.tie) {
                if (note.octave === -1) {
                    const dotY = currentY + 10;
                    svgElements.push(`<circle cx="${cx}" cy="${dotY}" r="1.5" fill="${svgColor}"/>`);
                } else if (note.octave === -2) {
                    const dotY = currentY + 10;
                    svgElements.push(`<circle cx="${cx}" cy="${dotY}" r="1.5" fill="${svgColor}"/>`);
                    svgElements.push(`<circle cx="${cx}" cy="${dotY + 6}" r="1.5" fill="${svgColor}"/>`);
                }
            }

            currentX += noteWidth;
        }

        // Draw ending bar line for the measure
        if (i === measures.length - 1) {
            // Double bar line at the end
            svgElements.push(`<line x1="${currentX}" y1="${currentY - 15}" x2="${currentX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
            svgElements.push(`<line x1="${currentX + 4}" y1="${currentY - 15}" x2="${currentX + 4}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="3"/>`);
            if (currentX + 4 > maxTotalWidth) maxTotalWidth = currentX + 4;
        } else {
            svgElements.push(`<line x1="${currentX}" y1="${currentY - 15}" x2="${currentX}" y2="${currentY + 5}" stroke="${svgColor}" stroke-width="1"/>`);
        }

        if (currentX > maxTotalWidth) maxTotalWidth = currentX;

        actualMeasureNum++;
    }

    const totalHeight = currentY + 20;
    const finalWidth = Math.max(maxWidth, maxTotalWidth + 20);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${finalWidth}" height="${totalHeight}" viewBox="0 0 ${finalWidth} ${totalHeight}">
        ${svgElements.join('\n')}
    </svg>`;
}
