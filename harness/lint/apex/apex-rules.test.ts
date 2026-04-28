import { describe, it, expect } from "vitest";
import { sharingMissing } from "./sharing-missing.js";
import { hardcodedId } from "./hardcoded-id.js";
import { dynamicSoqlUnsafe } from "./dynamic-soql-unsafe.js";

describe("sharingMissing", () => {
  it("flags class without sharing modifier", () => {
    const f = sharingMissing.apply({
      file: "Foo.cls",
      source: "public class Foo { }",
    });
    expect(f).toHaveLength(1);
    expect(f[0].symbol).toBe("Foo");
  });

  it("does not flag class with `with sharing`", () => {
    const f = sharingMissing.apply({
      file: "Foo.cls",
      source: "public with sharing class Foo { }",
    });
    expect(f).toHaveLength(0);
  });

  it("does not flag `without sharing` or `inherited sharing`", () => {
    expect(
      sharingMissing.apply({ file: "X.cls", source: "public without sharing class X {}" }),
    ).toHaveLength(0);
    expect(
      sharingMissing.apply({ file: "Y.cls", source: "public inherited sharing class Y {}" }),
    ).toHaveLength(0);
  });

  it("skips test classes", () => {
    expect(
      sharingMissing.apply({
        file: "FooTest.cls",
        source: "@IsTest\npublic class FooTest { }",
      }),
    ).toHaveLength(0);
  });
});

describe("hardcodedId", () => {
  it("flags 18-char SF ID literal with valid prefix", () => {
    const f = hardcodedId.apply({
      file: "RT.cls",
      source: "public class RT { static Id X = '012FIXTURE00000001'; }",
    });
    expect(f).toHaveLength(1);
    expect(f[0].symbol).toBe("RT");
  });

  it("flags 15-char SF ID literal", () => {
    const f = hardcodedId.apply({
      file: "RT.cls",
      source: "public class RT { static Id X = '001000000000001'; }",
    });
    expect(f).toHaveLength(1);
  });

  it("does not flag arbitrary 18-char string with invalid prefix", () => {
    const f = hardcodedId.apply({
      file: "X.cls",
      source: "public class X { String s = 'helloWorldExample42'; }",
    });
    expect(f).toHaveLength(0);
  });

  it("does not flag short literals", () => {
    expect(
      hardcodedId.apply({ file: "X.cls", source: "String s = 'short';" }),
    ).toHaveLength(0);
  });
});

describe("dynamicSoqlUnsafe", () => {
  it("flags Database.query with concat and no escape", () => {
    const src = `public class S {
      public static List<Account> q(String n) {
        String soql = 'SELECT Id FROM Account WHERE Name = \\'' + n + '\\'';
        return Database.query(soql);
      }
    }`;
    const f = dynamicSoqlUnsafe.apply({ file: "S.cls", source: src });
    expect(f).toHaveLength(1);
  });

  it("does not flag when escapeSingleQuotes is in scope", () => {
    const src = `public class S {
      public static List<Account> q(String n) {
        String safe = String.escapeSingleQuotes(n);
        String soql = 'SELECT Id FROM Account WHERE Name = \\'' + safe + '\\'';
        return Database.query(soql);
      }
    }`;
    const f = dynamicSoqlUnsafe.apply({ file: "S.cls", source: src });
    expect(f).toHaveLength(0);
  });

  it("does not flag literal-only query", () => {
    const src = `Database.query('SELECT Id FROM Account')`;
    expect(dynamicSoqlUnsafe.apply({ file: "X.cls", source: src })).toHaveLength(0);
  });
});
