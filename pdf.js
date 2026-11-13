/* Minimal single-page A4 PDF writer (embeds one JPEG). No dependencies. */
(function (root) {
  "use strict";
  // jpeg: Uint8Array, imgW/imgH: pixels, landscape: boolean -> Uint8Array (PDF file)
  function makePdf(jpeg, imgW, imgH, landscape) {
    const pw = landscape ? 842 : 595, ph = landscape ? 595 : 842; // A4 in points
    const enc = new TextEncoder();
    const parts = [], offsets = [];
    let len = 0;
    const push = (u8) => { parts.push(u8); len += u8.length; };
    const text = (s) => push(enc.encode(s));
    const obj = (n, body) => { offsets[n] = len; text(n + " 0 obj\n" + body + "\nendobj\n"); };

    text("%PDF-1.4\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pw + " " + ph + "] " +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
    offsets[4] = len;
    text("4 0 obj\n<< /Type /XObject /Subtype /Image /Width " + imgW + " /Height " + imgH +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>\nstream\n");
    push(jpeg);
    text("\nendstream\nendobj\n");
    const content = "q " + pw + " 0 0 " + ph + " 0 0 cm /Im0 Do Q";
    obj(5, "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");

    const xref = len;
    let x = "xref\n0 6\n0000000000 65535 f \n";
    for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    text(x + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");

    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  root.A4Pdf = { make: makePdf };
  if (typeof module !== "undefined") module.exports = root.A4Pdf;
})(typeof window !== "undefined" ? window : globalThis);
