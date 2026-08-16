import manifest from "../agent-front-door/manifest.json";
import llmsFull from "../agent-front-door/llms-full.txt?raw";
import llmsText from "../agent-front-door/llms.txt?raw";
import deploy from "../../DEPLOY.md?raw";
import design from "../../DESIGN.md?raw";
import philosophy from "../../PHILOSOPHY.md?raw";
import gettingStarted from "../../docs/GETTING-STARTED.md?raw";
import readme from "../../README.md?raw";
import skill from "../../SKILL.md?raw";

const rawBySource: Record<string, string> = {
  "README.md": readme,
  "docs/GETTING-STARTED.md": gettingStarted,
  "PHILOSOPHY.md": philosophy,
  "DESIGN.md": design,
  "DEPLOY.md": deploy,
};

export interface ServedDocument {
  url: string;
  source: string;
  content: string;
}

/** A self-locating header makes a fetched document useful outside its repo. */
export function canonicalDocumentHeader(source: string, url: string): string {
  return `<!-- Canonical source: ${source}; served at ${url}. -->\n`;
}

export const servedDocuments: readonly ServedDocument[] = manifest.map((entry) => {
  const source = rawBySource[entry.source];
  if (source === undefined) throw new Error(`No raw import for served document ${entry.source}`);
  return {
    ...entry,
    content: `${canonicalDocumentHeader(entry.source, entry.url)}${source}`,
  };
});

export const generatedLlmsText = llmsText;
export const generatedLlmsFullText = llmsFull;
export const shippedSkill = skill;
