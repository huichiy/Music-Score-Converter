// --- DOM Refs ---
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const htmlDoc = document.documentElement;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const convertBtn = document.getElementById('convertBtn');
const output = document.getElementById('output');
const controlsRow = document.getElementById('controlsRow');
const partSelector = document.getElementById('partSelector');
const partSelectorContainer = document.getElementById('partSelectorContainer');
const autoDetectLabel = document.getElementById('autoDetectLabel');
const errorMsg = document.getElementById('errorMsg');

let currentFile = null;
let parsedXmlDoc = null;

// --- Theme Toggle ---
const moonPath = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
const sunPath = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';

function updateIcon(theme) {
    themeIcon.innerHTML = theme === 'dark' ? sunPath : moonPath;
}

updateIcon('dark');

themeToggle.addEventListener('click', () => {
    const currentTheme = htmlDoc.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    htmlDoc.setAttribute('data-theme', newTheme);
    updateIcon(newTheme);
    if (output.style.display !== 'none') {
        if (parsedXmlDoc) renderSelectedPart();
        else if (state.lastMidiRender) {
            const r = state.lastMidiRender;
            output.innerHTML = renderJianpuSVG(r.measures, r.keyStr, r.timeStr, r.titleStr, output.clientWidth);
        }
    }
});

// --- App Handlers ---
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
    convertBtn.textContent = 'Convert to Jianpu';
    convertBtn.disabled = false;
}

function handleFile(file) {
    if (!file) return;
    currentFile = file;
    fileNameDisplay.textContent = file.name;
    fileNameDisplay.style.color = "var(--text)";
    convertBtn.disabled = false;
    output.style.display = 'none';
    controlsRow.style.display = 'none';
    partSelectorContainer.style.display = '';
    autoDetectLabel.style.display = 'none';
    errorMsg.style.display = 'none';
    parsedXmlDoc = null;
    state.lastMidiRender = null;
}

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
});

function renderSelectedPart() {
    if (!parsedXmlDoc) return;

    const selectedIdx = parseInt(partSelector.value);
    const partsList = parsedXmlDoc.getElementsByTagName("part");
    if (partsList.length <= selectedIdx) return;

    const dummyDoc = document.implementation.createDocument(null, "score-partwise");
    dummyDoc.documentElement.appendChild(parsedXmlDoc.getElementsByTagName("part-list")[0].cloneNode(true));
    dummyDoc.documentElement.appendChild(partsList[selectedIdx].cloneNode(true));

    // Extract title
    let titleStr = "Untitled";
    const movementTitleNodes = parsedXmlDoc.getElementsByTagName("movement-title");
    const workTitleNodes = parsedXmlDoc.getElementsByTagName("work-title");

    if (movementTitleNodes.length > 0) titleStr = movementTitleNodes[0].textContent;
    else if (workTitleNodes.length > 0) titleStr = workTitleNodes[0].textContent;

    if (titleStr === "Untitled" && currentFile) {
        titleStr = currentFile.name.replace(/\.[^/.]+$/, "");
    }

    // Extract time and key for SVG parameters — read from the selected part's dummyDoc
    // so that parts with different attributes (e.g. transposing instruments) are handled correctly.
    // Fall back to the global document if the part doesn't declare its own attributes.
    let beats = "4"; let beatType = "4";
    const beatsNodes = dummyDoc.getElementsByTagName("beats");
    if (beatsNodes.length > 0) beats = beatsNodes[0].textContent;
    else {
        const fallbackBeats = parsedXmlDoc.getElementsByTagName("beats");
        if (fallbackBeats.length > 0) beats = fallbackBeats[0].textContent;
    }
    const beatTypeNodes = dummyDoc.getElementsByTagName("beat-type");
    if (beatTypeNodes.length > 0) beatType = beatTypeNodes[0].textContent;
    else {
        const fallbackBeatType = parsedXmlDoc.getElementsByTagName("beat-type");
        if (fallbackBeatType.length > 0) beatType = fallbackBeatType[0].textContent;
    }

    let fifths = 0;
    const fifthsNodes = dummyDoc.getElementsByTagName("fifths");
    if (fifthsNodes.length > 0) fifths = parseInt(fifthsNodes[0].textContent);
    else {
        const fallbackFifths = parsedXmlDoc.getElementsByTagName("fifths");
        if (fallbackFifths.length > 0) fifths = parseInt(fallbackFifths[0].textContent);
    }
    const keyMap = { "-7": "Cb", "-6": "Gb", "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F", "0": "C", "1": "G", "2": "D", "3": "A", "4": "E", "5": "B", "6": "F#", "7": "C#" };
    const keyStr = keyMap[fifths.toString()] || "C";

    const result = parseXMLToJianpu(dummyDoc);
    state.jianpuText = result;

    let svgMeasures = parseXMLToNoteObjects(dummyDoc);
    svgMeasures = stripRestMeasures(svgMeasures);
    const svgResult = renderJianpuSVG(svgMeasures, keyStr, `${beats}/${beatType}`, titleStr, output.clientWidth);

    output.innerHTML = svgResult;
    output.style.display = 'block';
    controlsRow.style.display = 'flex';
}

partSelector.addEventListener('change', () => {
    autoDetectLabel.style.display = 'none';
    renderSelectedPart();
});

convertBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    // Guard against browser hang on very large files
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
    if (currentFile.size > MAX_FILE_SIZE) {
        showError('File is too large (max 20 MB). Please use a smaller file.');
        return;
    }

    convertBtn.textContent = 'Converting...';
    convertBtn.disabled = true;
    errorMsg.style.display = 'none';

    try {
        if (currentFile.name.toLowerCase().endsWith('.mid') || currentFile.name.toLowerCase().endsWith('.midi')) {
            const arrayBuffer = await currentFile.arrayBuffer();
            const midi = new Midi(arrayBuffer);

            // Key detection
            let keyStr = "C";
            if (midi.header.keySignatures && midi.header.keySignatures.length > 0) {
                keyStr = midi.header.keySignatures[0].key;
            }

            let baseTonicStep = keyStr[0];
            let baseTonicAlter = keyStr.includes('#') ? 1 : (keyStr.includes('b') ? -1 : 0);
            let baseTonicSemi = pitchToSemitones(baseTonicStep, baseTonicAlter, 4);


            // Find track with most notes
            let bestTrack = null;
            let maxNotes = -1;
            for (let track of midi.tracks) {
                if (track.notes.length > maxNotes) {
                    maxNotes = track.notes.length;
                    bestTrack = track;
                }
            }

            if (!bestTrack || bestTrack.notes.length === 0) throw new Error("No notes found in MIDI.");

            // Deduplicate simultaneous notes (chords) — keep only the highest-pitched note
            // per unique tick position. The highest pitch is the standard melody convention.
            const tickMap = new Map();
            for (const n of bestTrack.notes) {
                if (!tickMap.has(n.ticks) || n.midi > tickMap.get(n.ticks).midi) {
                    tickMap.set(n.ticks, n);
                }
            }
            const melodyNotes = [...tickMap.values()].sort((a, b) => a.ticks - b.ticks);

            // Time signature
            let beats = 4;
            let beatType = 4;
            if (midi.header.timeSignatures && midi.header.timeSignatures.length > 0) {
                beats = midi.header.timeSignatures[0].timeSignature[0];
                beatType = midi.header.timeSignatures[0].timeSignature[1];
            }

            const ppq = midi.header.ppq;
            const measureTicks = beats * (4 / beatType) * ppq;

            let jianpuLines = [];
            let jianpuMeasures = [];
            let currentMeasureNotes = [];
            let currentMeasureNoteObjects = [];
            let currentMeasureIdx = 0;

            // Improved flat/sharp context mapping based on key signature
            const useFlats = ["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"].includes(keyStr);
            const stepNames = useFlats
                ? ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
                : ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

            for (let i = 0; i < melodyNotes.length; i++) {
                const note = melodyNotes[i];
                const noteMeasureIdx = Math.floor(note.ticks / measureTicks);

                // Pad empty measures with rests
                while (currentMeasureIdx < noteMeasureIdx) {
                    if (currentMeasureNotes.length > 0) {
                        jianpuLines.push(currentMeasureNotes.join(" "));
                        jianpuMeasures.push(currentMeasureNoteObjects);
                        currentMeasureNotes = [];
                        currentMeasureNoteObjects = [];
                    } else {
                        jianpuLines.push("0 - - -");
                        jianpuMeasures.push([{ degree: 0, octave: 0, type: "whole", dot: false, tie: false, rest: true, accidental: '' }]);
                    }
                    currentMeasureIdx++;
                }

                let noteNum = note.midi;
                let octave = Math.floor(noteNum / 12) - 1;
                let semitone = noteNum % 12;

                let stepStr = stepNames[semitone];
                let step = stepStr[0];
                let alter = 0;
                if (stepStr.includes('b')) {
                    alter = -1;
                } else if (stepStr.includes('#')) {
                    alter = 1;
                }

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

                let noteValue = acc + (degree + 1).toString();
                if (shift > 0) noteValue += "'".repeat(shift);
                if (shift < 0) noteValue += ".".repeat(Math.abs(shift));

                // Rhythm
                let noteBeats = note.durationTicks / ppq;
                let noteType = "quarter";
                let hasDot = false;

                if (noteBeats >= 3.75) { noteType = "whole"; }
                else if (noteBeats >= 2.75) { noteType = "half"; hasDot = true; }
                else if (noteBeats >= 1.75) { noteType = "half"; }
                else if (noteBeats >= 1.25) { noteType = "quarter"; hasDot = true; }
                else if (noteBeats >= 0.75) { noteType = "quarter"; }
                else if (noteBeats >= 0.6) { noteType = "eighth"; hasDot = true; }
                else if (noteBeats >= 0.35) { noteType = "eighth"; }
                else { noteType = "16th"; }

                let dotStr = hasDot ? "." : "";

                let noteObj = {
                    degree: degree + 1,
                    octave: shift,
                    type: noteType,
                    dot: hasDot,
                    tie: false,
                    rest: false,
                    accidental: acc
                };
                currentMeasureNoteObjects.push(noteObj);

                let noteStr = noteValue;
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
                }

                currentMeasureNotes.push(noteStr);
            }

            if (currentMeasureNotes.length > 0) {
                jianpuLines.push(currentMeasureNotes.join(" "));
                jianpuMeasures.push(currentMeasureNoteObjects);
            }

            let chunks = [];
            for (let i = 0; i < jianpuLines.length; i += 4) {
                chunks.push(jianpuLines.slice(i, i + 4).join(" | "));
            }

            const result = `Key: 1=${keyStr}   Time: ${beats}/${beatType}\n\n` + chunks.join(" |\n") + " |";
            state.jianpuText = result;

            let titleStr = midi.header.name || currentFile.name.replace(/\.[^/.]+$/, "");
            jianpuMeasures = stripRestMeasures(jianpuMeasures);
            state.lastMidiRender = {
                measures: jianpuMeasures,
                keyStr: keyStr,
                timeStr: `${beats}/${beatType}`,
                titleStr: titleStr
            };
            const svgResult = renderJianpuSVG(jianpuMeasures, keyStr, `${beats}/${beatType}`, titleStr, output.clientWidth);

            output.innerHTML = svgResult;
            output.style.display = 'block';
            controlsRow.style.display = 'flex'; // show the download buttons container
            partSelectorContainer.style.display = 'none'; // fully hide the part-selector container div

            convertBtn.textContent = 'Convert to Jianpu';
            convertBtn.disabled = false;
            return;
        }

        let xmlText = "";

        if (currentFile.name.toLowerCase().endsWith('.mxl')) {
            const arrayBuffer = await currentFile.arrayBuffer();
            const zip = await JSZip.loadAsync(arrayBuffer);

            let targetFile = null;
            const containerFile = zip.files['META-INF/container.xml'];
            if (containerFile) {
                const containerXmlText = await containerFile.async("text");
                const containerParser = new DOMParser();
                const containerDoc = containerParser.parseFromString(containerXmlText, "text/xml");
                const rootfile = containerDoc.getElementsByTagName("rootfile")[0];
                if (rootfile) {
                    const fullPath = rootfile.getAttribute("full-path");
                    if (fullPath && zip.files[fullPath]) {
                        targetFile = zip.files[fullPath];
                    }
                }
            }

            if (!targetFile) {
                for (let filename in zip.files) {
                    if (filename.endsWith('.xml') && filename !== 'META-INF/container.xml') {
                        targetFile = zip.files[filename];
                        break;
                    }
                }
            }

            if (!targetFile) throw new Error("No XML found in MXL container");
            xmlText = await targetFile.async("text");
        } else {
            xmlText = await currentFile.text();
        }

        const parser = new DOMParser();
        parsedXmlDoc = parser.parseFromString(xmlText, "text/xml");

        // --- Auto Melody Detection Heuristic ---
        const parts = parsedXmlDoc.getElementsByTagName("part");

        const keywords = [
            // Chinese
            "笛", "flute", "dizi", "箫", "xiao", "唢呐", "suona", "管子", "guanzi", "笙", "sheng", "巴乌", "bawu",
            "二胡", "erhu", "高胡", "gaohu", "中胡", "zhonghu", "板胡", "banhu", "京胡", "jinghu",
            // Western
            "violin", "soprano", "melody", "oboe", "clarinet", "trumpet", "horn",
            // Labels
            "solo", "主旋律", "lead", "主音", "旋律"
        ];

        const penaltyKeywords = [
            "大阮", "daruan", "中阮", "zhongruan", "革胡", "gehu", "大提琴", "cello",
            "低音", "bass", "打击", "percussion", "扬琴", "yangqin", "伴奏", "acc", "accompaniment"
        ];

        let bestPartIndex = 0;
        let highestScore = -Infinity;

        partSelector.innerHTML = '';

        for (let i = 0; i < parts.length; i++) {
            const option = document.createElement('option');
            option.value = i;
            const id = parts[i].getAttribute("id");

            let partName = `Part ${i + 1}`;
            const partList = parsedXmlDoc.getElementsByTagName("part-list")[0];
            if (partList) {
                const scoreParts = partList.getElementsByTagName("score-part");
                for (let sp of scoreParts) {
                    if (sp.getAttribute("id") === id) {
                        const nameNode = sp.getElementsByTagName("part-name")[0];
                        if (nameNode) partName = nameNode.textContent;
                        break;
                    }
                }
            }
            option.textContent = partName;
            partSelector.appendChild(option);

            // Scoring
            let score = 0;

            // 1. Keyword check (heavy weight)
            let nameLower = partName.toLowerCase();
            for (let kw of keywords) {
                if (nameLower.includes(kw.toLowerCase())) {
                    score += 1000;
                    break;
                }
            }

            for (let kw of penaltyKeywords) {
                if (nameLower.includes(kw.toLowerCase())) {
                    score -= 2000;
                    break;
                }
            }

            // 2. Note density & avg pitch
            const notes = parts[i].getElementsByTagName("note");
            let totalPitches = 0;
            let pitchSum = 0;

            for (let j = 0; j < notes.length; j++) {
                const pitchNode = notes[j].getElementsByTagName("pitch")[0];
                if (pitchNode) {
                    totalPitches++;
                    const stepStr = pitchNode.getElementsByTagName("step")[0].textContent;
                    let alter = 0;
                    const alterNode = pitchNode.getElementsByTagName("alter")[0];
                    if (alterNode) alter = parseFloat(alterNode.textContent);
                    const octave = parseInt(pitchNode.getElementsByTagName("octave")[0].textContent);

                    const stepMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
                    let semitone = stepMap[stepStr] + alter + (octave * 12);
                    pitchSum += semitone;
                }
            }

            score += totalPitches; // Weight by note density
            if (totalPitches > 0) {
                score += (pitchSum / totalPitches) * 2; // Tweak pitch weight
            }

            if (score > highestScore) {
                highestScore = score;
                bestPartIndex = i;
            }
        }

        // Apply auto detection
        if (parts.length > 1) {
            partSelector.value = bestPartIndex;
            autoDetectLabel.style.display = 'block';
            partSelectorContainer.style.display = 'block';
        } else {
            autoDetectLabel.style.display = 'none';
            partSelectorContainer.style.display = 'none';
        }

        renderSelectedPart();

        convertBtn.textContent = 'Convert to Jianpu';
        convertBtn.disabled = false;

    } catch (err) {
        showError('Error processing file: ' + err.message);
    }
});
