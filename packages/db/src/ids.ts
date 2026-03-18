import { customAlphabet } from "nanoid";

const PRETTY_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
const PRETTY_ID_SUFFIX_LENGTH = 10;

const generatePrettyIdSuffix = customAlphabet(
  PRETTY_ID_ALPHABET,
  PRETTY_ID_SUFFIX_LENGTH,
);

export function createProjectId(): string {
  return `proj_${generatePrettyIdSuffix()}`;
}

export function createThreadId(): string {
  return `thr_${generatePrettyIdSuffix()}`;
}

