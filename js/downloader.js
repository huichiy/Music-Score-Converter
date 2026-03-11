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

document.getElementById('dlPdf').addEventListener('click', function () {
    window.print();
    setBtnFeedback(this, '.PDF');
});
