/**
 * openapi.yaml as executable schemas. The server validates request bodies with it, and tests check
 * every response against it, so the spec stays the source of truth for the wire format.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { parse } from 'yaml';

// ajv ships CommonJS: Node's default import is module.exports, and ajv also sets exports.default to the class.
const Ajv2020 = Ajv2020Module.default;

export const OPENAPI_PATH = fileURLToPath(new URL('../../../openapi.yaml', import.meta.url));
const DOC_ID = 'openapi.yaml';
// RFC 3339 date-time, as OpenAPI's `format: date-time` requires.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

type JsonObject = Record<string, unknown>;

export interface OpenApiDoc {
  paths: Record<string, Record<string, { responses?: Record<string, JsonObject> }>>;
  components: {
    schemas: Record<string, JsonObject>;
    responses: Record<string, JsonObject>;
    examples: Record<string, unknown>;
    'x-error-codes': { codes: Record<string, number> };
  };
}

export interface Violation {
  /** JSON pointer to the offending field, e.g. "/to". Empty for the body itself. */
  path: string;
  message: string;
}

export type ActionCheck = { ok: true; type: string } | ({ ok: false } & Violation);

const escapePointer = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

export class Spec {
  readonly doc: OpenApiDoc;
  private readonly ajv: InstanceType<typeof Ajv2020>;
  private readonly compiled = new Map<string, ValidateFunction>();

  private constructor(doc: OpenApiDoc) {
    this.doc = doc;
    this.ajv = new Ajv2020({ strict: false, allErrors: false });
    this.ajv.addFormat('date-time', DATE_TIME);
    this.ajv.addSchema(doc as unknown as JsonObject, DOC_ID);
  }

  static load(file = OPENAPI_PATH): Spec {
    return new Spec(parse(readFileSync(file, 'utf8')) as OpenApiDoc);
  }

  /** Validates `value` against a JSON pointer into the spec, e.g. "#/components/schemas/Rules". */
  check(pointer: string, value: unknown): Violation | null {
    let validate = this.compiled.get(pointer);
    if (validate === undefined) {
      validate = this.ajv.compile({ $ref: `${DOC_ID}${pointer}` });
      this.compiled.set(pointer, validate);
    }
    if (validate(value)) return null;
    const e = validate.errors?.[0];
    if (!e) return { path: '', message: 'invalid' };
    const missing = e.keyword === 'required' ? (e.params as { missingProperty?: string }).missingProperty : undefined;
    return { path: missing ? `${e.instancePath}/${missing}` : e.instancePath, message: e.message ?? 'invalid' };
  }

  /** Validates an action body against the schema its `type` selects (the spec's discriminator mapping). */
  checkAction(body: unknown): ActionCheck {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, path: '', message: 'The body must be one JSON object.' };
    }
    const type = (body as JsonObject).type;
    if (typeof type !== 'string') return { ok: false, path: '/type', message: "must have required property 'type'" };
    const action = this.doc.components.schemas.Action as { discriminator: { mapping: Record<string, string> } };
    const ref = action.discriminator.mapping[type];
    if (!ref) return { ok: false, path: '/type', message: `unknown action type "${type}"` };
    const problem = this.check(ref, body);
    return problem ? { ok: false, ...problem } : { ok: true, type };
  }

  /** Checks a response body against the schema declared for that operation and status. */
  checkResponse(method: string, path: string, status: number, body: unknown): Violation | null {
    const op = this.doc.paths[path]?.[method.toLowerCase()];
    if (!op) return { path: '', message: `openapi.yaml has no ${method.toUpperCase()} ${path}` };
    let response = op.responses?.[String(status)];
    if (!response) return { path: '', message: `openapi.yaml declares no ${status} response for ${method.toUpperCase()} ${path}` };
    let pointer = `#/paths/${escapePointer(path)}/${method.toLowerCase()}/responses/${status}`;
    const ref = response.$ref;
    if (typeof ref === 'string') {
      pointer = ref;
      response = this.doc.components.responses[ref.split('/').pop() as string] as JsonObject;
    }
    const content = (response.content as Record<string, unknown> | undefined)?.['application/json'];
    if (!content) return { path: '', message: `the ${status} response has no application/json body` };
    return this.check(`${pointer}/content/application~1json/schema`, body);
  }

  /** The `x-error-codes` table: code → HTTP status. */
  errorCodes(): Record<string, number> {
    return { ...this.doc.components['x-error-codes'].codes };
  }
}
