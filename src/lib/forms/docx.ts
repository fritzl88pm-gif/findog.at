import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

import { type ExtractedVerf5Fields } from "./extraction";

export type Verf5TemplateData = ExtractedVerf5Fields & {
  datum: string;
  saldo: string;
};

export function renderVerf5Document(
  template: Uint8Array,
  data: Verf5TemplateData,
): Uint8Array {
  const zip = new PizZip(template);
  const document = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
  });

  document.render(data);

  return document.getZip().generate({
    type: "uint8array",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
