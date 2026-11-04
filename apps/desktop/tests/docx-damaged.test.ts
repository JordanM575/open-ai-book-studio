import { describe, expect, test } from "bun:test";
import { Document, Packer, Paragraph } from "docx";
import { strToU8, unzipSync, zipSync } from "fflate";
import { readDocxSource } from "../src/main/docx-import";

/*
 * A Word file can be a sound package around a document Word itself could not open. The import
 * must refuse it in the author's words rather than import a fragment or show a parser error.
 */

async function wordFile(text: string): Promise<Uint8Array> {
  const document = new Document({ sections: [{ children: [new Paragraph(text)] }] });
  return new Uint8Array(await Packer.toBuffer(document));
}

describe("a damaged Word document", () => {
  test("whose text cannot be parsed is refused as damaged, with what to do", async () => {
    const sound = await wordFile("The tide was out.");
    expect((await readDocxSource("The Salt Road.docx", sound)).status).toBe("validated");

    const damaged = zipSync({ ...unzipSync(sound), "word/document.xml": strToU8("<w:document") });
    expect(await readDocxSource("The Salt Road.docx", damaged)).toEqual({
      status: "refused",
      reason: "corrupt",
      message: "“The Salt Road.docx” is damaged and cannot be read. Open it in Word, save a new copy and choose that."
    });
  });
});
