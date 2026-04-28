import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { lintFixture } from "../lint/run.js";
import { Expected } from "../contracts/expected.js";
import { score, type ScoreReport } from "./score.js";

export interface FixtureResult {
  name: string;
  path: string;
  expected: ReturnType<typeof Expected.parse>;
  actualCount: number;
  report: ScoreReport;
}

export function runAllFixtures(rootDir: string): FixtureResult[] {
  const fixtures = readdirSync(rootDir).filter((entry) => {
    const p = join(rootDir, entry);
    return statSync(p).isDirectory();
  });

  return fixtures.map((name) => {
    const path = join(rootDir, name);
    const expected = Expected.parse(
      JSON.parse(readFileSync(join(path, "expected.json"), "utf8")),
    );
    const actual = lintFixture(path);
    const report = score(expected, actual);
    return { name, path, expected, actualCount: actual.length, report };
  });
}
