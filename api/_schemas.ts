// JSON schemas for Claude structured output (output_config.format).
// RULES: every object sets additionalProperties:false and lists ALL keys in
// "required". No minLength/maxLength/minimum/maximum/multipleOf/recursive.
// Allowed: object, array, string, integer, number, boolean, enum.

export const DELIVERED_TO_VALUES = [
  "Independent",
  "Supervised",
  "Production-ready under supervision",
] as const;

export const GATE_TYPE_VALUES = [
  "auto_pass",
  "trainer_review",
  "cross_track",
] as const;

export const EXERCISE_TYPE_VALUES = ["code", "rag", "agent", "judge"] as const;

/** Canonical role shape. */
export const CANONICAL_ROLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "role_family",
    "primary_stack",
    "responsibilities",
    "skill_matrix",
    "milestones",
  ],
  properties: {
    title: { type: "string" },
    role_family: { type: "string" },
    primary_stack: { type: "array", items: { type: "string" } },
    responsibilities: { type: "array", items: { type: "string" } },
    skill_matrix: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["skill_area", "delivered_to"],
        properties: {
          skill_area: { type: "string" },
          delivered_to: { type: "string", enum: [...DELIVERED_TO_VALUES] },
        },
      },
    },
    milestones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "indicator"],
        properties: {
          name: { type: "string" },
          indicator: { type: "string" },
        },
      },
    },
  },
} as const;

/** Rubric shape (reused for exercise rubric + refinement). */
export const RUBRIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["criteria"],
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "weight", "description"],
        properties: {
          name: { type: "string" },
          weight: { type: "number" },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

/**
 * A single lesson block. A lesson is an ordered array of these. Each branch is
 * an object with additionalProperties:false and ALL keys in "required". `type`
 * is pinned via a single-value enum (equivalent to const, definitely supported).
 */
export const LESSON_BLOCK_SCHEMA = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "text"],
      properties: {
        type: { type: "string", enum: ["markdown"] },
        text: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "language", "code"],
      properties: {
        type: { type: "string", enum: ["code"] },
        language: { type: "string" },
        code: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "url", "caption"],
      properties: {
        type: { type: "string", enum: ["video_embed"] },
        url: { type: "string" },
        caption: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "url", "alt"],
      properties: {
        type: { type: "string", enum: ["image"] },
        url: { type: "string" },
        alt: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "variant", "text"],
      properties: {
        type: { type: "string", enum: ["callout"] },
        variant: { type: "string", enum: ["info", "warning", "tip"] },
        text: { type: "string" },
      },
    },
  ],
} as const;

/** A single exercise. */
export const EXERCISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "prompt", "rubric"],
  properties: {
    type: { type: "string", enum: [...EXERCISE_TYPE_VALUES] },
    prompt: { type: "string" },
    rubric: RUBRIC_SCHEMA,
  },
} as const;

/** A single module. */
export const MODULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "order",
    "title",
    "skill_area",
    "objectives",
    "materials",
    "lesson",
    "gate_type",
    "exercises",
  ],
  properties: {
    order: { type: "integer" },
    title: { type: "string" },
    skill_area: { type: "string" },
    objectives: { type: "array", items: { type: "string" } },
    materials: { type: "string" },
    lesson: { type: "array", items: LESSON_BLOCK_SCHEMA },
    gate_type: { type: "string", enum: [...GATE_TYPE_VALUES] },
    exercises: { type: "array", items: EXERCISE_SCHEMA },
  },
} as const;

/** Full program shape. */
export const PROGRAM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["week_count", "week_count_rationale", "modules"],
  properties: {
    week_count: { type: "integer" },
    week_count_rationale: { type: "string" },
    modules: { type: "array", items: MODULE_SCHEMA },
  },
} as const;
