import fs from "node:fs";
import path from "node:path";
import * as acorn from "../web/node_modules/acorn/dist/acorn.mjs";
import { createHash } from "node:crypto";
const argument = process.argv.indexOf("--source-root");
if (argument < 0) throw Error("--source-root required");
const root = process.argv[argument + 1];
if (!root) throw Error("--source-root required");
const definitions = {};
for (const file of fs
  .readdirSync(path.join(root, "src/engine/core"))
  .filter((x) => x.endsWith(".js"))) {
  const text = fs.readFileSync(
    path.join(root, "src/engine/core", file),
    "utf8",
  );
  const ast = acorn.parse(text, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  function value(n) {
    if (n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression")
      return {
        expression: `Unsupported source ${n.type}`,
        sourceSha256: createHash("sha256")
          .update(text.slice(n.start, n.end))
          .digest("hex"),
      };
    if (n.type === "Literal") return n.value;
    if (n.type === "BinaryExpression") {
      const a = value(n.left),
        b = value(n.right);
      if (typeof a === "number" && typeof b === "number") {
        if (n.operator === "+") return a + b;
        if (n.operator === "-") return a - b;
        if (n.operator === "*") return a * b;
        if (n.operator === "/") return a / b;
      }
    }
    if (n.type === "NewExpression") {
      const name = text.slice(n.callee.start, n.callee.end);
      if (
        ["Pioneer.Vector3", "Pioneer.Quaternion", "Pioneer.LatLonAlt"].includes(
          name,
        )
      )
        return {
          constructor: name.split(".").at(-1),
          values: n.arguments.map(value),
        };
    }

    if (n.type === "ArrayExpression") return n.elements.map(value);
    if (n.type === "ObjectExpression")
      return Object.fromEntries(
        n.properties
          .filter((p) => p.type === "Property")
          .map((p) => [p.key.name ?? p.key.value, value(p.value)]),
      );
    if (n.type === "UnaryExpression" && n.operator === "void") return null;
    if (n.type === "UnaryExpression" && n.operator === "-") {
      const v = value(n.argument);
      if (typeof v === "number") return -v;
    }
    const expr = text.slice(n.start, n.end);
    if (expr === "Math.PI") return Math.PI;
    if (expr === "Pioneer.Vector3.Zero")
      return { constructor: "Vector3", values: [0, 0, 0] };
    if (expr === "Pioneer.Quaternion.Identity")
      return { constructor: "Quaternion", values: [1, 0, 0, 0] };

    if (expr === "Number.NEGATIVE_INFINITY" || expr === "-Infinity")
      return "-Infinity";
    if (expr === "Number.POSITIVE_INFINITY" || expr === "Infinity")
      return "Infinity";
    return { expression: expr };
  }
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (
      n.type === "CallExpression" &&
      text.slice(n.callee.start, n.callee.end) === "Entity.Entity.register" &&
      n.arguments[0]?.type === "ObjectExpression"
    ) {
      for (const [id, d] of Object.entries(value(n.arguments[0])))
        definitions[id] = { ...d, sourceFile: file };
    }
    for (const v of Object.values(n))
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
  }
  walk(ast);
}
const source = JSON.parse(
  fs.readFileSync(path.join(root, "src/data/EntityCatalog.json"), "utf8"),
);
const targets = Object.values(source).filter((x) =>
  ["Moon", "Spacecraft"].includes(x.category),
);
fs.writeFileSync(
  new URL("../platform/eyes-catalog.json", import.meta.url),
  JSON.stringify(
    { source: "Eyes static AST; modules never executed", targets, definitions },
    null,
    2,
  ) + "\n",
);
