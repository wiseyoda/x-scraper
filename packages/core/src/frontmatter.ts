/**
 * YAML frontmatter codec.
 *
 * Markdown is canonical (per ARCHITECTURE.md), so this codec is the
 * round-trip contract: vault writes serialise here, vault reads parse
 * here. Frontmatter validation is enforced by the Zod schemas in
 * `frontmatter-schemas.ts`.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const FRONTMATTER_DELIMITER = '---';
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  body: string;
}

export const parseDocument = (raw: string): ParsedDocument => {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const [, fm = '', rawBody = ''] = match;
  const frontmatter = (parseYaml(fm) as Record<string, unknown> | null) ?? {};
  // Strip the optional blank line that conventionally separates the
  // closing fence from the body, plus normalise CRLF for downstream code.
  const body = rawBody.replace(/^\r?\n/, '').replace(/\r\n/g, '\n');
  return { frontmatter, body };
};

export const formatDocument = (doc: ParsedDocument): string => {
  const yaml = stringifyYaml(doc.frontmatter, { lineWidth: 0 }).trimEnd();
  const body = doc.body.startsWith('\n') ? doc.body.slice(1) : doc.body;
  return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n\n${body}`.replace(
    /\n+$/,
    '\n',
  );
};
