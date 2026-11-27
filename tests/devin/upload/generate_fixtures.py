from pathlib import Path
import sys
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

from PIL import Image, ImageDraw, ImageFont


root = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path.home() / 'qa-fixtures'
root.mkdir(parents=True, exist_ok=True)
title = "SYNTHETIC TEST — Jane Testparent, Fictional CAS"
lines = [
    title,
    "Fictional CAS sample letter — not a real case record.",
    "Reference: QA-DEMO-001 | Date: 15 January 2026",
    "Dear Jane Testparent,",
    "This letter confirms a fictional meeting for upload QA only.",
    "No real person, case, legal finding, or appointment is represented.",
]


def stream(data):
    return b"<< /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"


def make_pdf(pages, target_size=None):
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", None,
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    kids = []
    for page in pages:
        idx = len(objects) + 1
        kids.append(f"{idx} 0 R".encode())
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                       f"/Resources << /Font << /F1 3 0 R >> >> /Contents {idx+1} 0 R >>".encode())
        text = b"\nT*\n".join(b"(" + line.encode("cp1252") + b") Tj" for line in page)
        objects.append(stream(b"BT /F1 12 Tf 18 TL 48 728 Td\n" + text + b"\nET"))
    objects[1] = b"<< /Type /Pages /Count %d /Kids [" % len(kids) + b" ".join(kids) + b"] >>"
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, 1):
        offsets.append(len(out))
        out.extend(b"%d 0 obj\n" % idx + obj + b"\nendobj\n")

    def trailer(start):
        return (b"xref\n0 %d\n" % len(offsets) + b"0000000000 65535 f \n"
                + b"".join(b"%010d 00000 n \n" % v for v in offsets[1:])
                + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(offsets), start))

    if target_size:
        padding = target_size - len(out) - len(trailer(target_size))
        out.extend(b" " * padding)
    out.extend(trailer(len(out)))
    assert target_size is None or len(out) == target_size
    return out


pages = [
    lines + ["Native-text PDF — Page 1: fictional correspondence."],
    [title, "Native-text PDF — Page 2: fictional meeting agenda.",
     "The second page includes the unique extraction marker QA-PAGE-TWO."],
]
(root / "synthetic-cas-letter.pdf").write_bytes(make_pdf(pages))
(root / "synthetic-oversized.pdf").write_bytes(make_pdf(pages, 20 * 1024 * 1024 + 1))
(root / "synthetic-empty.pdf").write_bytes(b"")
(root / "synthetic-corrupted.pdf").write_bytes(
    b"%PDF-1.4\n% " + title.encode() + b"\n1 0 obj\n<< /Type /Catalog /Pages\n"
)
(root / "synthetic-cas-letter.txt").write_text(
    "\n".join(lines + ["Français : Réunion fictive à Montréal, élève, pièce jointe, Noël."]) + "\n",
    encoding="utf-8",
)

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 25)
image = Image.new("RGB", (1224, 1584), "white")
draw = ImageDraw.Draw(image)
draw.multiline_text((70, 100), "\n\n".join(lines), font=font, fill="black")
image.save(root / "synthetic-cas-letter.png")
image.save(root / "synthetic-cas-letter.jpg", quality=92)
image.save(root / "synthetic-cas-scanned.pdf", resolution=144,
           title=title, author="Synthetic QA")
(root / "synthetic-wrong-extension.pdf").write_bytes((root / "synthetic-cas-letter.jpg").read_bytes())

word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
with ZipFile(root / "synthetic-cas-letter.docx", "w", ZIP_DEFLATED) as docx:
    docx.writestr("[Content_Types].xml", """
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""".strip())
    docx.writestr("_rels/.rels", """
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""".strip())
    paragraphs = "".join(f"<w:p><w:r><w:t>{escape(line)}</w:t></w:r></w:p>" for line in lines)
    docx.writestr("word/document.xml",
                  f'<w:document xmlns:w="{word}"><w:body>{paragraphs}<w:sectPr/></w:body></w:document>')
