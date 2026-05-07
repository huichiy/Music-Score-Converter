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

// Transpose DOM refs
const transposeSelect = document.getElementById('transposeSelect');
const transposeRow    = document.getElementById('transposeRow');

// Editor DOM refs
const editBtnA         = document.getElementById('editBtnA');
const editBtnB         = document.getElementById('editBtnB');
const editPopup        = document.getElementById('editPopup');
const editTextOverlay  = document.getElementById('editTextOverlay');
const editTextArea     = document.getElementById('editTextArea');
const editTextSave     = document.getElementById('editTextSave');
const editTextCancel   = document.getElementById('editTextCancel');
const editHelpBtn      = document.getElementById('editHelpBtn');
const editHelpModal    = document.getElementById('editHelpModal');
const editHelpClose    = document.getElementById('editHelpClose');
const popupConfirm     = document.getElementById('popupConfirm');
const popupCancel      = document.getElementById('popupCancel');
const popupDuration    = document.getElementById('popupDuration');
const popupAccRow      = document.getElementById('popupAccRow');
const popupOctRow      = document.getElementById('popupOctRow');
const popupDegreeBtns  = document.getElementById('popupDegreeBtns');

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
    if (output.style.display !== 'none' && state.originalMeasures) {
        const targetKey = transposeSelect.value || state.originalKeyStr;
        const measures  = transposeNoteObjects(state.originalMeasures, state.originalKeyStr, targetKey);
        state.currentMeasures = measures;
        state.currentKeyStr   = targetKey;
        output.innerHTML = renderJianpuSVG(
            measures, targetKey,
            state.originalTimeStr, state.originalTitleStr,
            mainContent.clientWidth, state.originalTempoStr || ""
        );
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


    exportSec.style.display = 'block';
    keyDisplay.textContent  = `1=${keyStr}`;
    timeDisplay.textContent = timeStr;

    // Show editor buttons
    editBtnA.style.display = 'inline-block';
    editBtnB.style.display = 'inline-block';
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

    exportSec.style.display   = 'none';
    editBtnA.style.display    = 'none';
    editBtnB.style.display    = 'none';
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
    emptyState.style.display  = 'block';
    toolbar.style.display     = 'none';

    optionsSec.style.display  = 'none';
    exportSec.style.display   = 'none';
    partSelectorContainer.style.display = 'none';
    partFallback.style.display          = 'none';
    autoDetectLabel.style.display       = 'none';
    transposeRow.style.display          = 'none';
    transposeSelect.value               = '';
    errorMsg.style.display = 'none';
    keyDisplay.textContent  = '—';
    timeDisplay.textContent = '—';
    parsedXmlDoc = null;
    state.lastMidiRender   = null;
    state.originalMeasures = null;
    state.originalKeyStr   = null;
    state.originalTimeStr  = null;
    state.originalTitleStr = null;
    state.originalTempoStr = null;
    state.currentMeasures  = null;
    state.currentKeyStr    = null;
    editBtnA.style.display = 'none';
    editBtnB.style.display = 'none';
}

// --- Reset ---
function resetAll() {
    currentFile  = null;
    parsedXmlDoc = null;
    state.lastMidiRender = null;

    loadedCard.style.display  = 'none';
    output.style.display      = 'none';
    emptyState.style.display  = 'block';
    toolbar.style.display     = 'none';

    optionsSec.style.display  = 'none';
    exportSec.style.display   = 'none';
    partSelectorContainer.style.display = 'none';
    partFallback.style.display          = 'none';
    autoDetectLabel.style.display       = 'none';
    transposeRow.style.display          = 'none';
    transposeSelect.value               = '';
    errorMsg.style.display    = 'none';

    fileNameDisplay.textContent = '—';
    keyDisplay.textContent      = '—';
    timeDisplay.textContent     = '—';
    convertBtn.disabled         = true;
    convertBtn.textContent      = '转换 Convert';
    fileInput.value             = '';
    state.originalMeasures = null;
    state.originalKeyStr   = null;
    state.originalTimeStr  = null;
    state.originalTitleStr = null;
    state.originalTempoStr = null;
    state.currentMeasures  = null;
    state.currentKeyStr    = null;
    editBtnA.style.display = 'none';
    editBtnB.style.display = 'none';
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
    const keyStr = keyMap[fifths.toString()] || "C";

    // Tempo
    let tempoStr = "";
    const metronomeNodes = parsedXmlDoc.getElementsByTagName("per-minute");
    if (metronomeNodes.length > 0) tempoStr = metronomeNodes[0].textContent.trim();

    const svgMeasures = parseXMLToNoteObjects(dummyDoc);

    // Store originals for transpose re-render
    state.originalMeasures = svgMeasures;
    state.originalKeyStr   = keyStr;
    state.originalTimeStr  = `${beats}/${beatType}`;
    state.originalTitleStr = titleStr;
    state.originalTempoStr = tempoStr;
    transposeRow.style.display = 'flex';

    // Apply active transpose (if any)
    const targetKey       = transposeSelect.value || keyStr;
    const displayMeasures = transposeNoteObjects(svgMeasures, keyStr, targetKey);
    state.currentMeasures = displayMeasures;
    state.currentKeyStr   = targetKey;
    const svgResult       = renderJianpuSVG(displayMeasures, targetKey, `${beats}/${beatType}`, titleStr, mainContent.clientWidth, tempoStr);

    showOutput(svgResult, titleStr, targetKey, `${beats}/${beatType}`);
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

// --- ABC Parsing ---

function parseDuration(s, i) {
    const start = i;
    let num = 1, den = 1;
    const nm = s.slice(i).match(/^(\d+)/);
    if (nm) { num = parseInt(nm[1]); i += nm[1].length; }
    if (i < s.length && s[i] === '/') {
        i++;
        const dm = s.slice(i).match(/^(\d+)/);
        if (dm) { den = parseInt(dm[1]); i += dm[1].length; }
        else den = 2; // bare / means /2
    }
    return { num, den, consumed: i - start };
}

function parseABC(text, filename) {
    const abcKeyMap = {
        'C':'C','G':'G','D':'D','A':'A','E':'E','B':'B','F#':'F#','C#':'C#',
        'F':'F','Bb':'Bb','Eb':'Eb','Ab':'Ab','Db':'Db','Gb':'Gb','Cb':'Cb',
        'Am':'C','Em':'G','Bm':'D','F#m':'A','C#m':'E','G#m':'B','D#m':'F#',
        'Dm':'F','Gm':'Bb','Cm':'Eb','Fm':'Ab','Bbm':'Db','Ebm':'Gb',
    };
    const fifthsMap = {
        'C':0,'G':1,'D':2,'A':3,'E':4,'B':5,'F#':6,'C#':7,
        'F':-1,'Bb':-2,'Eb':-3,'Ab':-4,'Db':-5,'Gb':-6,'Cb':-7,
    };

    let titleStr = filename.replace(/\.[^/.]+$/, '');
    let timeStr  = '4/4';
    let keyStr   = 'C';
    let tempoStr = '';
    let defaultL = null;

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let bodyStart = lines.length;

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li].trim();
        if (!line || line.startsWith('%')) continue;
        const m = line.match(/^([A-Za-z]):\s*(.*)/);
        if (!m) { bodyStart = li; break; }
        const tag = m[1].toUpperCase();
        const val = m[2].trim();
        if      (tag === 'T') titleStr = val;
        else if (tag === 'M') timeStr = val === 'C' ? '4/4' : val === 'C|' ? '2/2' : val;
        else if (tag === 'L') {
            const lm = val.match(/(\d+)\/(\d+)/);
            if (lm) defaultL = parseInt(lm[1]) / parseInt(lm[2]);
        }
        else if (tag === 'Q') {
            const qm = val.match(/(\d+)\s*$/);
            if (qm) tempoStr = qm[1];
        }
        else if (tag === 'K') {
            const raw = val.split(/[\s,]/)[0];
            keyStr = abcKeyMap[raw] || abcKeyMap[raw.replace(/maj$/i, '')] || 'C';
            bodyStart = li + 1;
            break;
        }
    }

    const [mb, md] = timeStr.split('/').map(Number);
    if (!defaultL) defaultL = (mb / md) < 0.75 ? 1/16 : 1/8;
    const beatsPerUnit = defaultL * 4; // whole note = 4 beats

    const fifths = fifthsMap[keyStr] || 0;
    const sharpOrder = ['F','C','G','D','A','E','B'];
    const flatOrder  = ['B','E','A','D','G','C','F'];
    const keySigAcc  = {};
    if (fifths > 0) for (let k = 0; k < fifths;  k++) keySigAcc[sharpOrder[k]] =  1;
    if (fifths < 0) for (let k = 0; k < -fifths; k++) keySigAcc[flatOrder[k]]  = -1;

    const baseTonicStep  = keyStr[0];
    const baseTonicAlter = keyStr.includes('#') ? 1 : (keyStr.includes('b') ? -1 : 0);
    const baseTonicSemi  = pitchToSemitones(baseTonicStep, baseTonicAlter, 4);

    function beatsToNoteType(b) {
        if (b >= 3.75) return { type:'whole',   dot:false };
        if (b >= 2.75) return { type:'half',    dot:true  };
        if (b >= 1.75) return { type:'half',    dot:false };
        if (b >= 1.25) return { type:'quarter', dot:true  };
        if (b >= 0.75) return { type:'quarter', dot:false };
        if (b >= 0.6 ) return { type:'eighth',  dot:true  };
        if (b >= 0.35) return { type:'eighth',  dot:false };
        return { type:'16th', dot:false };
    }

    // Build body string: strip comments and chord symbols
    const body = lines.slice(bodyStart)
        .join('\n')
        .replace(/%[^\n]*/g, '')
        .replace(/"[^"]*"/g, '');

    const measures = [];
    let currentMeasure = [];
    let measureAcc = {}; // accidentals active within current measure
    let pendingTie = false; // set when '-' tie marker seen; applied to next note

    let i = 0;
    while (i < body.length) {
        const ch = body[i];

        if (/[\s\n]/.test(ch)) { i++; continue; }

        // Barline starting with |
        if (ch === '|') {
            if (currentMeasure.length > 0) {
                measures.push(currentMeasure);
                currentMeasure = [];
                measureAcc = {};
            }
            i++;
            while (i < body.length && /[|:\]]/.test(body[i])) i++;
            continue;
        }

        // End-repeat :|
        if (ch === ':' && i + 1 < body.length && body[i+1] === '|') {
            if (currentMeasure.length > 0) {
                measures.push(currentMeasure);
                currentMeasure = [];
                measureAcc = {};
            }
            i += 2;
            while (i < body.length && /[|:\]]/.test(body[i])) i++;
            continue;
        }

        // [| thick barline or [1 [2 endings
        if (ch === '[') {
            if (body[i+1] === '|') {
                if (currentMeasure.length > 0) { measures.push(currentMeasure); currentMeasure = []; measureAcc = {}; }
                i += 2;
                while (i < body.length && body[i] === ']') i++;
                continue;
            }
            if (/\d/.test(body[i+1])) {
                if (currentMeasure.length > 0) { measures.push(currentMeasure); currentMeasure = []; measureAcc = {}; }
                i++;
                continue;
            }
            i++; // skip [ of inline chord (first note inside will be parsed normally)
            continue;
        }
        if (ch === ']') { i++; continue; }

        // Rest: z or x (invisible rest)
        if (ch === 'z' || ch === 'Z' || ch === 'x') {
            i++;
            const { num, den, consumed } = parseDuration(body, i);
            i += consumed;
            const beatDur = (num / den) * beatsPerUnit;
            const { type, dot } = beatsToNoteType(beatDur);
            currentMeasure.push({ degree:0, octave:0, type, dot, tie:false, rest:true, accidental:'' });
            continue;
        }

        // Accidental prefix: ^ _ =
        let explicitAcc = null;
        if (ch === '^') {
            explicitAcc = body[i+1] === '^' ? 2 : 1;
            i += (body[i+1] === '^' ? 2 : 1);
        } else if (ch === '_') {
            explicitAcc = body[i+1] === '_' ? -2 : -1;
            i += (body[i+1] === '_' ? 2 : 1);
        } else if (ch === '=') {
            explicitAcc = 0; // explicit natural
            i++;
        }

        const noteCh = body[i];
        if (!/[A-Ga-g]/.test(noteCh)) { i++; continue; } // skip non-note chars

        const stepLetter = noteCh.toUpperCase();
        const isLower    = noteCh >= 'a' && noteCh <= 'g';
        i++;

        // Base octave: uppercase C = C4 (middle C), lowercase c = C5
        let noteOctave = isLower ? 5 : 4;
        while (i < body.length && body[i] === "'") { noteOctave++; i++; }
        while (i < body.length && body[i] === ',')  { noteOctave--; i++; }

        const { num, den, consumed } = parseDuration(body, i);
        i += consumed;

        // Tie marker: '-' means next note is a tie stop
        if (i < body.length && body[i] === '-') { pendingTie = true; i++; }

        // Resolve accidental: explicit > active in measure > key signature
        let alter;
        if (explicitAcc !== null) {
            alter = Math.max(-1, Math.min(1, explicitAcc));
            measureAcc[stepLetter] = alter; // carry for rest of measure
        } else if (stepLetter in measureAcc) {
            alter = measureAcc[stepLetter];
        } else {
            alter = keySigAcc[stepLetter] || 0;
        }

        // Degree + octave shift (same logic as XML/MIDI)
        const noteSemi     = pitchToSemitones(stepLetter, alter, noteOctave);
        const tonicDiatAbs = stepMapDiatonic[baseTonicStep] + 4 * 7;
        const noteDiatAbs  = stepMapDiatonic[stepLetter] + noteOctave * 7;
        const degree       = ((noteDiatAbs - tonicDiatAbs) % 7 + 7) % 7;
        const shift        = Math.round((noteSemi - (baseTonicSemi + scaleDegrees[degree])) / 12);
        const intendedSemi = baseTonicSemi + shift * 12 + scaleDegrees[degree];
        const accStr       = noteSemi > intendedSemi ? '#' : (noteSemi < intendedSemi ? 'b' : '');

        const beatDur = (num / den) * beatsPerUnit;
        const { type, dot } = beatsToNoteType(beatDur);

        currentMeasure.push({
            degree: degree + 1, octave: shift,
            type, dot, tie: pendingTie, rest: false, accidental: accStr
        });
        pendingTie = false;
    }

    if (currentMeasure.length > 0) measures.push(currentMeasure);
    return { measures, keyStr, timeStr, titleStr, tempoStr };
}

async function handleAbcConversion(file) {
    const text = await fileToText(file);
    const { measures, keyStr, timeStr, titleStr, tempoStr } = parseABC(text, file.name);
    if (!measures.length) throw new Error('No notes found in ABC file.');

    // Store originals for transpose
    state.originalMeasures = measures;
    state.originalKeyStr   = keyStr;
    state.originalTimeStr  = timeStr;
    state.originalTitleStr = titleStr;
    state.originalTempoStr = tempoStr;

    state.currentMeasures = measures;
    state.currentKeyStr   = keyStr;
    state.lastMidiRender  = { measures, keyStr, timeStr, titleStr, tempoStr };
    const svgResult = renderJianpuSVG(measures, keyStr, timeStr, titleStr, mainContent.clientWidth, tempoStr);
    showOutput(svgResult, titleStr, keyStr, timeStr);

    optionsSec.style.display            = 'block';
    partSelectorContainer.style.display = 'none';
    partFallback.style.display          = 'block';
    partFallback.textContent            = '—';
    transposeRow.style.display          = 'flex';
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

    // Snap ticks to a small grid to absorb 1–2 tick quantization errors from DAWs/MuseScore
    const TICK_SNAP = Math.max(2, Math.round(midi.header.ppq / 120)); // ~0.8% of a beat
    const tickMap = new Map();
    for (const n of bestTrack.notes) {
        const snapped = Math.round(n.ticks / TICK_SNAP) * TICK_SNAP;
        if (!tickMap.has(snapped) || n.midi > tickMap.get(snapped).midi) tickMap.set(snapped, n);
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

    // Store originals for transpose
    state.originalMeasures = jianpuMeasures;
    state.originalKeyStr   = keyStr;
    state.originalTimeStr  = timeStr;
    state.originalTitleStr = titleStr;
    state.originalTempoStr = tempoStr;

    state.currentMeasures = jianpuMeasures;
    state.currentKeyStr   = keyStr;
    state.lastMidiRender  = { measures:jianpuMeasures, keyStr, timeStr, titleStr, tempoStr };

    const svgResult = renderJianpuSVG(jianpuMeasures, keyStr, timeStr, titleStr, mainContent.clientWidth, tempoStr);
    showOutput(svgResult, titleStr, keyStr, timeStr);

    optionsSec.style.display            = 'block';
    partSelectorContainer.style.display = 'none';
    partFallback.style.display          = 'block';
    partFallback.textContent            = '自动';
    transposeRow.style.display          = 'flex';
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
        const nameLower = currentFile.name.toLowerCase();
        const isMidi = nameLower.endsWith('.mid') || nameLower.endsWith('.midi');
        const isAbc  = nameLower.endsWith('.abc');
        if (isMidi) {
            await handleMidiConversion(currentFile);
        } else if (isAbc) {
            await handleAbcConversion(currentFile);
        } else {
            await handleXmlConversion(currentFile);
        }
        convertBtn.textContent = '转换 Convert';
        convertBtn.disabled = false;
    } catch (err) {
        showError('Error: ' + err.message);
    }
});

// --- Transpose ---
transposeSelect.addEventListener('change', () => {
    if (!state.originalMeasures) return;
    const targetKey     = transposeSelect.value || state.originalKeyStr;
    const measures      = transposeNoteObjects(state.originalMeasures, state.originalKeyStr, targetKey);
    state.currentMeasures = measures;
    state.currentKeyStr   = targetKey;
    const svgResult     = renderJianpuSVG(
        measures, targetKey,
        state.originalTimeStr, state.originalTitleStr,
        mainContent.clientWidth, state.originalTempoStr || ""
    );
    output.innerHTML        = svgResult;
    keyDisplay.textContent  = `1=${targetKey}`;
    toolbarMeta.textContent = `1=${targetKey}  ${state.originalTimeStr}`;
    if (state.lastMidiRender) {
        state.lastMidiRender = { ...state.lastMidiRender, measures, keyStr: targetKey };
    }
});

// ══════════════════════════════════════════════════════════════
// --- EDITOR: Route A (click-to-edit) + Route B (text mode) ---
// ══════════════════════════════════════════════════════════════

let editModeA = false;
let popupMeasureIdx = -1;
let popupNoteIdx    = -1;
let popupDegree     = 1;
let popupAccidental = '';
let popupOctave     = 0;

// Build degree buttons 0–7
[0,1,2,3,4,5,6,7].forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'popup-btn';
    btn.dataset.deg = d;
    btn.textContent = d === 0 ? '0' : d.toString();
    popupDegreeBtns.appendChild(btn);
});

function setPopupActive(selector, attrName, value) {
    document.querySelectorAll(selector).forEach(b => {
        b.classList.toggle('active', String(b.dataset[attrName]) === String(value));
    });
}

function setEditModeA(on) {
    editModeA = on;
    editBtnA.classList.toggle('active', on);
    output.classList.toggle('edit-mode-a', on);
    if (!on) editPopup.style.display = 'none';
}

// Toggle Route A
editBtnA.addEventListener('click', () => {
    if (editTextOverlay.style.display === 'flex') { setEditModeB(false); }
    setEditModeA(!editModeA);
});

// Open popup when a note is clicked in edit mode
output.addEventListener('click', e => {
    if (!editModeA) return;
    const noteEl = e.target.closest('[data-m]');
    if (!noteEl) return;
    const m = parseInt(noteEl.dataset.m);
    const n = parseInt(noteEl.dataset.n);
    if (isNaN(m) || isNaN(n) || !state.currentMeasures?.[m]?.[n]) return;
    openPopup(state.currentMeasures[m][n], m, n, e.clientX, e.clientY);
});

function openPopup(note, m, n, cx, cy) {
    popupMeasureIdx = m;
    popupNoteIdx    = n;
    popupDegree     = note.degree;
    popupAccidental = note.accidental || '';
    popupOctave     = note.octave || 0;

    setPopupActive('#popupDegreeBtns [data-deg]', 'deg', popupDegree);
    setPopupActive('[data-acc]', 'acc', popupAccidental);
    setPopupActive('[data-oct]', 'oct', popupOctave);

    const durKey = `${note.type}|${!!note.dot}`;
    popupDuration.value = durKey;
    if (!popupDuration.value) popupDuration.value = 'quarter|false';

    const isRest = note.rest || note.degree === 0;
    popupAccRow.style.display = isRest ? 'none' : '';
    popupOctRow.style.display = isRest ? 'none' : '';

    editPopup.style.display = 'block';
    // Position: prefer bottom-right of click, keep inside viewport
    const pw = editPopup.offsetWidth  || 240;
    const ph = editPopup.offsetHeight || 260;
    let x = cx + 12, y = cy + 12;
    if (x + pw > window.innerWidth  - 8) x = cx - pw - 12;
    if (y + ph > window.innerHeight - 8) y = cy - ph - 12;
    editPopup.style.left = Math.max(8, x) + 'px';
    editPopup.style.top  = Math.max(8, y) + 'px';
}

// Popup button interactions
popupDegreeBtns.addEventListener('click', e => {
    const btn = e.target.closest('[data-deg]');
    if (!btn) return;
    popupDegree = parseInt(btn.dataset.deg);
    setPopupActive('#popupDegreeBtns [data-deg]', 'deg', popupDegree);
    const isRest = popupDegree === 0;
    popupAccRow.style.display = isRest ? 'none' : '';
    popupOctRow.style.display = isRest ? 'none' : '';
});
document.querySelectorAll('[data-acc]').forEach(btn => {
    btn.addEventListener('click', () => {
        popupAccidental = btn.dataset.acc;
        setPopupActive('[data-acc]', 'acc', popupAccidental);
    });
});
document.querySelectorAll('[data-oct]').forEach(btn => {
    btn.addEventListener('click', () => {
        popupOctave = parseInt(btn.dataset.oct);
        setPopupActive('[data-oct]', 'oct', popupOctave);
    });
});

// Close popup on outside click
document.addEventListener('mousedown', e => {
    if (editPopup.style.display !== 'none'
        && !editPopup.contains(e.target)
        && !e.target.closest('[data-m]')) {
        editPopup.style.display = 'none';
    }
});

popupCancel.addEventListener('click', () => { editPopup.style.display = 'none'; });

popupConfirm.addEventListener('click', () => {
    const m = popupMeasureIdx, n = popupNoteIdx;
    if (!state.currentMeasures?.[m]?.[n]) return;

    const [durType, durDotStr] = popupDuration.value.split('|');
    const isRest = popupDegree === 0;
    const note   = state.currentMeasures[m][n];

    note.degree     = popupDegree;
    note.rest       = isRest;
    note.accidental = isRest ? '' : popupAccidental;
    note.octave     = isRest ? 0  : popupOctave;
    note.type       = durType;
    note.dot        = durDotStr === 'true';

    // Editing commits the current (possibly transposed) version as the new original
    state.originalMeasures = state.currentMeasures;
    state.originalKeyStr   = state.currentKeyStr;
    transposeSelect.value  = '';

    output.innerHTML = renderJianpuSVG(
        state.currentMeasures, state.currentKeyStr,
        state.originalTimeStr, state.originalTitleStr || 'Untitled',
        mainContent.clientWidth, state.originalTempoStr || ""
    );
    editPopup.style.display = 'none';
});

// ─── Route B: Text edit mode ───────────────────────────────────

function serializeNoteToken(note) {
    if (note.tie) return '-';
    let tok = '';
    if (!note.rest) {
        if (note.accidental === '#') tok += '#';
        else if (note.accidental === 'b') tok += 'b';
    }
    tok += note.rest ? '0' : note.degree.toString();
    if (!note.rest) {
        if      (note.octave ===  2) tok += "''";
        else if (note.octave ===  1) tok += "'";
        else if (note.octave === -1) tok += ',';
        else if (note.octave === -2) tok += ',,';
    }
    const typeMap = { whole:'w', half:'h', quarter:'q', eighth:'e', '16th':'x', '32nd':'x' };
    const ts = typeMap[note.type] || 'q';
    if (ts !== 'q' || note.dot) tok += ts;
    if (note.dot) tok += 'd';
    return tok;
}

function serializeToText(measures, keyStr, timeStr, tempoStr) {
    const header = `Key: ${keyStr}   Time: ${timeStr}${tempoStr ? '   Tempo: ' + tempoStr : ''}`;
    let body = '';
    for (const measure of measures) {
        body += '| ';
        if (measure._multiRest !== undefined) { body += `[${measure._multiRest}] `; continue; }
        for (const note of measure) body += serializeNoteToken(note) + ' ';
    }
    body += '|';
    return header + '\n' + body;
}

function parseFromText(text) {
    const lines = text.trim().split('\n');
    const header = lines[0] || '';

    let keyStr   = state.originalKeyStr  || 'C';
    let timeStr  = state.originalTimeStr || '4/4';
    let tempoStr = state.originalTempoStr || '';

    const km = header.match(/Key:\s*([A-G][b#]?)/);
    const tm = header.match(/Time:\s*(\d+\/\d+)/);
    const pm = header.match(/Tempo:\s*(\d+)/);
    if (km) keyStr  = km[1];
    if (tm) timeStr = tm[1];
    if (pm) tempoStr = pm[1];

    const dBeats = { whole:4, half:2, quarter:1, eighth:0.5, '16th':0.25 };
    function beatsToType(b) {
        if (b >= 3.75) return { type:'whole',   dot:false };
        if (b >= 2.75) return { type:'half',    dot:true  };
        if (b >= 1.75) return { type:'half',    dot:false };
        if (b >= 1.25) return { type:'quarter', dot:true  };
        if (b >= 0.75) return { type:'quarter', dot:false };
        if (b >= 0.6 ) return { type:'eighth',  dot:true  };
        if (b >= 0.35) return { type:'eighth',  dot:false };
        return { type:'16th', dot:false };
    }

    const tokens  = lines.slice(1).join(' ').split(/\s+/).filter(Boolean);
    const measures = [];
    let current = null, lastNote = null, lastBeats = 0;

    for (const tok of tokens) {
        if (tok === '|') {
            if (current !== null && current.length > 0) {
                current._repeatStart = false; current._repeatEnd = false;
                current._direction = ''; current._dynamic = ''; current._wedge = null;
                measures.push(current);
            }
            current = []; lastNote = null; lastBeats = 0;
            continue;
        }
        if (current === null) continue;

        // Extension dash: extend previous note by 1 beat
        if (tok === '-') {
            if (lastNote) {
                lastBeats += 1;
                const { type, dot } = beatsToType(lastBeats);
                lastNote.type = type; lastNote.dot = dot;
            }
            continue;
        }

        // Multi-rest block [N]
        const mrm = tok.match(/^\[(\d+)\]$/);
        if (mrm) {
            if (current.length > 0) {
                current._repeatStart = false; current._repeatEnd = false;
                current._direction = ''; current._dynamic = ''; current._wedge = null;
                measures.push(current);
            }
            measures.push({ _multiRest: parseInt(mrm[1]) });
            current = []; lastNote = null; lastBeats = 0;
            continue;
        }

        // Parse note token: [#/b] degree ['/''/',/,,] [w/h/q/e/x] [d]
        let i = 0, acc = '';
        if (tok[i] === '#') { acc = '#'; i++; }
        else if (tok[i] === 'b' && /[0-7]/.test(tok[i+1])) { acc = 'b'; i++; }

        if (i >= tok.length || !/[0-7]/.test(tok[i])) continue;
        const deg = parseInt(tok[i]); i++;
        const isRest = deg === 0;

        let oct = 0;
        while (i < tok.length && tok[i] === "'") { oct++; i++; }
        while (i < tok.length && tok[i] === ',')  { oct--; i++; }

        const typeMap = { w:'whole', h:'half', q:'quarter', e:'eighth', x:'16th' };
        let noteType = 'quarter';
        if (i < tok.length && typeMap[tok[i]]) { noteType = typeMap[tok[i]]; i++; }
        let dot = false;
        if (i < tok.length && tok[i] === 'd') { dot = true; i++; }

        const note = {
            degree: isRest ? 0 : deg, octave: isRest ? 0 : oct,
            type: noteType, dot, tie: false, rest: isRest,
            accidental: isRest ? '' : acc, slurStart: false, slurStop: false
        };
        current.push(note);
        lastNote = note;
        lastBeats = (dBeats[noteType] || 1) * (dot ? 1.5 : 1);
    }
    if (current && current.length > 0) {
        current._repeatStart = false; current._repeatEnd = false;
        current._direction = ''; current._dynamic = ''; current._wedge = null;
        measures.push(current);
    }
    return { measures, keyStr, timeStr, tempoStr };
}

function setEditModeB(on) {
    editBtnB.classList.toggle('active', on);
    if (on) {
        if (editModeA) setEditModeA(false);
        editTextArea.value = serializeToText(
            state.currentMeasures, state.currentKeyStr,
            state.originalTimeStr, state.originalTempoStr
        );
        editTextOverlay.style.display = 'flex';
    } else {
        editTextOverlay.style.display = 'none';
    }
}

editBtnB.addEventListener('click', () => setEditModeB(editTextOverlay.style.display !== 'flex'));

editTextCancel.addEventListener('click', () => setEditModeB(false));

// Route B help modal
editHelpBtn.addEventListener('click',   () => editHelpModal.classList.add('open'));
editHelpClose.addEventListener('click', () => editHelpModal.classList.remove('open'));
editHelpModal.addEventListener('click', e => { if (e.target === editHelpModal) editHelpModal.classList.remove('open'); });

editTextSave.addEventListener('click', () => {
    try {
        const { measures, keyStr, timeStr, tempoStr } = parseFromText(editTextArea.value);
        if (!measures.length) { alert('没有找到任何小节，请检查格式。'); return; }

        state.originalMeasures = measures;
        state.originalKeyStr   = keyStr;
        state.originalTimeStr  = timeStr;
        state.originalTempoStr = tempoStr;
        state.currentMeasures  = measures;
        state.currentKeyStr    = keyStr;
        transposeSelect.value  = '';

        const svgResult = renderJianpuSVG(
            measures, keyStr, timeStr,
            state.originalTitleStr || 'Untitled',
            mainContent.clientWidth, tempoStr
        );
        output.innerHTML        = svgResult;
        keyDisplay.textContent  = `1=${keyStr}`;
        toolbarMeta.textContent = `1=${keyStr}  ${timeStr}`;
        setEditModeB(false);
    } catch(err) {
        alert('解析失败：' + err.message);
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
    emptyState.style.display = 'block';
    toolbar.style.display    = 'none';

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

