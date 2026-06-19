import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Info, AlertTriangle, Lightbulb } from "lucide-react";
import type { LessonBlock, CalloutVariant } from "@/lib/runtime";

// ---------------------------------------------------------------------------
// SAFE rendering of trainee-facing lesson content.
//  * markdown  -> react-markdown + remark-gfm. NO rehype-raw — raw HTML is NOT
//                 rendered, so there is no HTML/script injection surface.
//  * code      -> Prism (light theme), restricted to common languages.
//  * video     -> https-only responsive iframe, sandboxed; otherwise a link.
//  * image     -> https-only <img>, lazy.
//  * callout   -> palette-colored box (no gradients).
// ---------------------------------------------------------------------------

const COMMON_LANGUAGES = new Set([
  "javascript",
  "js",
  "typescript",
  "ts",
  "jsx",
  "tsx",
  "python",
  "py",
  "bash",
  "sh",
  "shell",
  "json",
  "yaml",
  "yml",
  "sql",
  "html",
  "css",
  "markdown",
  "md",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "text",
  "plaintext",
]);

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Convert common YouTube/Vimeo watch URLs to embeddable URLs. */
function toEmbedUrl(url: string): string | null {
  if (!isHttps(url)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");

  if (host === "youtube.com" || host === "m.youtube.com") {
    const v = u.searchParams.get("v");
    if (v) return `https://www.youtube.com/embed/${encodeURIComponent(v)}`;
    if (u.pathname.startsWith("/embed/")) return u.toString();
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1);
    if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
  }
  if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    if (id && /^\d+$/.test(id))
      return `https://player.vimeo.com/video/${encodeURIComponent(id)}`;
  }
  if (host === "player.vimeo.com" || host.endsWith("youtube-nocookie.com")) {
    return u.toString();
  }
  return null;
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...p }) => (
            <h1 className="text-xl font-semibold text-ink" {...p} />
          ),
          h2: ({ ...p }) => (
            <h2 className="text-lg font-semibold text-ink" {...p} />
          ),
          h3: ({ ...p }) => (
            <h3 className="text-base font-semibold text-ink" {...p} />
          ),
          p: ({ ...p }) => <p className="text-ink/90" {...p} />,
          ul: ({ ...p }) => (
            <ul className="list-disc space-y-1 pl-5 text-ink/90" {...p} />
          ),
          ol: ({ ...p }) => (
            <ol className="list-decimal space-y-1 pl-5 text-ink/90" {...p} />
          ),
          a: ({ ...p }) => (
            <a
              className="font-medium text-emerald-strong underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          code: ({ ...p }) => (
            <code
              className="rounded bg-mist px-1 py-0.5 font-mono text-[0.85em] text-ink"
              {...p}
            />
          ),
          blockquote: ({ ...p }) => (
            <blockquote
              className="border-l-2 border-emerald pl-3 text-muted-foreground"
              {...p}
            />
          ),
          table: ({ ...p }) => (
            <table className="w-full border-collapse text-sm" {...p} />
          ),
          th: ({ ...p }) => (
            <th
              className="border border-border bg-mist px-2 py-1 text-left font-medium"
              {...p}
            />
          ),
          td: ({ ...p }) => (
            <td className="border border-border px-2 py-1" {...p} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const lang = (language || "text").toLowerCase();
  const safeLang = COMMON_LANGUAGES.has(lang) ? lang : "text";
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-mist px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">
          {language || "text"}
        </span>
      </div>
      <SyntaxHighlighter
        language={safeLang}
        style={oneLight}
        customStyle={{
          margin: 0,
          background: "#ffffff",
          fontSize: "0.8125rem",
          padding: "0.75rem",
        }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function VideoEmbed({ url, caption }: { url: string; caption: string }) {
  const embed = toEmbedUrl(url);
  if (!embed) {
    // Not a recognized https embed — render a safe link only.
    return isHttps(url) ? (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-medium text-emerald-strong underline underline-offset-2"
      >
        {caption || url}
      </a>
    ) : (
      <p className="text-sm text-muted-foreground">{caption || "Video"}</p>
    );
  }
  return (
    <figure className="space-y-2">
      <div className="relative w-full overflow-hidden rounded-md border border-border pt-[56.25%]">
        <iframe
          src={embed}
          title={caption || "Embedded video"}
          className="absolute inset-0 h-full w-full"
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allowFullScreen
          loading="lazy"
        />
      </div>
      {caption && (
        <figcaption className="text-xs text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function ImageBlock({ url, alt }: { url: string; alt: string }) {
  if (!isHttps(url)) {
    return <p className="text-sm text-muted-foreground">{alt || "Image"}</p>;
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="max-w-full rounded-md border border-border"
    />
  );
}

const CALLOUT_STYLES: Record<
  CalloutVariant,
  { box: string; icon: typeof Info }
> = {
  info: { box: "border-border bg-mist text-ink", icon: Info },
  warning: {
    box: "border-amber-200 bg-amber-50 text-amber-800",
    icon: AlertTriangle,
  },
  tip: {
    box: "border-emerald/30 bg-emerald/10 text-ink",
    icon: Lightbulb,
  },
};

function Callout({ variant, text }: { variant: CalloutVariant; text: string }) {
  const cfg = CALLOUT_STYLES[variant] ?? CALLOUT_STYLES.info;
  const Icon = cfg.icon;
  return (
    <div className={"flex gap-2 rounded-md border p-3 text-sm " + cfg.box}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="leading-relaxed">{text}</p>
    </div>
  );
}

export function LessonBlocks({ blocks }: { blocks: LessonBlock[] }) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No lesson content for this module yet.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "markdown":
            return <Markdown key={i} text={block.text} />;
          case "code":
            return (
              <CodeBlock key={i} language={block.language} code={block.code} />
            );
          case "video_embed":
            return (
              <VideoEmbed key={i} url={block.url} caption={block.caption} />
            );
          case "image":
            return <ImageBlock key={i} url={block.url} alt={block.alt} />;
          case "callout":
            return (
              <Callout key={i} variant={block.variant} text={block.text} />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
