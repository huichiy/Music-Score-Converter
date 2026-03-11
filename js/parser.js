function pitchToSemitones(step, alter, octave) {
    const stepMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
    return stepMap[step] + alter + (octave * 12);
}

// --- Shared pitch-conversion constants (single source of truth for all scripts) ---
const scaleDegrees = [0, 2, 4, 5, 7, 9, 11];   // semitone offsets for scale degrees 1–7
const stepMapDiatonic = { 'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6 };

// --- Shared session state (written by app.js, read by downloader.js and theme toggle) ---
const state = {};

function parseXMLToJianpu(xmlDoc) {
    // Find key signature
    let fifths = 0;
    const fifthsNodes = xmlDoc.getElementsByTagName("fifths");
    if (fifthsNodes.length > 0) {
        fifths = parseInt(fifthsNodes[0].textContent);
    }

    // Find time signature
    let beats = "4";
    let beatType = "4";
    const beatsNodes = xmlDoc.getElementsByTagName("beats");
    if (beatsNodes.length > 0) beats = beatsNodes[0].textContent;
    const beatTypeNodes = xmlDoc.getElementsByTagName("beat-type");
    if (beatTypeNodes.length > 0) beatType = beatTypeNodes[0].textContent;

    const keyMap = {
        "-7": "Cb", "-6": "Gb", "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F",
        "0": "C", "1": "G", "2": "D", "3": "A", "4": "E", "5": "B", "6": "F#", "7": "C#"
    };
    const keyStr = keyMap[fifths.toString()] || "C";

    let baseTonicStep = keyStr[0];
    let baseTonicAlter = keyStr.includes('#') ? 1 : (keyStr.includes('b') ? -1 : 0);
    let baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4);

    let jianpuLines = [];

    // Assume single part, get measures
    const measures = xmlDoc.getElementsByTagName("measure");
    let lastNoteWasTieStart = false;

    for (let i = 0; i < measures.length; i++) {
        let measureNotes = [];
        const notes = measures[i].getElementsByTagName("note");

        for (let j = 0; j < notes.length; j++) {
            const note = notes[j];

            // Skip chords/harmony for simple melody line
            if (note.getElementsByTagName("chord").length > 0 || note.getElementsByTagName("grace").length > 0) {
                continue;
            }

            let noteValue = "0"; // Default rest
            let isRest = note.getElementsByTagName("rest").length > 0;

            if (!isRest) {
                const pitchNode = note.getElementsByTagName("pitch")[0];
                if (pitchNode) {
                    const step = pitchNode.getElementsByTagName("step")[0].textContent;
                    let alter = 0;
                    const alterNode = pitchNode.getElementsByTagName("alter")[0];
                    if (alterNode) alter = parseFloat(alterNode.textContent);
                    const octave = parseInt(pitchNode.getElementsByTagName("octave")[0].textContent);

                    let noteSemi = pitchToSemitones(step, alter, octave);

                    let tonicDiatonicAbs = stepMapDiatonic[baseTonicStep] + 4 * 7;
                    let noteDiatonicAbs = stepMapDiatonic[step] + octave * 7;

                    let diatonicDiff = noteDiatonicAbs - tonicDiatonicAbs;
                    let degree = (diatonicDiff % 7);
                    if (degree < 0) degree += 7;

                    let shift = Math.round((noteSemi - (baseTonicSemi + scaleDegrees[degree])) / 12);

                    let intendedSemi = baseTonicSemi + shift * 12 + scaleDegrees[degree];
                    let acc = "";
                    if (noteSemi > intendedSemi) acc = "#";
                    if (noteSemi < intendedSemi) acc = "b";

                    noteValue = acc + (degree + 1).toString();
                    if (shift > 0) noteValue += "'".repeat(shift);
                    if (shift < 0) noteValue += ".".repeat(Math.abs(shift));
                }
            }

            // Handling Duration / Rhythm Type
            let noteType = "quarter";
            const typeNode = note.getElementsByTagName("type")[0];
            if (typeNode) noteType = typeNode.textContent;

            // Handling Dots
            const hasDot = note.getElementsByTagName("dot").length > 0;
            let dotStr = hasDot ? "." : "";

            // Handling Ties
            const tieNodes = note.getElementsByTagName("tie");
            let isTieStop = false;
            let isTieStart = false;
            for (let t = 0; t < tieNodes.length; t++) {
                if (tieNodes[t].getAttribute("type") === "stop") isTieStop = true;
                if (tieNodes[t].getAttribute("type") === "start") isTieStart = true;
            }

            if (lastNoteWasTieStart) {
                isTieStop = true;
            }
            lastNoteWasTieStart = isTieStart && !isRest;

            let noteStr = noteValue;

            if (isTieStop) {
                // If it's a tied continuation, we just print the dashes based on duration but usually just one '-' per beat representation
                if (noteType === "whole") noteStr = "- - - -";
                else if (noteType === "half") noteStr = "- -";
                else if (noteType === "quarter") noteStr = "-";
                else if (noteType === "eighth") noteStr = "-_";
                else if (noteType === "16th") noteStr = "-__";
            } else {
                if (noteType === "whole") {
                    noteStr = noteValue + " - - -" + dotStr;
                } else if (noteType === "half") {
                    noteStr = noteValue + dotStr + " -";
                } else if (noteType === "quarter") {
                    noteStr = noteValue + dotStr;
                } else if (noteType === "eighth") {
                    noteStr = noteValue + dotStr + "_";
                } else if (noteType === "16th") {
                    noteStr = noteValue + dotStr + "__";
                } else if (noteType === "32nd") {
                    noteStr = noteValue + dotStr + "___";
                } else {
                    // Default fallback
                    noteStr = noteValue + dotStr;
                }
            }

            measureNotes.push(noteStr);
        }

        if (measureNotes.length > 0) {
            jianpuLines.push(measureNotes.join(" "));
        }
    }

    if (jianpuLines.length === 0) return "No compatible notes found.";

    let chunks = [];
    // Group 4 measures per line
    for (let i = 0; i < jianpuLines.length; i += 4) {
        chunks.push(jianpuLines.slice(i, i + 4).join(" | "));
    }

    return `Key: 1=${keyStr}   Time: ${beats}/${beatType}\n\n` + chunks.join(" |\n") + " |";
}

function parseXMLToNoteObjects(xmlDoc) {
    let fifths = 0;
    const fifthsNodes = xmlDoc.getElementsByTagName("fifths");
    if (fifthsNodes.length > 0) {
        fifths = parseInt(fifthsNodes[0].textContent);
    }

    const keyMap = {
        "-7": "Cb", "-6": "Gb", "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F",
        "0": "C", "1": "G", "2": "D", "3": "A", "4": "E", "5": "B", "6": "F#", "7": "C#"
    };
    const keyStr = keyMap[fifths.toString()] || "C";

    let baseTonicStep = keyStr[0];
    let baseTonicAlter = keyStr.includes('#') ? 1 : (keyStr.includes('b') ? -1 : 0);
    let baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4);

    let jianpuMeasures = [];

    const measures = xmlDoc.getElementsByTagName("measure");
    let currentDivisions = 1;
    let lastNoteWasTieStart = false;

    for (let i = 0; i < measures.length; i++) {
        let measureNotes = [];
        const notes = measures[i].getElementsByTagName("note");

        // Check divisions inside measure's attributes if present
        const attributesNode = measures[i].getElementsByTagName("attributes")[0];
        if (attributesNode) {
            const divNode = attributesNode.getElementsByTagName("divisions")[0];
            if (divNode) currentDivisions = parseInt(divNode.textContent) || currentDivisions;
        }

        for (let j = 0; j < notes.length; j++) {
            const note = notes[j];

            // Skip chords/harmony for simple melody line
            if (note.getElementsByTagName("chord").length > 0 || note.getElementsByTagName("grace").length > 0) {
                continue;
            }

            const durationNode = note.getElementsByTagName("duration")[0];
            let duration = durationNode ? parseInt(durationNode.textContent) : 0;
            let beatValue = duration / currentDivisions;

            let noteType = "quarter";
            const typeNode = note.getElementsByTagName("type")[0];
            let hasDot = note.getElementsByTagName("dot").length > 0;

            if (typeNode) {
                noteType = typeNode.textContent;
            } else if (durationNode) {
                if (beatValue >= 3.75) noteType = "whole";
                else if (beatValue >= 2.75) { noteType = "half"; hasDot = true; }
                else if (beatValue >= 1.75) noteType = "half";
                else if (beatValue >= 1.25) { noteType = "quarter"; hasDot = true; }
                else if (beatValue >= 0.75) noteType = "quarter";
                else if (beatValue >= 0.6) { noteType = "eighth"; hasDot = true; }
                else if (beatValue >= 0.35) noteType = "eighth";
                else if (beatValue >= 0.15) noteType = "16th";
                else noteType = "32nd";
            }

            // Handling Ties
            const tieNodes = note.getElementsByTagName("tie");
            let isTieStop = false;
            let isTieStart = false;
            for (let t = 0; t < tieNodes.length; t++) {
                if (tieNodes[t].getAttribute("type") === "stop") isTieStop = true;
                if (tieNodes[t].getAttribute("type") === "start") isTieStart = true;
            }

            let isRest = note.getElementsByTagName("rest").length > 0;

            if (lastNoteWasTieStart) {
                isTieStop = true;
            }
            lastNoteWasTieStart = isTieStart && !isRest;

            let noteObj = {
                degree: 0,
                octave: 0,
                type: noteType,
                dot: hasDot,
                tie: isTieStop,
                rest: isRest,
                accidental: ''
            };

            if (!isRest) {
                const pitchNode = note.getElementsByTagName("pitch")[0];
                if (pitchNode) {
                    const step = pitchNode.getElementsByTagName("step")[0].textContent;
                    let alter = 0;
                    const alterNode = pitchNode.getElementsByTagName("alter")[0];
                    if (alterNode) alter = parseFloat(alterNode.textContent);
                    const octave = parseInt(pitchNode.getElementsByTagName("octave")[0].textContent);

                    let noteSemi = pitchToSemitones(step, alter, octave);

                    let tonicDiatonicAbs = stepMapDiatonic[baseTonicStep] + 4 * 7;
                    let noteDiatonicAbs = stepMapDiatonic[step] + octave * 7;

                    let diatonicDiff = noteDiatonicAbs - tonicDiatonicAbs;
                    let degree = (diatonicDiff % 7);
                    if (degree < 0) degree += 7;

                    let shift = Math.round((noteSemi - (baseTonicSemi + scaleDegrees[degree])) / 12);

                    let intendedSemi = baseTonicSemi + shift * 12 + scaleDegrees[degree];
                    let acc = "";
                    if (noteSemi > intendedSemi) acc = "#";
                    if (noteSemi < intendedSemi) acc = "b";

                    noteObj.degree = degree + 1;
                    noteObj.octave = shift;
                    noteObj.accidental = acc;
                }
            }

            measureNotes.push(noteObj);
        }

        if (measureNotes.length > 0) {
            jianpuMeasures.push(measureNotes);
        }
    }

    return jianpuMeasures;
}

function stripRestMeasures(measures) {
    let start = 0;
    while (start < measures.length && measures[start].every(n => n.rest)) start++;
    let end = measures.length - 1;
    while (end >= start && measures[end].every(n => n.rest)) end--;
    return start <= end ? measures.slice(start, end + 1) : [];
}
