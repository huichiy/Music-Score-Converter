// Depends on: state (declared in parser.js, must load first)
if (typeof state === 'undefined') throw new Error('parser.js must be loaded before app.js');
if (typeof scaleDegrees === 'undefined') throw new Error('parser.js must be loaded before app.js');
if (typeof stepMapDiatonic === 'undefined') throw new Error('parser.js must be loaded before app.js');

// --- DOM Refs ---
const htmlDoc        = document.documentElement;
const dropzone       = document.getElementById('dropzone');
const fileInput      = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const loadedCard     = document.getElementById('loadedCard');
const convertBtn     = document.getElementById('convertBtn');
const output         = document.getElementById('output');
const mainContent    = document.getElementById('mainContent');

const optionsSec     = document.getElementById('optionsSec');
const exportSec      = document.getElementById('exportSec');
const emptyState     = document.getElementById('emptyState');
const toolbar        = document.getElementById('toolbar');
const toolbarTitle   = document.getElementById('toolbarTitle');
const toolbarMeta    = document.getElementById('toolbarMeta');
const toolbarDone    = document.getElementById('toolbarDone');

const partSelector          = document.getElementById('partSelector');
const partSelectorContainer = document.getElementById('partSelectorContainer');
const partFallback          = document.getElementById('partFallback');
const autoDetectLabel       = document.getElementById('autoDetectLabel');
const keyDisplay            = document.getElementById('keyDisplay');
const timeDisplay           = document.getElementById('timeDisplay');
const errorMsg              = document.getElementById('errorMsg');
const trySampleBtn          = document.getElementById('trySampleBtn');
const resetBtn              = document.getElementById('resetBtn');

// OCR DOM refs
const ocrImageInput  = document.getElementById('ocrImageInput');
const ocrZone        = document.getElementById('ocrZone');
const ocrLoadedCard  = document.getElementById('ocrLoadedCard');
const ocrFileName    = document.getElementById('ocrFileName');
const ocrResetBtn    = document.getElementById('ocrResetBtn');
const ocrAnalyzeBtn  = document.getElementById('ocrAnalyzeBtn');
const ocrErrorMsg    = document.getElementById('ocrErrorMsg');

let currentFile  = null;
let parsedXmlDoc = null;
let ocrCurrentFile = null;

// --- OCR Prompts ---
const JIANPU_OCR_PROMPT = `你是简谱专家。仔细分析这张简谱图片，逐小节转录乐谱内容。

严格规则：
- 只输出简谱文本，不要任何解释、说明、注释或其他文字
- 如果图片不是简谱（例如是五线谱），只回复：[错误：图片不是简谱，请切换到"五线谱→简谱"模式]

输出格式：
第一行：标题（如有）、Key: X、Time: X/X
之后按小节输出，用 | 分隔小节。
- 数字 1-7 代表音级，0 代表休止符
- 高八度音符后加 '（如 1' 2'），低八度后加 .（如 1. 2.）
- 八分音符后加 _，十六分音符后加 __
- 延音用 -

示例：
标题：茉莉花，Key: G，Time: 4/4
| 5 6 5 3 | 2 - 0 0 | 3 3_ 3 4 | 5 - - - |`;

const WESTERN_TO_JIANPU_PROMPT = `You are a music expert converting Western staff notation to Jianpu (简谱).
In Jianpu, numbers 1-7 represent scale degrees relative to the key (1=Do/tonic).
Assume treble clef unless clearly indicated otherwise.

Strict rules:
- Output ONLY the Jianpu notation lines. No explanations, no notes, no steps, no markdown, no tables, no LaTeX.
- If the image is not Western staff notation (e.g. it is already Jianpu numbered notation), reply only with: [Error: Image is not staff notation. Please switch to 简谱识别 mode.]

Output format:
- First line: Title (if visible), Key: X, Time: X/X
- Then music measure by measure, separated by |
- 1-7 for scale degrees, 0 for rest
- Add ' after a number for next higher octave (1' = octave up)
- Add . after a number for next lower octave (5. = octave down)
- Add _ for eighth notes, __ for sixteenth notes
- Use - for held beats (half note = "1 -", whole = "1 - - -")
- Accidentals: #1 raised, b3 lowered

Example (C major, 4/4):
Key: C, Time: 4/4
| 3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3 - 2 - |`;

// --- Theme re-render (toggle handled inline in HTML) ---
document.getElementById('themeToggle').addEventListener('click', () => {
    if (output.style.display !== 'none') {
        if (parsedXmlDoc) {
            renderSelectedPart();
        } else if (state.lastMidiRender) {
            const r = state.lastMidiRender;
            output.innerHTML = renderJianpuSVG(r.measures, r.keyStr, r.timeStr, r.titleStr, mainContent.clientWidth, r.tempoStr || "");
        }
    }
});

// --- Helpers ---
function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
    convertBtn.textContent = '转换 Convert';
    convertBtn.disabled = false;
}

function showOutput(svgResult, titleStr, keyStr, timeStr) {
    output.innerHTML     = svgResult;
    output.style.display = 'block';
    emptyState.style.display = 'none';

    toolbar.style.display    = 'flex';
    toolbarTitle.textContent = titleStr;
    toolbarMeta.textContent  = `1=${keyStr}  ${timeStr}`;
    toolbarDone.style.display = 'block';

    exportSec.style.display = 'block';
    keyDisplay.textContent  = `1=${keyStr}`;
    timeDisplay.textContent = timeStr;
}

// --- OCR helpers ---
function showOcrError(msg) {
    ocrErrorMsg.textContent = msg;
    ocrErrorMsg.style.display = 'block';
}

function showOcrOutput(htmlContent, label, filename) {
    output.innerHTML      = htmlContent;
    output.style.display  = 'block';
    emptyState.style.display = 'none';
    toolbar.style.display    = 'flex';
    toolbarTitle.textContent = label;
    toolbarMeta.textContent  = filename;
    toolbarDone.style.display = 'none';
    exportSec.style.display   = 'none';
}

function handleOcrFile(file) {
    if (!file || !file.type.startsWith('image/')) { showOcrError('请上传图片文件'); return; }
    if (file.size > 5 * 1024 * 1024) { showOcrError('图片不能超过 5MB'); return; }
    ocrCurrentFile = file;
    ocrFileName.textContent = file.name;
    ocrLoadedCard.style.display = 'flex';
    ocrZone.style.display = 'none';
    ocrAnalyzeBtn.disabled = false;
    ocrErrorMsg.style.display = 'none';
}

async function handleOcrConversion(file) {
    const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const mode = document.querySelector('input[name="ocrMode"]:checked').value;
    const mediaType = file.type || 'image/jpeg';
    const systemPrompt = mode === 'jianpu' ? JIANPU_OCR_PROMPT : WESTERN_TO_JIANPU_PROMPT;
    const userText = mode === 'jianpu' ? '请识别并转录这张简谱图片。' : '请将这张五线谱转换为简谱。';

    const res = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                max_tokens: 2048,
                temperature: 0,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: [
                        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
                        { type: 'text', text: userText }
                    ]}
                ]
            })
        }
    );

    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '（无输出）';

    // Detect wrong mode warning from AI
    if (text.startsWith('[错误：') || text.startsWith('[Error:')) {
        throw new Error(text.replace(/^\[错误：|^\[Error:\s*/, '').replace(/\]$/, ''));
    }

    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const label = mode === 'jianpu' ? '简谱识别' : '五线谱→简谱';
    showOcrOutput(
        `<div style="font-family:monospace;font-size:14px;line-height:1.9;white-space:pre-wrap;color:var(--text);padding:8px 0">${escaped}</div>`,
        label,
        file.name
    );
}

// --- File handling ---
function handleFile(file) {
    if (!file) return;
    currentFile = file;

    fileNameDisplay.textContent = file.name;
    loadedCard.style.display = 'block';

    convertBtn.disabled = false;
    convertBtn.textContent = '转换 Convert';
    output.style.display      = 'none';
    emptyState.style.display  = 'flex';
    toolbar.style.display     = 'none';
    toolbarDone.style.display = 'none';
    optionsSec.style.display  = 'none';
    exportSec.style.display   = 'none';
    partSelectorContainer.style.display = 'none';
    partFallback.style.display          = 'none';
    autoDetectLabel.style.display       = 'none';
    errorMsg.style.display = 'none';
    keyDisplay.textContent  = '—';
    timeDisplay.textContent = '—';
    parsedXmlDoc = null;
    state.lastMidiRender = null;
}

// --- Reset ---
function resetAll() {
    currentFile  = null;
    parsedXmlDoc = null;
    state.lastMidiRender = null;

    loadedCard.style.display  = 'none';
    output.style.display      = 'none';
    emptyState.style.display  = 'flex';
    toolbar.style.display     = 'none';
    toolbarDone.style.display = 'none';
    optionsSec.style.display  = 'none';
    exportSec.style.display   = 'none';
    partSelectorContainer.style.display = 'none';
    partFallback.style.display          = 'none';
    autoDetectLabel.style.display       = 'none';
    errorMsg.style.display    = 'none';

    fileNameDisplay.textContent = '—';
    keyDisplay.textContent      = '—';
    timeDisplay.textContent     = '—';
    convertBtn.disabled         = true;
    convertBtn.textContent      = '转换 Convert';
    fileInput.value             = '';
}

resetBtn.addEventListener('click', resetAll);

dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });
dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => { handleFile(e.target.files[0]); });

// --- Try Sample (embedded XML, no fetch needed) ---
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
<work><work-title>Twinkle Twinkle Little Star</work-title></work>
<part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type></direction><direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="2"><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="3"><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="4"><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="5"><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="6"><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="7"><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="8"><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="9"><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="10"><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>A</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>G</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
<measure number="11"><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note></measure>
<measure number="12"><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>quarter</type></note><note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><type>half</type></note></measure>
</part>
</score-partwise>`;

trySampleBtn.addEventListener('click', () => {
    const blob = new Blob([SAMPLE_XML], { type: 'application/xml' });
    const file = new File([blob], 'Twinkle Twinkle Little Star.xml', { type: 'application/xml' });
    handleFile(file);
    convertBtn.click();
});

// --- Render selected part (XML) ---
function renderSelectedPart() {
    if (!parsedXmlDoc) return;

    const selectedIdx = parseInt(partSelector.value);
    const partsList = parsedXmlDoc.getElementsByTagName("part");
    if (partsList.length <= selectedIdx) return;

    const dummyDoc = document.implementation.createDocument(null, "score-partwise");
    dummyDoc.documentElement.appendChild(parsedXmlDoc.getElementsByTagName("part-list")[0].cloneNode(true));
    dummyDoc.documentElement.appendChild(partsList[selectedIdx].cloneNode(true));

    // Title
    let titleStr = "Untitled";
    const movementTitleNodes = parsedXmlDoc.getElementsByTagName("movement-title");
    const workTitleNodes     = parsedXmlDoc.getElementsByTagName("work-title");
    if (movementTitleNodes.length > 0)  titleStr = movementTitleNodes[0].textContent;
    else if (workTitleNodes.length > 0) titleStr = workTitleNodes[0].textContent;
    if (titleStr === "Untitled" && currentFile) titleStr = currentFile.name.replace(/\.[^/.]+$/, "");

    // Time signature
    let beats = "4"; let beatType = "4";
    const beatsNodes = dummyDoc.getElementsByTagName("beats");
    if (beatsNodes.length > 0) beats = beatsNodes[0].textContent;
    else { const fb = parsedXmlDoc.getElementsByTagName("beats"); if (fb.length > 0) beats = fb[0].textContent; }
    const beatTypeNodes = dummyDoc.getElementsByTagName("beat-type");
    if (beatTypeNodes.length > 0) beatType = beatTypeNodes[0].textContent;
    else { const fb = parsedXmlDoc.getElementsByTagName("beat-type"); if (fb.length > 0) beatType = fb[0].textContent; }

    // Key
    let fifths = 0;
    const fifthsNodes = dummyDoc.getElementsByTagName("fifths");
    if (fifthsNodes.length > 0) fifths = parseInt(fifthsNodes[0].textContent);
    else { const fb = parsedXmlDoc.getElementsByTagName("fifths"); if (fb.length > 0) fifths = parseInt(fb[0].textContent); }
    const keyMap = { "-7":"Cb","-6":"Gb","-5":"Db","-4":"Ab","-3":"Eb","-2":"Bb","-1":"F","0":"C","1":"G","2":"D","3":"A","4":"E","5":"B","6":"F#","7":"C#" };
    const keyStr = keyMap[fifths.toString()] || "C";

    // Tempo
    let tempoStr = "";
    const metronomeNodes = parsedXmlDoc.getElementsByTagName("per-minute");
    if (metronomeNodes.length > 0) tempoStr = metronomeNodes[0].textContent.trim();

    const svgMeasures = parseXMLToNoteObjects(dummyDoc);
    const svgResult   = renderJianpuSVG(svgMeasures, keyStr, `${beats}/${beatType}`, titleStr, mainContent.clientWidth, tempoStr);

    showOutput(svgResult, titleStr, keyStr, `${beats}/${beatType}`);
}

partSelector.addEventListener('change', () => {
    autoDetectLabel.style.display = 'none';
    renderSelectedPart();
});

// --- Compatibility helpers for iOS < 14.5 ---
function fileToArrayBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}
function fileToText(file) {
    if (file.text) return file.text();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file, 'UTF-8');
    });
}

// --- MIDI Conversion ---
async function handleMidiConversion(file) {
    const arrayBuffer = await fileToArrayBuffer(file);
    const midi = new Midi(arrayBuffer);

    let keyStr = "C";
    if (midi.header.keySignatures && midi.header.keySignatures.length > 0) {
        keyStr = midi.header.keySignatures[0].key;
    }

    let baseTonicStep  = keyStr[0];
    let baseTonicAlter = keyStr.includes('#') ? 1 : (keyStr.includes('b') ? -1 : 0);
    let baseTonicSemi  = pitchToSemitones(baseTonicStep, baseTonicAlter, 4);

    let bestTrack = null; let maxNotes = -1;
    for (const track of midi.tracks) {
        if (track.notes.length > maxNotes) { maxNotes = track.notes.length; bestTrack = track; }
    }
    if (!bestTrack || bestTrack.notes.length === 0) throw new Error("No notes found in MIDI.");

    const tickMap = new Map();
    for (const n of bestTrack.notes) {
        if (!tickMap.has(n.ticks) || n.midi > tickMap.get(n.ticks).midi) tickMap.set(n.ticks, n);
    }
    const melodyNotes = [...tickMap.values()].sort((a, b) => a.ticks - b.ticks);

    let beats = 4; let beatType = 4;
    if (midi.header.timeSignatures && midi.header.timeSignatures.length > 0) {
        const rawBeats    = midi.header.timeSignatures[0].timeSignature[0];
        const rawBeatType = midi.header.timeSignatures[0].timeSignature[1];
        if ([2,4,8,16].includes(rawBeatType) && rawBeats >= 2 && rawBeats <= 12) {
            beats = rawBeats; beatType = rawBeatType;
        }
    }

    const ppq = midi.header.ppq;
    let measureTicks = beats * (4 / beatType) * ppq;

    const estMeasures = Math.ceil((melodyNotes[melodyNotes.length - 1].ticks + 1) / measureTicks);
    if (melodyNotes.length / Math.max(1, estMeasures) < 1.5) {
        beats = 4; beatType = 4;
        measureTicks = beats * (4 / beatType) * ppq;
    }

    let useFlats  = ["F","Bb","Eb","Ab","Db","Gb","Cb"].includes(keyStr);
    let stepNames = useFlats
        ? ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"]
        : ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

    // Mid-piece key changes: sort all key signature events; first is already applied
    const sortedKeyChanges = (midi.header.keySignatures || [])
        .slice()
        .sort((a, b) => a.ticks - b.ticks);
    let keyChangeIdx = 1;

    let jianpuMeasures = [];
    let currentMeasureNoteObjects = [];
    let currentMeasureIdx = 0;

    for (let i = 0; i < melodyNotes.length; i++) {
        const note           = melodyNotes[i];
        const noteMeasureIdx = Math.floor(note.ticks / measureTicks);

        while (currentMeasureIdx < noteMeasureIdx) {
            if (currentMeasureNoteObjects.length > 0) {
                jianpuMeasures.push(currentMeasureNoteObjects);
                currentMeasureNoteObjects = [];
            } else {
                jianpuMeasures.push([{ degree:0, octave:0, type:"whole", dot:false, tie:false, rest:true, accidental:'' }]);
            }
            currentMeasureIdx++;
        }

        // Apply any key changes that occur at or before this note's tick
        while (keyChangeIdx < sortedKeyChanges.length && sortedKeyChanges[keyChangeIdx].ticks <= note.ticks) {
            const newKey = sortedKeyChanges[keyChangeIdx].key;
            baseTonicStep  = newKey[0];
            baseTonicAlter = newKey.includes('#') ? 1 : (newKey.includes('b') ? -1 : 0);
            baseTonicSemi  = pitchToSemitones(baseTonicStep, baseTonicAlter, 4);
            useFlats  = ["F","Bb","Eb","Ab","Db","Gb","Cb"].includes(newKey);
            stepNames = useFlats
                ? ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"]
                : ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
            keyChangeIdx++;
        }

        const noteNum  = note.midi;
        const octave   = Math.floor(noteNum / 12) - 1;
        const semitone = noteNum % 12;
        const stepStr  = stepNames[semitone];
        const step     = stepStr[0];
        const alter    = stepStr.includes('b') ? -1 : (stepStr.includes('#') ? 1 : 0);

        const noteSemi     = pitchToSemitones(step, alter, octave);
        const tonicDiatAbs = stepMapDiatonic[baseTonicStep] + 4 * 7;
        const noteDiatAbs  = stepMapDiatonic[step] + octave * 7;
        let   degree       = ((noteDiatAbs - tonicDiatAbs) % 7 + 7) % 7;
        const shift        = Math.round((noteSemi - (baseTonicSemi + scaleDegrees[degree])) / 12);
        const intendedSemi = baseTonicSemi + shift * 12 + scaleDegrees[degree];
        const acc          = noteSemi > intendedSemi ? "#" : (noteSemi < intendedSemi ? "b" : "");

        const noteBeats = note.durationTicks / ppq;
        let noteType = "quarter"; let hasDot = false;
        if      (noteBeats >= 3.75) { noteType = "whole"; }
        else if (noteBeats >= 2.75) { noteType = "half";    hasDot = true; }
        else if (noteBeats >= 1.75) { noteType = "half"; }
        else if (noteBeats >= 1.25) { noteType = "quarter"; hasDot = true; }
        else if (noteBeats >= 0.75) { noteType = "quarter"; }
        else if (noteBeats >= 0.6)  { noteType = "eighth";  hasDot = true; }
        else if (noteBeats >= 0.35) { noteType = "eighth"; }
        else                        { noteType = "16th"; }

        currentMeasureNoteObjects.push({ degree:degree+1, octave:shift, type:noteType, dot:hasDot, tie:false, rest:false, accidental:acc });
    }
    if (currentMeasureNoteObjects.length > 0) jianpuMeasures.push(currentMeasureNoteObjects);

    let tempoStr = "";
    if (midi.header.tempos && midi.header.tempos.length > 0) {
        tempoStr = Math.round(midi.header.tempos[0].bpm).toString();
    }

    const titleStr = midi.header.name || file.name.replace(/\.[^/.]+$/, "");
    const timeStr  = `${beats}/${beatType}`;
    state.lastMidiRender = { measures:jianpuMeasures, keyStr, timeStr, titleStr, tempoStr };

    const svgResult = renderJianpuSVG(jianpuMeasures, keyStr, timeStr, titleStr, mainContent.clientWidth, tempoStr);
    showOutput(svgResult, titleStr, keyStr, timeStr);

    optionsSec.style.display            = 'block';
    partSelectorContainer.style.display = 'none';
    partFallback.style.display          = 'block';
    partFallback.textContent            = '自动';
}

// --- MusicXML Conversion ---
async function handleXmlConversion(file) {
    let xmlText = "";

    if (file.name.toLowerCase().endsWith('.mxl')) {
        const arrayBuffer = await fileToArrayBuffer(file);
        const zip = await JSZip.loadAsync(arrayBuffer);

        let targetFile = null;
        const containerFile = zip.files['META-INF/container.xml'];
        if (containerFile) {
            const containerXmlText = await containerFile.async("text");
            const containerParser  = new DOMParser();
            const containerDoc     = containerParser.parseFromString(containerXmlText, "text/xml");
            const rootfile         = containerDoc.getElementsByTagName("rootfile")[0];
            if (rootfile) {
                const fullPath = rootfile.getAttribute("full-path");
                if (fullPath && zip.files[fullPath]) targetFile = zip.files[fullPath];
            }
        }
        if (!targetFile) {
            for (const filename in zip.files) {
                if (filename.endsWith('.xml') && filename !== 'META-INF/container.xml') {
                    targetFile = zip.files[filename]; break;
                }
            }
        }
        if (!targetFile) throw new Error("No XML found in MXL container");
        xmlText = await targetFile.async("text");
    } else {
        xmlText = await fileToText(file);
    }

    const parser = new DOMParser();
    parsedXmlDoc = parser.parseFromString(xmlText, "text/xml");

    const parts = parsedXmlDoc.getElementsByTagName("part");

    const keywords = [
        "笛","flute","dizi","箫","xiao","唢呐","suona","管子","guanzi","笙","sheng","巴乌","bawu",
        "二胡","erhu","高胡","gaohu","中胡","zhonghu","板胡","banhu","京胡","jinghu",
        "violin","soprano","melody","oboe","clarinet","trumpet","horn",
        "solo","主旋律","lead","主音","旋律"
    ];
    const penaltyKeywords = [
        "大阮","daruan","中阮","zhongruan","革胡","gehu","大提琴","cello",
        "低音","bass","打击","percussion","扬琴","yangqin","伴奏","acc","accompaniment"
    ];

    let bestPartIndex = 0; let highestScore = -Infinity;
    partSelector.innerHTML = '';

    for (let i = 0; i < parts.length; i++) {
        const option = document.createElement('option');
        option.value = i;
        const id = parts[i].getAttribute("id");

        let partName = `Part ${i + 1}`;
        const partList = parsedXmlDoc.getElementsByTagName("part-list")[0];
        if (partList) {
            for (const sp of partList.getElementsByTagName("score-part")) {
                if (sp.getAttribute("id") === id) {
                    const nameNode = sp.getElementsByTagName("part-name")[0];
                    if (nameNode) partName = nameNode.textContent;
                    break;
                }
            }
        }
        option.textContent = partName;
        partSelector.appendChild(option);

        let score = 0;
        const nameLower = partName.toLowerCase();
        for (const kw of keywords)        { if (nameLower.includes(kw.toLowerCase())) { score += 1000; break; } }
        for (const kw of penaltyKeywords) { if (nameLower.includes(kw.toLowerCase())) { score -= 2000; break; } }

        const notes = parts[i].getElementsByTagName("note");
        let totalPitches = 0; let pitchSum = 0;
        for (let j = 0; j < notes.length; j++) {
            const pitchNode = notes[j].getElementsByTagName("pitch")[0];
            if (pitchNode) {
                totalPitches++;
                const stepStr   = pitchNode.getElementsByTagName("step")[0].textContent;
                const alterNode = pitchNode.getElementsByTagName("alter")[0];
                const alter     = alterNode ? parseFloat(alterNode.textContent) : 0;
                const octave    = parseInt(pitchNode.getElementsByTagName("octave")[0].textContent);
                const stepMap   = { 'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11 };
                pitchSum       += stepMap[stepStr] + alter + (octave * 12);
            }
        }
        score += totalPitches;
        if (totalPitches > 0) score += (pitchSum / totalPitches) * 2;
        if (score > highestScore) { highestScore = score; bestPartIndex = i; }
    }

    optionsSec.style.display = 'block';

    if (parts.length > 1) {
        partSelector.value = bestPartIndex;
        partSelectorContainer.style.display = 'block';
        partFallback.style.display          = 'none';
        autoDetectLabel.style.display       = 'block';
    } else {
        partSelectorContainer.style.display = 'none';
        partFallback.style.display          = 'block';
        partFallback.textContent            = '—';
        autoDetectLabel.style.display       = 'none';
    }

    renderSelectedPart();
}

// --- Convert Button ---
convertBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    if (currentFile.size > MAX_FILE_SIZE) {
        showError('File is too large (max 20 MB). Please use a smaller file.');
        return;
    }

    convertBtn.textContent = '正在转换…';
    convertBtn.disabled = true;
    errorMsg.style.display = 'none';

    try {
        const isMidi = currentFile.name.toLowerCase().endsWith('.mid') || currentFile.name.toLowerCase().endsWith('.midi');
        if (isMidi) {
            await handleMidiConversion(currentFile);
        } else {
            await handleXmlConversion(currentFile);
        }
        convertBtn.textContent = '转换 Convert';
        convertBtn.disabled = false;
    } catch (err) {
        showError('Error: ' + err.message);
    }
});

// --- OCR Events ---
ocrImageInput.addEventListener('change', e => handleOcrFile(e.target.files[0]));

ocrResetBtn.addEventListener('click', () => {
    ocrCurrentFile = null;
    ocrImageInput.value = '';
    ocrLoadedCard.style.display = 'none';
    ocrZone.style.display = '';
    ocrAnalyzeBtn.disabled = true;
    ocrErrorMsg.style.display = 'none';
    output.style.display     = 'none';
    emptyState.style.display = 'flex';
    toolbar.style.display    = 'none';
    toolbarDone.style.display = 'none';
});

ocrZone.addEventListener('dragover', e => { e.preventDefault(); ocrZone.classList.add('dragover'); });
ocrZone.addEventListener('dragleave', () => ocrZone.classList.remove('dragover'));
ocrZone.addEventListener('drop', e => {
    e.preventDefault();
    ocrZone.classList.remove('dragover');
    handleOcrFile(e.dataTransfer.files[0]);
});

ocrAnalyzeBtn.addEventListener('click', async () => {
    if (!ocrCurrentFile) { showOcrError('请先选择图片'); return; }
    ocrAnalyzeBtn.disabled = true;
    ocrAnalyzeBtn.textContent = '识别中…';
    ocrErrorMsg.style.display = 'none';
    try {
        await handleOcrConversion(ocrCurrentFile);
    } catch (err) {
        showOcrError(err.message || '识别失败，请重试');
    } finally {
        ocrAnalyzeBtn.disabled = false;
        ocrAnalyzeBtn.textContent = '识别 Analyze';
    }
});
