// Depends on: state (declared in parser.js, must load first)
function setBtnFeedback(btn, originalText) {
    btn.textContent = 'Done ✓';
    setTimeout(() => {
        btn.textContent = originalText;
    }, 1500);
}

function triggerDownload(content, filename, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadAsImage(type, extension, btn) {
    document.fonts.ready.then(() => {
        const svgElement = output.querySelector('svg');
        if (!svgElement) return;

        const svgData = new XMLSerializer().serializeToString(svgElement);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const img = new Image();
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        img.onload = function () {
            document.fonts.ready.then(() => {
                canvas.width = svgElement.width.baseVal.value * 2;
                canvas.height = svgElement.height.baseVal.value * 2;

                const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                ctx.fillStyle = isDark ? '#111111' : '#FFFFFF';
                // Always render background so elements map properly over dark/light themes
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.scale(2, 2);
                ctx.drawImage(img, 0, 0);

                const link = document.createElement('a');
                link.download = `jianpu_score.${extension}`;
                link.href = canvas.toDataURL(type);
                link.click();
                setBtnFeedback(btn, type === 'image/png' ? '.PNG' : '.JPEG');
                URL.revokeObjectURL(url);
            });
        };

        img.src = url;
    });
}

document.getElementById('dlTxt').addEventListener('click', function () {
    triggerDownload(state.jianpuText || 'No text processed.', 'jianpu_score.txt', 'text/plain');
    setBtnFeedback(this, '.TXT');
});

document.getElementById('dlPng').addEventListener('click', function () {
    downloadAsImage('image/png', 'png', this);
});

document.getElementById('dlJpeg').addEventListener('click', function () {
    downloadAsImage('image/jpeg', 'jpg', this);
});

function printAsPDF(btn) {
    document.fonts.ready.then(() => {
        const svgElement = output.querySelector('svg');
        if (!svgElement) return;

        const svgData = new XMLSerializer().serializeToString(svgElement);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const img = new Image();
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        img.onload = function () {
            document.fonts.ready.then(() => {
                canvas.width = svgElement.width.baseVal.value * 2;
                canvas.height = svgElement.height.baseVal.value * 2;

                const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                ctx.fillStyle = '#FFFFFF'; // always white background for print
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.scale(2, 2);
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url); // done with the SVG blob

                // Use toBlob + createObjectURL instead of toDataURL —
                // dataURLs >~2MB are silently dropped across window contexts in Chrome.
                // Object URLs live in the shared blob registry and work cross-window.
                canvas.toBlob((blob) => {
                    const objectURL = URL.createObjectURL(blob);

                    setBtnFeedback(btn, '.PDF');

                    // Open the object URL directly to bypass Chrome's cross-origin restrictions
                    // on loading parent-created blobs into an about:blank popup DOM
                    const printWin = window.open(objectURL, '_blank');
                    if (!printWin) {
                        URL.revokeObjectURL(objectURL);
                        window.print(); // popup blocked — fall back
                        return;
                    }

                    // Trigger the print dialog once the browser finishes loading the image natively
                    printWin.addEventListener('load', () => {
                        printWin.print();
                    });

                    // Revoke the object URL after printing to free memory
                    printWin.addEventListener('afterprint', () => {
                        URL.revokeObjectURL(objectURL);
                    });
                }, 'image/png');


            });
        };

        img.src = url;
    });
}

document.getElementById('dlPdf').addEventListener('click', function () {
    printAsPDF(this);
});
