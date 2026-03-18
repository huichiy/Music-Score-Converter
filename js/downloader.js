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
                // Generate data URL from the canvas
                const dataURL = canvas.toDataURL('image/png');
                
                setBtnFeedback(btn, '.PDF');

                // Create a temporary full-screen print frame right on the main page.
                // This avoids Chrome's popup cross-origin blob restrictions completely.
                const printFrame = document.createElement('div');
                printFrame.id = 'jianpuPrintFrame';
                printFrame.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:9999;background:#fff;';

                const printImg = document.createElement('img');
                printImg.style.cssText = 'width:100%;display:block;';
                
                // Trigger print ONLY after the image has been fully decoded and painted.
                // Two requestAnimationFrames guarantee the browser has actually composited 
                // the new DOM elements onto the screen before capturing the print snapshot.
                printImg.onload = () => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            window.print();
                        });
                    });
                };

                printImg.src = dataURL;
                printFrame.appendChild(printImg);

                document.body.appendChild(printFrame);

                // Clean up the frame once the print dialog closes
                const cleanup = () => {
                    printFrame.remove();
                    window.removeEventListener('afterprint', cleanup);
                };
                window.addEventListener('afterprint', cleanup);


            });
        };

        img.src = url;
    });
}

document.getElementById('dlPdf').addEventListener('click', function () {
    printAsPDF(this);
});
