/**
 * A tiny line-by-line syntax tokenizer for the diff viewer.
 *
 * It highlights strings, numbers, comments, keywords and type-like names for the common
 * language families, and leaves everything else plain. It works one line at a time, so
 * constructs that span lines (block comments, template literals, docstrings) are only
 * coloured on the lines where they open and close. That is a deliberate trade for a
 * dependency-free viewer; unknown file types are shown without colour.
 */
export type TokenKind = "kw" | "str" | "num" | "com" | "type" | "key";
export interface Token {
  text: string;
  kind?: TokenKind;
}
export type Lang = "c" | "hash" | "json" | "css" | "markup" | "sql";

const EXT: Record<string, Lang> = {
  js: "c", jsx: "c", mjs: "c", cjs: "c", ts: "c", tsx: "c", java: "c", kt: "c", go: "c", rs: "c",
  c: "c", h: "c", cpp: "c", cc: "c", hpp: "c", cs: "c", swift: "c", php: "c", scala: "c", dart: "c",
  py: "hash", rb: "hash", sh: "hash", bash: "hash", zsh: "hash", yml: "hash", yaml: "hash",
  toml: "hash", ini: "hash", conf: "hash", mk: "hash",
  json: "json", jsonc: "json",
  css: "css", scss: "css", less: "css",
  html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup",
  sql: "sql",
};

export function langFor(path: string): Lang | null {
  const name = path.split("/").pop() ?? path;
  if (name === "Makefile" || name === "Dockerfile") return "hash";
  const dot = name.lastIndexOf(".");
  if (dot === -1) return null;
  return EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

const KEYWORDS: Record<Lang, Set<string>> = {
  c: new Set(
    "abstract as async await break case catch class const continue crate debugger default defer delete do else enum export extends false final finally fn for from func function go if impl implements import in instanceof interface let loop match mod mut namespace new nil null of override package private protected pub public readonly return self static struct super switch this throw trait true try type typeof undefined use var void volatile where while with yield".split(" ")
  ),
  hash: new Set(
    "and as assert async await break case class continue def del do done elif else end esac except export fi finally for from function global if import in is lambda local nil not or pass raise return self then true false try unless until when while with yield None True False".split(" ")
  ),
  json: new Set(["true", "false", "null"]),
  css: new Set(["important", "inherit", "initial", "none", "auto"]),
  markup: new Set(),
  sql: new Set(
    "add all alter and as asc between by case create delete desc distinct drop else end exists from group having in index inner insert into is join left like limit not null on or order outer primary references right select set table then union unique update values when where".split(" ")
  ),
};

function tokenRegex(lang: Lang): RegExp {
  const str = `"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'`;
  const num = `\\b0x[0-9a-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b`;
  const ident = `[A-Za-z_$][\\w$]*`;
  switch (lang) {
    case "c":
      return new RegExp(`(\\/\\/.*$|\\/\\*.*?(?:\\*\\/|$))|(${str}|\`(?:\\\\.|[^\`\\\\])*\`?)|(${num})|(${ident})`, "g");
    case "hash":
      return new RegExp(`(#.*$)|(${str})|(${num})|(${ident})`, "g");
    case "sql":
      return new RegExp(`(--.*$)|(${str})|(${num})|(${ident})`, "g");
    case "css":
      return new RegExp(`(\\/\\*.*?(?:\\*\\/|$))|(${str})|(#[0-9a-fA-F]{3,8}\\b|\\b\\d[\\d.]*(?:px|rem|em|%|vh|vw|s|ms)?\\b)|(@?[A-Za-z-]+)`, "g");
    case "json":
      return new RegExp(`()(${str})|(${num})|(${ident})`, "g");
    case "markup":
      return new RegExp(`(<!--.*?(?:-->|$))|(${str})|()(<\\/?[A-Za-z][\\w:-]*)`, "g");
  }
}

const cache = new Map<Lang, RegExp>();

export function highlightLine(line: string, lang: Lang | null): Token[] {
  if (!lang || line.length === 0 || line.length > 600) return [{ text: line }];
  let re = cache.get(lang);
  if (!re) cache.set(lang, (re = tokenRegex(lang)));
  re.lastIndex = 0;

  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    const [text, com, str, num, word] = m;
    let kind: TokenKind | undefined;
    if (com) kind = "com";
    else if (str) {
      kind = "str";
      // In JSON an object key is a string followed by a colon.
      if (lang === "json" && /^\s*:/.test(line.slice(m.index + text.length))) kind = "key";
    } else if (num) kind = "num";
    else if (word) {
      if (lang === "markup") kind = "kw";
      else if (lang === "css") kind = word.startsWith("@") || KEYWORDS.css.has(word) ? "kw" : undefined;
      else if (KEYWORDS[lang].has(lang === "sql" ? word.toLowerCase() : word)) kind = "kw";
      else if (/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(word)) kind = "type";
    }
    out.push({ text, kind });
    last = m.index + text.length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

export const TOKEN_CLASS: Record<TokenKind, string> = {
  kw: "text-violet",
  str: "text-warn",
  num: "text-blue",
  com: "text-faint italic",
  type: "text-accent",
  key: "text-blue",
};
