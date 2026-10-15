import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

test("tagged review suites cannot bypass screenshot selection with direct captures", () => {
  const violations: string[] = [];
  for (const file of readdirSync("apps/web/e2e").filter(name => name.endsWith(".spec.ts"))) {
    const sourceText = readFileSync(`apps/web/e2e/${file}`, "utf8");
    if (!/@visual|@storybook-visual/.test(sourceText)) continue;
    const diagnostics = ts.transpileModule(sourceText, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } }).diagnostics ?? [];
    assert.equal(diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error).length, 0, `${file} must remain valid TypeScript`);
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["test", "expect"].includes(node.expression.text)) {
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isIfStatement(parent) && parent.expression.getText(source).includes("PLAYWRIGHT_CAPTURE_SCREENSHOTS")) {
            violations.push(`${file}: capture selection must not guard ${node.expression.text} calls`);
          }
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "screenshot") {
        let guarded = false;
        for (let child: ts.Node = node; child.parent; child = child.parent) {
          const parent = child.parent;
          if (!ts.isIfStatement(parent) || child !== parent.thenStatement) continue;
          const condition = parent.expression;
          if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken && condition.left.getText(source) === "process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS" && ts.isStringLiteral(condition.right) && condition.right.text === "false") guarded = true;
        }
        if (!guarded) violations.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(violations, [], "Review captures must be guarded while assertions remain outside the guard.");
});
