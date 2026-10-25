/* global Tesseract, jspdf */
(function () {
  'use strict';
  const KEYWORDS = {
    cedula: /c[eé]dula|ciudadan[ií]a|registradur[ií]a|rep[uú]blica\s+de\s+colombia/i,
    pase: /licencia|conducci[oó]n|ministerio\s+de\s+transporte|mintransporte|rep[uú]blica\s+de\s+colombia/i
  };
  const bad = message => ({ ok: false, message: message });

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No fue posible leer la imagen.')); };
      image.src = url;
    });
  }

  function sharpness(image) {
    const scale = Math.min(1, 700 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const grey = new Float32Array(width * height);
    for (let i = 0; i < grey.length; i++) {
      const p = i * 4;
      grey[i] = pixels[p] * .299 + pixels[p + 1] * .587 + pixels[p + 2] * .114;
    }
    let sum = 0, squares = 0, count = 0;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const laplacian = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width];
      sum += laplacian; squares += laplacian * laplacian; count++;
    }
    return squares / count - Math.pow(sum / count, 2);
  }

  async function inspect(file) {
    if (!file || !file.type.startsWith('image/')) return bad('Usa una foto en JPG, PNG o WebP; el documento debe poder verificarse.');
    const image = await loadImage(file);
    if (Math.max(image.naturalWidth, image.naturalHeight) < 1200 || Math.min(image.naturalWidth, image.naturalHeight) < 600) {
      return bad('La foto tiene poca resolución. Tómala de cerca, con el documento completo y buena luz.');
    }
    if (sharpness(image) < 28) return bad('La foto está borrosa. Enfoca el documento, evita reflejos y vuelve a tomarla.');
    if (!window.Tesseract) return bad('No fue posible iniciar la revisión automática. Revisa tu conexión e intenta de nuevo.');
    const ocr = await window.Tesseract.recognize(file, 'spa');
    const text = (ocr.data.text || '').replace(/\s+/g, ' ').trim();
    if (ocr.data.confidence < 42 || text.length < 25) return bad('No se alcanza a leer el documento. Tómalo de frente, sin reflejos y con buena luz.');
    return { ok: true, text: text };
  }

  async function validatePair(front, back, kind, expectedId, progress) {
    progress && progress('Revisando la primera cara…');
    const first = await inspect(front); if (!first.ok) return first;
    progress && progress('Revisando la segunda cara…');
    const second = await inspect(back); if (!second.ok) return second;
    const text = first.text + ' ' + second.text;
    if (!KEYWORDS[kind].test(text)) {
      return bad(kind === 'cedula' ? 'Las fotos no parecen corresponder a una cédula colombiana.' : 'Las fotos no parecen corresponder a una licencia de conducción.');
    }
    const digits = text.replace(/\D/g, '');
    if (expectedId && !digits.includes(expectedId)) {
      return bad('El número de documento no se pudo confirmar en las fotos. Verifica que sean del titular y se lean completamente.');
    }
    return { ok: true };
  }

  function asDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('No fue posible crear el PDF.'));
      reader.readAsDataURL(file);
    });
  }

  async function createPdf(front, back, title) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('No fue posible iniciar el generador de PDF.');
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title: title, subject: 'Documentos de vinculación' });
    for (const [index, file] of [front, back].entries()) {
      if (index) pdf.addPage();
      const image = await loadImage(file), data = await asDataUrl(file), ratio = image.naturalWidth / image.naturalHeight;
      let width = 190, height = width / ratio;
      if (height > 250) { height = 250; width = height * ratio; }
      pdf.setFontSize(11); pdf.text(title + (index ? ' - Reverso' : ' - Frente'), 10, 14);
      const format = file.type === 'image/png' ? 'PNG' : file.type === 'image/webp' ? 'WEBP' : 'JPEG';
      pdf.addImage(data, format, (210 - width) / 2, 22, width, height, undefined, 'FAST');
    }
    return pdf.output('blob');
  }
  window.DocumentValidation = { validatePair, createPdf };
})();
