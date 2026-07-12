import { describe, expect, it } from "vitest";
import { autoFormatUserText } from "./format";

describe("autoFormatUserText", () => {
  it("quotes a bare line — the common case: you typed, so you spoke", () => {
    expect(autoFormatUserText("Where have you been?")).toBe('"Where have you been?"');
  });

  it("quotes speech around an action, leaving the action alone", () => {
    expect(autoFormatUserText("Where have you been? *I fold my arms.*")).toBe(
      '"Where have you been?" *I fold my arms.*'
    );
    expect(autoFormatUserText("*I sit down.* You look tired.")).toBe('*I sit down.* "You look tired."');
  });

  it("leaves a run that already carries quotes — inline quotation must survive", () => {
    expect(autoFormatUserText('He said "hello" to me')).toBe('He said "hello" to me');
    expect(autoFormatUserText('"Already spoken."')).toBe('"Already spoken."');
  });

  it("is idempotent (formatting an already-formatted message changes nothing)", () => {
    const once = autoFormatUserText("Hi there. *I wave.*");
    expect(autoFormatUserText(once)).toBe(once);
  });

  it("leaves a pure action alone", () => {
    expect(autoFormatUserText("*I nod slowly.*")).toBe("*I nod slowly.*");
  });

  it("matches the message's own quote style — curly in, curly out", () => {
    expect(autoFormatUserText("“Yes.” *I nod.* Then I leave.")).toBe("“Yes.” *I nod.* “Then I leave.”");
  });

  it("leaves a mixed run alone rather than fragmenting it (quotes + prose in one run)", () => {
    // the conservative rule that protects inline quotation: a run holding a quote is not
    // touched, so this stays ambiguous for the model rather than being mangled into
    // '"Then I leave."' glued onto a quoted fragment
    expect(autoFormatUserText("*I nod.* “Yes.” Then I leave.")).toBe("*I nod.* “Yes.” Then I leave.");
  });

  it("never quotes punctuation or whitespace on its own", () => {
    expect(autoFormatUserText("*I nod.* ...")).toBe("*I nod.* ...");
    expect(autoFormatUserText("*I nod.*")).toBe("*I nod.*");
    expect(autoFormatUserText("   ")).toBe("   ");
  });

  it("doesn't second-guess an unpaired asterisk", () => {
    expect(autoFormatUserText("*I reach for the door")).toBe("*I reach for the door");
  });

  it("works line by line — a quote never spans a newline", () => {
    expect(autoFormatUserText("Hello.\n\nAre you there?")).toBe('"Hello."\n\n"Are you there?"');
  });

  it("preserves surrounding whitespace when it wraps", () => {
    expect(autoFormatUserText("*I nod.* yes ")).toBe('*I nod.* "yes" ');
  });

  it("keeps @mentions intact inside the quoted text", () => {
    expect(autoFormatUserText("@Mira come here")).toBe('"@Mira come here"');
  });
});
