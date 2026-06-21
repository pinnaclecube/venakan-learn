import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import PDFDocument from "pdfkit";
import { requireStaff, HttpError } from "./_auth.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 60;

// --- Brand palette (no #-prefix for docx; with-# for pdfkit) ----------------
const INK = "0F172A";
const EMERALD = "059669";
const MIST = "F1F5F9";
const WHITE = "FFFFFF";

const GATE_LABELS: Record<string, string> = {
  auto_pass: "Auto pass",
  trainer_review: "Trainer review",
  cross_track: "Cross-track",
};
const EXERCISE_LABELS: Record<string, string> = {
  code: "Code",
  rag: "RAG",
  agent: "Agent",
  judge: "Judge",
};

type LessonBlock =
  | { type: "markdown"; text: string }
  | { type: "code"; language?: string; code: string }
  | { type: "video_embed"; url: string; caption?: string }
  | { type: "image"; url: string; alt?: string }
  | { type: "callout"; variant?: string; text: string };

interface RubricCriterion {
  name: string;
  weight: number;
  description: string;
}
interface ExerciseShape {
  type: string;
  prompt: string;
  rubric: { criteria?: RubricCriterion[] };
}
interface ModuleShape {
  order: number;
  title: string;
  objectives: string[];
  materials: string | null;
  lesson: LessonBlock[];
  gate_type: string;
  exercises: ExerciseShape[];
}
interface ProgramExport {
  title: string;
  roleFamily: string | null;
  weekCount: number;
  version: number;
  modules: ModuleShape[];
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadProgram(
  admin: SupabaseClient,
  programId: string,
  tenantId: string,
): Promise<ProgramExport> {
  const { data: program, error: progErr } = await admin
    .from("program")
    .select("id, tenant_id, week_count, version, role_definition_id")
    .eq("id", programId)
    .maybeSingle();
  if (progErr) throw new HttpError(500, progErr.message);
  if (!program || program.tenant_id !== tenantId) {
    throw new HttpError(404, "Program not found.");
  }

  const { data: role } = await admin
    .from("role_definition")
    .select("title, family")
    .eq("id", program.role_definition_id)
    .maybeSingle();

  const { data: modules, error: modErr } = await admin
    .from("module")
    .select("*")
    .eq("program_id", programId)
    .order("order", { ascending: true });
  if (modErr) throw new HttpError(500, modErr.message);

  const mods = modules ?? [];
  const moduleIds = mods.map((m) => m.id as string);
  let exercises: Record<string, unknown>[] = [];
  if (moduleIds.length > 0) {
    const { data: exData, error: exErr } = await admin
      .from("exercise")
      .select("*")
      .in("module_id", moduleIds)
      .order("created_at", { ascending: true });
    if (exErr) throw new HttpError(500, exErr.message);
    exercises = exData ?? [];
  }

  return {
    title: role?.title ?? "Program",
    roleFamily: role?.family ?? null,
    weekCount: program.week_count ?? 0,
    version: program.version ?? 1,
    modules: mods.map((m) => ({
      order: m.order as number,
      title: m.title as string,
      objectives: (m.objectives as string[]) ?? [],
      materials: (m.materials as string | null) ?? null,
      lesson: ((m.lesson as LessonBlock[]) ?? []) as LessonBlock[],
      gate_type: m.gate_type as string,
      exercises: exercises
        .filter((ex) => ex.module_id === m.id)
        .map((ex) => ({
          type: ex.type as string,
          prompt: ex.prompt as string,
          rubric: (ex.rubric as { criteria?: RubricCriterion[] }) ?? {
            criteria: [],
          },
        })),
    })),
  };
}

async function loadLogo(): Promise<Buffer | null> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return await readFile(path.join(here, "assets", "venakan-logo.png"));
  } catch {
    return null;
  }
}

function safeFilename(title: string, ext: string): string {
  const base =
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "venakan-program";
  return `${base}.${ext}`;
}

function generatedDate(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ===========================================================================
// DOCX
// ===========================================================================
function lessonParagraphsDocx(lesson: LessonBlock[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const block of lesson) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "markdown") {
      // Render each markdown line as its own paragraph (light touch).
      for (const line of (block.text ?? "").split("\n")) {
        if (!line.trim()) continue;
        out.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: line.replace(/^#+\s*/, "") })],
          }),
        );
      }
    } else if (block.type === "code") {
      const lines = (block.code ?? "").split("\n");
      out.push(
        new Paragraph({
          spacing: { before: 80, after: 80 },
          shading: { type: ShadingType.CLEAR, fill: MIST },
          border: {
            top: { style: BorderStyle.SINGLE, size: 4, color: EMERALD },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: EMERALD },
            left: { style: BorderStyle.SINGLE, size: 4, color: EMERALD },
            right: { style: BorderStyle.SINGLE, size: 4, color: EMERALD },
          },
          children: lines.map(
            (l, i) =>
              new TextRun({
                text: l,
                font: "Courier New",
                size: 18,
                color: INK,
                break: i === 0 ? 0 : 1,
              }),
          ),
        }),
      );
    } else if (block.type === "callout") {
      const label = (block.variant ?? "info").toUpperCase();
      out.push(
        new Paragraph({
          spacing: { before: 80, after: 80 },
          shading: { type: ShadingType.CLEAR, fill: MIST },
          children: [
            new TextRun({ text: `${label}: `, bold: true, color: EMERALD }),
            new TextRun({ text: block.text ?? "" }),
          ],
        }),
      );
    } else if (block.type === "image") {
      out.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: "Image: ", bold: true, color: EMERALD }),
            new TextRun({ text: block.alt || block.url || "", italics: true }),
            new TextRun({ text: ` (${block.url})`, color: "64748B" }),
          ],
        }),
      );
    } else if (block.type === "video_embed") {
      out.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: "Video: ", bold: true, color: EMERALD }),
            new TextRun({
              text: block.caption || block.url || "",
              italics: true,
            }),
            new TextRun({ text: ` (${block.url})`, color: "64748B" }),
          ],
        }),
      );
    }
  }
  return out;
}

function rubricTableDocx(criteria: RubricCriterion[]): Table {
  const header = new TableRow({
    tableHeader: true,
    children: ["Criterion", "Weight", "Description"].map(
      (t) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: INK },
          children: [
            new Paragraph({
              children: [new TextRun({ text: t, bold: true, color: WHITE })],
            }),
          ],
        }),
    ),
  });
  const rows = criteria.map((c, i) => {
    const fill = i % 2 === 0 ? MIST : WHITE;
    return new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill },
          children: [
            new Paragraph({
              children: [new TextRun({ text: c.name ?? "", bold: true })],
            }),
          ],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${Math.round((c.weight ?? 0) * 100)}%`,
                  color: EMERALD,
                  bold: true,
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill },
          children: [new Paragraph({ text: c.description ?? "" })],
        }),
      ],
    });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows],
  });
}

async function buildDocx(prog: ProgramExport, logo: Buffer | null): Promise<Buffer> {
  // Cover banner: a light (mist) band holding the black logo/wordmark, with an
  // emerald accent rule beneath. The brand logo is black, so it sits on a light
  // background (not a dark one) to stay visible.
  const wordmark = logo
    ? [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [
            new ImageRun({
              data: logo,
              type: "png",
              transformation: { width: 240, height: 63 },
            }),
          ],
        }),
      ]
    : [
        new Paragraph({
          children: [
            new TextRun({ text: "VENAKAN", bold: true, color: INK, size: 40 }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: "INFO SOLUTIONS",
              color: EMERALD,
              size: 20,
              characterSpacing: 60,
            }),
          ],
        }),
      ];

  const banner = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: MIST },
      bottom: { style: BorderStyle.SINGLE, size: 18, color: EMERALD },
      left: { style: BorderStyle.NONE, size: 0, color: MIST },
      right: { style: BorderStyle.NONE, size: 0, color: MIST },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: MIST },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: MIST },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: MIST },
            margins: { top: 240, bottom: 240, left: 240, right: 240 },
            children: wordmark,
          }),
        ],
      }),
    ],
  });

  const children: (Paragraph | Table)[] = [
    banner,
    new Paragraph({ spacing: { before: 360 } }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: prog.title, color: INK, bold: true })],
    }),
  ];

  if (prog.roleFamily) {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: prog.roleFamily, color: EMERALD, bold: true }),
        ],
      }),
    );
  }
  children.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `${prog.weekCount} weeks · v${prog.version}`,
          color: "475569",
        }),
        new TextRun({ text: `   ·   Generated ${generatedDate()}`, color: "475569" }),
      ],
    }),
  );

  children.push(
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `This program contains ${prog.modules.length} module${
            prog.modules.length === 1 ? "" : "s"
          } sequenced so foundational skills precede dependent ones. Each module includes objectives, materials, a lesson, and graded exercises.`,
          italics: true,
          color: "475569",
        }),
      ],
    }),
  );

  for (const m of prog.modules) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 60 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: EMERALD },
        },
        children: [
          new TextRun({
            text: `Module ${m.order}: ${m.title}`,
            color: INK,
            bold: true,
          }),
        ],
      }),
    );

    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: ` ${GATE_LABELS[m.gate_type] ?? m.gate_type} `,
            color: WHITE,
            bold: true,
            shading: { type: ShadingType.CLEAR, fill: EMERALD, color: "auto" },
          }),
        ],
      }),
    );

    if (m.objectives.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 80, after: 40 },
          children: [new TextRun({ text: "Objectives", color: EMERALD, bold: true })],
        }),
      );
      for (const o of m.objectives) {
        children.push(new Paragraph({ text: o, bullet: { level: 0 } }));
      }
    }

    if (m.materials) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 120, after: 40 },
          children: [new TextRun({ text: "Materials", color: EMERALD, bold: true })],
        }),
        new Paragraph({ text: m.materials }),
      );
    }

    if (m.lesson.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 120, after: 40 },
          children: [new TextRun({ text: "Lesson", color: EMERALD, bold: true })],
        }),
        ...lessonParagraphsDocx(m.lesson),
      );
    }

    if (m.exercises.length > 0) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 120, after: 40 },
          children: [new TextRun({ text: "Exercises", color: EMERALD, bold: true })],
        }),
      );
      for (const ex of m.exercises) {
        children.push(
          new Paragraph({
            spacing: { before: 100, after: 40 },
            children: [
              new TextRun({
                text: ` ${EXERCISE_LABELS[ex.type] ?? ex.type} `,
                color: WHITE,
                bold: true,
                shading: { type: ShadingType.CLEAR, fill: INK, color: "auto" },
              }),
            ],
          }),
          new Paragraph({ text: ex.prompt, spacing: { after: 60 } }),
        );
        const criteria = ex.rubric?.criteria ?? [];
        if (criteria.length > 0) {
          children.push(rubricTableDocx(criteria));
          children.push(new Paragraph({ spacing: { after: 80 } }));
        }
      }
    }
  }

  // Running header: black logo (or ink wordmark) on a plain white band with a
  // thin emerald rule beneath.
  const headerChildren = logo
    ? [
        new ImageRun({
          data: logo,
          type: "png",
          transformation: { width: 96, height: 25 },
        }),
      ]
    : [
        new TextRun({ text: "VENAKAN", bold: true, color: INK, size: 16 }),
        new TextRun({ text: "  INFO SOLUTIONS", color: EMERALD, size: 12 }),
      ];

  const header = new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: WHITE },
          bottom: { style: BorderStyle.SINGLE, size: 6, color: EMERALD },
          left: { style: BorderStyle.NONE, size: 0, color: WHITE },
          right: { style: BorderStyle.NONE, size: 0, color: WHITE },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: WHITE },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: WHITE },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { type: ShadingType.CLEAR, fill: WHITE },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: headerChildren })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "Venakan Info Solutions   ·   Page ", color: "94A3B8", size: 16 }),
          new TextRun({ children: [PageNumber.CURRENT], color: "94A3B8", size: 16 }),
          new TextRun({ text: " of ", color: "94A3B8", size: 16 }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: "94A3B8", size: 16 }),
        ],
      }),
    ],
  });

  const doc = new Document({
    sections: [
      {
        headers: { default: header },
        footers: { default: footer },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ===========================================================================
// PDF
// ===========================================================================
function pdfBanner(doc: PDFKit.PDFDocument, logo: Buffer | null): void {
  const top = doc.y;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = 72;
  doc.save();
  // Light (mist) band — the brand logo is black, so keep the background light.
  doc.rect(left, top, width, height).fill(`#${MIST}`);
  // Emerald accent rule along the bottom of the band.
  doc.rect(left, top + height - 3, width, 3).fill(`#${EMERALD}`);
  if (logo) {
    try {
      doc.image(logo, left + 18, top + 16, { height: height - 38 });
    } catch {
      pdfWordmark(doc, left + 18, top + 20);
    }
  } else {
    pdfWordmark(doc, left + 18, top + 20);
  }
  doc.restore();
  doc.y = top + height + 24;
  doc.x = left;
}

function pdfWordmark(doc: PDFKit.PDFDocument, x: number, y: number): void {
  doc.fontSize(22).font("Helvetica-Bold").fillColor(`#${INK}`).text("VENAKAN", x, y);
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(`#${EMERALD}`)
    .text("INFO SOLUTIONS", x + 1, y + 26, { characterSpacing: 3 });
}

function pdfLesson(doc: PDFKit.PDFDocument, lesson: LessonBlock[]): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (const block of lesson) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "markdown") {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(`#${INK}`)
        .text((block.text ?? "").replace(/^#+\s*/gm, ""), left, doc.y, { width });
      doc.moveDown(0.4);
    } else if (block.type === "code") {
      const codeText = block.code ?? "";
      doc.moveDown(0.2);
      const startY = doc.y;
      doc.font("Courier").fontSize(9).fillColor(`#${INK}`);
      const codeHeight = doc.heightOfString(codeText, { width: width - 16 });
      doc.save();
      doc
        .rect(left, startY, width, codeHeight + 12)
        .fillAndStroke(`#${MIST}`, `#${EMERALD}`);
      doc.restore();
      doc
        .font("Courier")
        .fontSize(9)
        .fillColor(`#${INK}`)
        .text(codeText, left + 8, startY + 6, { width: width - 16 });
      doc.y = startY + codeHeight + 16;
      doc.x = left;
      doc.moveDown(0.3);
    } else if (block.type === "callout") {
      const label = (block.variant ?? "info").toUpperCase();
      doc.moveDown(0.2);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(`#${EMERALD}`)
        .text(`${label}: `, left, doc.y, { continued: true });
      doc.font("Helvetica").fillColor(`#${INK}`).text(block.text ?? "", { width });
      doc.moveDown(0.3);
    } else if (block.type === "image") {
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(`#${EMERALD}`)
        .text("Image: ", left, doc.y, { continued: true });
      doc
        .font("Helvetica-Oblique")
        .fillColor(`#${INK}`)
        .text(`${block.alt || block.url} (${block.url})`, { width });
      doc.moveDown(0.3);
    } else if (block.type === "video_embed") {
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(`#${EMERALD}`)
        .text("Video: ", left, doc.y, { continued: true });
      doc
        .font("Helvetica-Oblique")
        .fillColor(`#${INK}`)
        .text(`${block.caption || block.url} (${block.url})`, { width });
      doc.moveDown(0.3);
    }
  }
}

function pdfRubric(doc: PDFKit.PDFDocument, criteria: RubricCriterion[]): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colName = width * 0.3;
  const colWeight = width * 0.15;
  const colDesc = width * 0.55;
  const rowPad = 4;

  function ensureSpace(h: number) {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  }

  // Header
  ensureSpace(20);
  let y = doc.y;
  doc.save();
  doc.rect(left, y, width, 18).fill(`#${INK}`);
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(`#${WHITE}`);
  doc.text("Criterion", left + rowPad, y + 5, { width: colName - rowPad });
  doc.text("Weight", left + colName + rowPad, y + 5, { width: colWeight - rowPad });
  doc.text("Description", left + colName + colWeight + rowPad, y + 5, {
    width: colDesc - rowPad,
  });
  doc.y = y + 18;

  criteria.forEach((c, i) => {
    doc.font("Helvetica").fontSize(9).fillColor(`#${INK}`);
    const descH = doc.heightOfString(c.description ?? "", {
      width: colDesc - rowPad * 2,
    });
    const nameH = doc.heightOfString(c.name ?? "", { width: colName - rowPad * 2 });
    const rowH = Math.max(descH, nameH, 12) + rowPad * 2;
    ensureSpace(rowH);
    y = doc.y;
    if (i % 2 === 0) {
      doc.save();
      doc.rect(left, y, width, rowH).fill(`#${MIST}`);
      doc.restore();
    }
    doc.font("Helvetica-Bold").fontSize(9).fillColor(`#${INK}`);
    doc.text(c.name ?? "", left + rowPad, y + rowPad, { width: colName - rowPad * 2 });
    doc.font("Helvetica-Bold").fillColor(`#${EMERALD}`);
    doc.text(`${Math.round((c.weight ?? 0) * 100)}%`, left + colName + rowPad, y + rowPad, {
      width: colWeight - rowPad * 2,
    });
    doc.font("Helvetica").fillColor(`#${INK}`);
    doc.text(c.description ?? "", left + colName + colWeight + rowPad, y + rowPad, {
      width: colDesc - rowPad * 2,
    });
    doc.y = y + rowH;
  });
  doc.x = left;
  doc.moveDown(0.5);
}

function buildPdf(prog: ProgramExport, logo: Buffer | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // --- Cover ---
    pdfBanner(doc, logo);
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(26).fillColor(`#${INK}`).text(prog.title, { width });
    if (prog.roleFamily) {
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(`#${EMERALD}`).text(prog.roleFamily);
    }
    doc.moveDown(0.3);
    doc
      .font("Helvetica")
      .fontSize(11)
      .fillColor("#475569")
      .text(`${prog.weekCount} weeks · v${prog.version}  ·  Generated ${generatedDate()}`);
    doc.moveDown(1);
    doc
      .font("Helvetica-Oblique")
      .fontSize(10)
      .fillColor("#475569")
      .text(
        `This program contains ${prog.modules.length} module${
          prog.modules.length === 1 ? "" : "s"
        } sequenced so foundational skills precede dependent ones. Each module includes objectives, materials, a lesson, and graded exercises.`,
        { width },
      );

    // --- Modules ---
    for (const m of prog.modules) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(16).fillColor(`#${INK}`);
      doc.text(`Module ${m.order}: ${m.title}`, { width });
      const lineY = doc.y + 2;
      doc.save();
      doc.moveTo(left, lineY).lineTo(left + width, lineY).lineWidth(1.5).stroke(`#${EMERALD}`);
      doc.restore();
      doc.moveDown(0.6);

      // Gate badge
      const label = ` ${GATE_LABELS[m.gate_type] ?? m.gate_type} `;
      doc.font("Helvetica-Bold").fontSize(9);
      const badgeW = doc.widthOfString(label) + 6;
      const badgeY = doc.y;
      doc.save();
      doc.roundedRect(left, badgeY, badgeW, 14, 3).fill(`#${EMERALD}`);
      doc.restore();
      doc.fillColor(`#${WHITE}`).text(label, left + 3, badgeY + 3);
      doc.y = badgeY + 18;
      doc.x = left;

      if (m.objectives.length > 0) {
        doc.moveDown(0.3);
        doc.font("Helvetica-Bold").fontSize(11).fillColor(`#${EMERALD}`).text("Objectives");
        doc.font("Helvetica").fontSize(10).fillColor(`#${INK}`);
        for (const o of m.objectives) {
          doc.text(`•  ${o}`, left + 6, doc.y, { width: width - 6 });
        }
      }

      if (m.materials) {
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(11).fillColor(`#${EMERALD}`).text("Materials");
        doc.font("Helvetica").fontSize(10).fillColor(`#${INK}`).text(m.materials, { width });
      }

      if (m.lesson.length > 0) {
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(11).fillColor(`#${EMERALD}`).text("Lesson");
        doc.moveDown(0.2);
        pdfLesson(doc, m.lesson);
      }

      if (m.exercises.length > 0) {
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(11).fillColor(`#${EMERALD}`).text("Exercises");
        for (const ex of m.exercises) {
          doc.moveDown(0.3);
          const exLabel = ` ${EXERCISE_LABELS[ex.type] ?? ex.type} `;
          doc.font("Helvetica-Bold").fontSize(9);
          const exW = doc.widthOfString(exLabel) + 6;
          const exY = doc.y;
          doc.save();
          doc.roundedRect(left, exY, exW, 14, 3).fill(`#${INK}`);
          doc.restore();
          doc.fillColor(`#${WHITE}`).text(exLabel, left + 3, exY + 3);
          doc.y = exY + 18;
          doc.x = left;
          doc.font("Helvetica").fontSize(10).fillColor(`#${INK}`).text(ex.prompt, { width });
          const criteria = ex.rubric?.criteria ?? [];
          if (criteria.length > 0) {
            doc.moveDown(0.3);
            pdfRubric(doc, criteria);
          }
        }
      }
    }

    // --- Running header + footer on every page ---
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const oldBottom = doc.page.margins.bottom;
      const oldTop = doc.page.margins.top;
      doc.page.margins.bottom = 0;
      doc.page.margins.top = 0;

      // Header band (skip on the cover page, which already has the banner).
      if (i > range.start) {
        doc.save();
        doc.rect(0, 0, doc.page.width, 26).fill(`#${INK}`);
        doc.font("Helvetica-Bold").fontSize(10);
        doc.fillColor(`#${WHITE}`).text("Venakan ", 56, 8, { continued: true });
        doc.fillColor("#34D399").text("Learn");
        doc.restore();
      }

      // Footer
      doc.save();
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#94A3B8")
        .text(
          `Venakan Info Solutions   ·   Page ${i - range.start + 1} of ${range.count}`,
          56,
          doc.page.height - 28,
          { width: doc.page.width - 112, align: "center" },
        );
      doc.restore();

      doc.page.margins.bottom = oldBottom;
      doc.page.margins.top = oldTop;
    }

    doc.end();
  });
}

// ===========================================================================
// Handler
// ===========================================================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { admin, caller } = await requireStaff(req);

    const { programId, format } = (req.body ?? {}) as {
      programId?: string;
      format?: "docx" | "pdf";
    };
    if (!programId) throw new HttpError(400, "programId is required.");
    if (format !== "docx" && format !== "pdf") {
      throw new HttpError(400, "format must be 'docx' or 'pdf'.");
    }

    const prog = await loadProgram(admin, programId, caller.tenant_id);
    const logo = await loadLogo();

    if (format === "docx") {
      const buffer = await buildDocx(prog, logo);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename(prog.title, "docx")}"`,
      );
      return res.status(200).send(buffer);
    }

    const buffer = await buildPdf(prog, logo);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFilename(prog.title, "pdf")}"`,
    );
    return res.status(200).send(buffer);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
