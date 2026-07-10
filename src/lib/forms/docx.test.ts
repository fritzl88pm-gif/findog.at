import { describe, expect, it } from "vitest";
import PizZip from "pizzip";

import { renderVerf5Document } from "./docx";

function minimalDocxWithSplitTags(): Uint8Array {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>{{da</w:t></w:r><w:r><w:t>tum}}</w:t></w:r></w:p>
        <w:p><w:r><w:t>{{steuer</w:t></w:r><w:r><w:t>nummer}}</w:t></w:r></w:p>
        <w:p><w:r><w:t>{{vorname}} {{nachname}}</w:t></w:r></w:p>
        <w:p><w:r><w:t>{{letzte</w:t></w:r><w:r><w:t>adresse}}</w:t></w:r></w:p>
        <w:p><w:r><w:t>{{sterbedatum}}</w:t></w:r></w:p>
        <w:p><w:r><w:t>{{sal</w:t></w:r><w:r><w:t>do}}€</w:t></w:r></w:p>
        <w:sectPr/>
      </w:body>
    </w:document>`,
  );

  return zip.generate({ type: "uint8array" });
}

describe("Verf 5 DOCX rendering", () => {
  it("replaces placeholders even when Word splits them across text runs", () => {
    const rendered = renderVerf5Document(minimalDocxWithSplitTags(), {
      datum: "10.07.2026",
      steuernummer: "12 345/6789",
      vorname: "Anna",
      nachname: "Muster",
      letzteadresse: "Hauptstraße 1, 1010 Wien",
      sterbedatum: "03.04.2026",
      saldo: "1.234,56 ",
    });

    const documentXml = new PizZip(rendered).file("word/document.xml")?.asText() ?? "";
    const visibleText = documentXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    expect(visibleText).toContain("10.07.2026");
    expect(visibleText).toContain("12 345/6789");
    expect(visibleText).toContain("Anna Muster");
    expect(visibleText).toContain("Hauptstraße 1, 1010 Wien");
    expect(visibleText).toContain("03.04.2026");
    expect(visibleText).toContain("1.234,56 €");
    expect(documentXml).not.toContain("{{");
  });
});
